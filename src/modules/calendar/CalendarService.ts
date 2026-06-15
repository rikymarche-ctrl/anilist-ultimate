/**
 * @file CalendarService.ts
 * @description Pure utility service for transforming API responses into calendar entries
 *
 * Handles airing schedule merging with user progress data, day-of-week
 * grouping, time formatting (countdown vs release), and aired-status
 * detection. All methods are stateless transforms.
 *
 * @see CalendarDataService.ts for the data-fetching layer
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import {
  USER_ANIME_LIST_QUERY,
  UPDATE_PROGRESS_MUTATION,
  UPDATE_NOTES_MUTATION,
} from '@/api/queries/calendar';
import { log } from '@core/logger';
import { DAYS_OF_WEEK } from '@core/constants';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AnimeEntry, MediaListResponse } from '@core/types';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import { EVENT_TYPES } from '@core/events/EventTypes';

/**
 * CalendarService - Anime schedule fetching and transformation
 */
@injectable()
export class CalendarService implements ICalendarService {
  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {}

  /**
   * Fetch user's currently watching anime with airing schedules
   */
  async fetchAiringSchedule(userId: number): Promise<AnimeEntry[]> {
    try {
      log.time('Fetch airing schedule');

      // Fetch ALL lists to see what's available
      const data = await this.apiClient.query<MediaListResponse>(USER_ANIME_LIST_QUERY, {
        userId,
        type: 'ANIME',
      });

      if (data?.MediaListCollection?.lists) {
        const listNames = data.MediaListCollection.lists.map(
          (l) => `${l.name} (${l.entries.length})`
        );
        const totalRaw = data.MediaListCollection.lists.reduce(
          (acc, l) => acc + l.entries.length,
          0
        );
        log.debug(
          `[CalendarService] API Response: ${data.MediaListCollection.lists.length} lists [${listNames.join(', ')}]. Total: ${totalRaw}`
        );
      } else {
        log.warn('[CalendarService] API response missing MediaListCollection', data);
      }

      const entries = this.transformToAnimeEntries(data);

      log.timeEnd('Fetch airing schedule');
      log.info(`Fetched ${entries.length} airing anime`);

      return entries;
    } catch (error) {
      log.error('Failed to fetch airing schedule', error);
      throw error;
    }
  }

  /**
   * Transform API response to AnimeEntry format
   */
  private transformToAnimeEntries(data: MediaListResponse): AnimeEntry[] {
    const entries: AnimeEntry[] = [];
    const seenMediaIds = new Set<number>(); // Track seen anime to avoid duplicates

    // Extract entries from all lists
    const allEntries = data.MediaListCollection.lists.flatMap((list) => list.entries);

    for (const entry of allEntries) {
      const { media, progress } = entry;

      // Skip if we've already processed this anime (handles duplicates from multiple lists)
      if (seenMediaIds.has(media.id)) {
        continue;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // FILTERING POLICY:
      // 1. Only include anime (safeguard against mixed collections)
      // 2. Only include things the user is CURRENTLY watching or REPEATING
      //    (This excludes 'PLANNING' titles like Akane-banashi)
      // 3. Only include things with a known upcoming episode
      // ═══════════════════════════════════════════════════════════════════════════

      if (media.type !== 'ANIME') {
        log.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - Media type is ${media.type}`
        );
        continue;
      }

      if (entry.status !== MediaListStatus.CURRENT && entry.status !== MediaListStatus.REPEATING) {
        log.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - Status is ${entry.status} (Not CURRENT/REPEATING)`
        );
        continue;
      }

      // Number of episodes already aired. With an upcoming episode it's that
      // episode minus one; once a cour has fully aired AniList drops
      // `nextAiringEpisode`, so we fall back to the known episode total.
      const lastAired = media.nextAiringEpisode
        ? media.nextAiringEpisode.episode - 1
        : (media.episodes ?? 0);
      const isBehind = (progress ?? 0) < lastAired;
      // Only currently-releasing shows belong on the weekly calendar. A show on
      // a between-cour break can briefly have no `nextAiringEpisode` while still
      // RELEASING (e.g. Iruma-kun) — keep those. But long-finished backlog you
      // happen to be behind on (Kill la Kill, Monogatari, …) must NOT flood it.
      const isReleasing = media.status === 'RELEASING';

      if (!media.nextAiringEpisode && !(isBehind && isReleasing)) {
        log.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - No upcoming episode (caught up or not currently releasing)`
        );
        continue;
      }

      seenMediaIds.add(media.id); // Mark as seen

      // Catch-up shows (no upcoming episode) have no future air date; surface
      // them on today's column so they remain visible/actionable.
      const airingAt = media.nextAiringEpisode
        ? new Date(media.nextAiringEpisode.airingAt * 1000)
        : new Date();
      const dayOfWeek = DAYS_OF_WEEK[airingAt.getDay()];

      // Determine clean title (prefer English, fallback to Romaji)
      const cleanTitle = media.title.english || media.title.romaji;

      const animeEntry: AnimeEntry = {
        id: entry.id,
        mediaId: media.id,
        title: cleanTitle,
        cleanTitle,
        episode: media.nextAiringEpisode ? media.nextAiringEpisode.episode : (progress ?? 0) + 1,
        airingAt,
        timeUntilAiring: media.nextAiringEpisode ? media.nextAiringEpisode.timeUntilAiring : 0,
        coverImage: media.coverImage.large || media.coverImage.medium,
        siteUrl: media.siteUrl,
        progress,
        totalEpisodes: media.episodes,
        dayOfWeek,
      };

      entries.push(animeEntry);
    }

    // Sort by airing time
    entries.sort((a, b) => a.airingAt.getTime() - b.airingAt.getTime());

    return entries;
  }

  /**
   * Update anime progress (mark episode as watched)
   */
  async updateProgress(mediaId: number, newProgress: number): Promise<boolean> {
    try {
      log.info('Updating progress', { mediaId, progress: newProgress });

      await this.apiClient.query(UPDATE_PROGRESS_MUTATION, {
        mediaId,
        progress: newProgress,
      });

      log.success('Progress updated successfully');

      // Emit PROGRESS_UPDATED event
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId,
        progress: newProgress,
        previousProgress: newProgress - 1,
        userId: 0,
      });

      return true;
    } catch (error) {
      log.error('Failed to update progress', error);
      throw error;
    }
  }

  /**
   * Update anime notes (saves to AniList global notes AND Astra episode journal)
   */
  async updateNotes(mediaId: number, episode: number, notes: string): Promise<boolean> {
    try {
      // PRIVACY: Never log user-generated content (notes are private)
      log.debug(
        `[CalendarService] Saving note for media ${mediaId}, episode ${episode} (${notes.length} chars)`
      );

      // 1. Update AniList global notes (Append style)
      // For now we just prefix it, in a real scenario we'd fetch current notes first.
      const noteToSave = `[Ep ${episode}] ${notes}`;
      await this.apiClient.mutate(UPDATE_NOTES_MUTATION, {
        mediaId,
        notes: noteToSave,
      });
      log.debug('[CalendarService] AniList mutation successful');

      // 2. Update Astra Episode Journal (Per-episode notes) via EventBus to avoid circular dependency
      this.eventBus.emit(EVENT_TYPES.ASTRA_SAVE_NOTE, { mediaId, episode, notes });
      log.debug('[CalendarService] Astra Journal event emitted');

      log.success('Notes updated successfully in AniList and Astra Journal');
      return true;
    } catch (error) {
      log.error('[CalendarService] Failed to save notes:', error);
      throw error;
    }
  }

  /**
   * Group anime entries by day of the week
   */
  groupByDay(entries: AnimeEntry[]): Record<string, AnimeEntry[]> {
    const grouped: Record<string, AnimeEntry[]> = {};

    // Initialize all days
    DAYS_OF_WEEK.forEach((day) => {
      grouped[day] = [];
    });

    // Group entries
    entries.forEach((entry) => {
      grouped[entry.dayOfWeek].push(entry);
    });

    return grouped;
  }

  /**
   * Filter entries for a specific day
   */
  getEntriesForDay(entries: AnimeEntry[], day: string): AnimeEntry[] {
    return entries.filter((entry) => entry.dayOfWeek === day);
  }

  /**
   * Get entries for today
   */
  getTodayEntries(entries: AnimeEntry[]): AnimeEntry[] {
    const today = DAYS_OF_WEEK[new Date().getDay()];
    return this.getEntriesForDay(entries, today);
  }

  /**
   * Get entries for this week (next 7 days)
   */
  getWeekEntries(entries: AnimeEntry[]): AnimeEntry[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();
    const weekFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;

    return entries.filter((entry) => {
      const airingTime = entry.airingAt.getTime();
      return airingTime >= startOfToday && airingTime <= weekFromNow;
    });
  }

  /**
   * Format time until airing
   */
  formatTimeUntilAiring(seconds: number): string {
    if (seconds < 0) return 'Aired';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours === 0) {
      return `${minutes}m`;
    } else if (hours < 24) {
      return `${hours}h ${minutes}m`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
  }

  /**
   * Format airing time as HH:MM
   */
  formatAiringTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  /**
   * Check if an episode has already aired
   */
  hasAired(entry: AnimeEntry): boolean {
    return entry.airingAt.getTime() < Date.now();
  }

  /**
   * Check if episode is airing soon (within 1 hour)
   */
  isAiringSoon(entry: AnimeEntry): boolean {
    const timeUntil = entry.airingAt.getTime() - Date.now();
    return timeUntil > 0 && timeUntil < 3600000; // 1 hour in ms
  }

  /**
   * Check if episode is airing today
   */
  isAiringToday(entry: AnimeEntry): boolean {
    const today = new Date();
    const airingDate = entry.airingAt;

    return (
      today.getDate() === airingDate.getDate() &&
      today.getMonth() === airingDate.getMonth() &&
      today.getFullYear() === airingDate.getFullYear()
    );
  }
}

// Singleton instance is now handled by DI container
