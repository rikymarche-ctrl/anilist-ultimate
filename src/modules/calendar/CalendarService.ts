/**
 * @file CalendarService.ts
 * @description Calendar collection fetching, local progress overlay and presentation helpers
 *
 * Handles airing schedule merging with user progress data, day-of-week
 * grouping, time formatting (countdown vs release), and aired-status
 * detection. Account scope is checked around collection and queue reads.
 *
 * @see CalendarDataService.ts for the data-fetching layer
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import {
  USER_ANIME_LIST_QUERY,
} from '@/api/queries/calendar';
import { logger } from '@core/logger';
import { DAYS_OF_WEEK } from '@core/constants';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AnimeEntry, CalendarCustomPlan } from '@core/types';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ApiRequestOptions, IApiClient } from '@core/interfaces/IApiClient';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IAstraRatingService } from '@/modules/astra/interfaces/IAstraRatingService';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import type { AstraProgressResult } from '@/modules/astra/interfaces/IAstraRatingService';
import { isCalendarId } from './CalendarEntries';
import { syncQueueSnapshot } from '@core/services/SyncQueueSnapshot';
import { calendarCollection, calendarPending } from './CalendarResponse';
import type { CalendarListEntry } from './CalendarResponse';
import { customPlanEntry } from './CalendarCustomPlans';

/**
 * CalendarService - Anime schedule fetching and transformation
 */
@injectable()
export class CalendarService implements ICalendarService {
  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService,
    @inject(TOKENS.SyncQueue) private syncQueue: ISyncQueueService,
  ) {}

  private fetchSequence = 0;

  /**
   * Fetch user's currently watching anime with airing schedules
   * @param options Request options; `priority` moves the read into the client's user-action lane
   */
  async fetchAiringSchedule(userId: number, customPlans: CalendarCustomPlan[] = [], options: ApiRequestOptions = {}): Promise<AnimeEntry[]> {
    if (!isCalendarId(userId)) throw new Error('Invalid calendar owner');
    // Overlapping fetches need distinct console timer labels.
    const timer = `Fetch airing schedule #${++this.fetchSequence}`;
    logger.time(timer);
    try {
      const captured = await captureApiContext(this.apiClient);
      const context = captured ? { ...captured } : undefined;
      const assertCurrent = () => assertApiContext(this.apiClient, context, userId);
      assertCurrent();
      for (let attempt = 0; attempt < 3; attempt++) {
        const initial = syncQueueSnapshot(await this.syncQueue.getSnapshot());
        const pending = calendarPending(initial.entries, userId);
        assertCurrent();
        // Completed/planned libraries can span many chunks. Usually only active
        // titles are needed; widen the read if a queued edit could activate a
        // title whose remote status still excludes it from that filter.
        const statuses = [...pending.values()].some(patch =>
          patch.status === MediaListStatus.CURRENT || patch.status === MediaListStatus.REPEATING)
          ? null : [MediaListStatus.CURRENT, MediaListStatus.REPEATING];
        const unique = new Map<number, CalendarListEntry>();
        const listIds = new Map<number, number>();
        // Bound broken providers without ever reporting an incomplete collection as success.
        const maxChunks = 100;
        for (let chunk = 1; ; chunk++) {
          assertCurrent();
          const response: unknown = await this.apiClient.query(USER_ANIME_LIST_QUERY, {
            userId, type: 'ANIME', chunk, perChunk: 500, statuses,
          }, false, options);
          assertCurrent();
          const page = calendarCollection(response, userId);
          const pageIds = new Set(page.entries.map(entry => entry.mediaId));
          if (pageIds.size > 500) throw new Error('Invalid calendar chunk size');
          const before = unique.size;
          for (const entry of page.entries) {
            const previous = unique.get(entry.mediaId);
            if ((previous && JSON.stringify(previous) !== JSON.stringify(entry))
              || (listIds.has(entry.id) && listIds.get(entry.id) !== entry.mediaId)) throw new Error('Conflicting calendar entries');
            unique.set(entry.mediaId, entry); listIds.set(entry.id, entry.mediaId);
          }
          if (!page.hasNextChunk) break;
          if (before === unique.size || chunk >= maxChunks) throw new Error('Incomplete calendar collection');
        }
        // Preserve a change pending when the read began, even if its sync completes
        // while the remote response is in flight; a later queued value takes precedence.
        const completed = syncQueueSnapshot(await this.syncQueue.getSnapshot());
        assertCurrent();
        if (completed.revision !== initial.revision) continue;
        const latest = calendarPending(completed.entries, userId);
        assertCurrent();
        latest.forEach((patch, mediaId) => pending.set(mediaId, { ...pending.get(mediaId), ...patch }));
        const merged = [...unique.values()].map(entry => ({ ...entry, ...pending.get(entry.mediaId) }));
        const entries = this.transformToAnimeEntries(merged, customPlans);
        logger.info(`Fetched ${entries.length} airing anime`);
        return entries;
      }
      throw new Error('Calendar changed during loading; please retry');
    } catch (error) {
      logger.error('Failed to fetch airing schedule', error);
      throw error;
    } finally { logger.timeEnd(timer); }
  }

  /**
   * Transform API response to AnimeEntry format
   */
  private transformToAnimeEntries(allEntries: CalendarListEntry[], customPlans: CalendarCustomPlan[] = []): AnimeEntry[] {
    const entries: AnimeEntry[] = [];
    const plans = new Map(customPlans.map(plan => [plan.mediaId, plan]));

    for (const entry of allEntries) {
      const { media, progress } = entry;
      if (!media) continue;

      // ═══════════════════════════════════════════════════════════════════════════
      // FILTERING POLICY:
      // 1. Only include anime (safeguard against mixed collections)
      // 2. Only include things the user is CURRENTLY watching or REPEATING
      //    (This excludes 'PLANNING' titles like Akane-banashi)
      // 3. Only include things with a known upcoming episode
      // ═══════════════════════════════════════════════════════════════════════════

      if (media.type !== 'ANIME') {
        logger.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - Media type is ${media.type}`
        );
        continue;
      }

      if (entry.status !== MediaListStatus.CURRENT && entry.status !== MediaListStatus.REPEATING) {
        logger.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - Status is ${entry.status} (Not CURRENT/REPEATING)`
        );
        continue;
      }

      // Number of episodes already aired. With an upcoming episode it's that
      // episode minus one. Without one, a RELEASING show's planned total can exceed
      // what has aired (between cours), so no aired count is derived from it and
      // the card shows no behind count. FINISHED shows keep the known episode total.
      const isReleasing = media.status === 'RELEASING';
      const lastAired = media.nextAiringEpisode
        ? media.nextAiringEpisode.episode - 1
        : isReleasing ? (progress ?? 0) : (media.episodes ?? 0);
      const customPlan = plans.get(media.id);
      // Only currently-releasing shows belong on the weekly calendar. A show on
      // a between-cour break can briefly have no `nextAiringEpisode` while still
      // RELEASING (e.g. Iruma-kun) — keep those, without a behind count. But
      // long-finished backlog you happen to be behind on (Kill la Kill, Monogatari, …)
      // must NOT flood it.

      // A personal plan's stored total only applies while nothing is scheduled; a returning show uses the live total.
      const knownTotal = media.episodes ?? customPlan?.totalEpisodes ?? null;
      if (customPlan && !media.nextAiringEpisode && entry.status !== MediaListStatus.REPEATING && knownTotal !== null
        && (progress ?? 0) >= knownTotal) continue;

      // A releasing show on a break stays listed unless its known total is already reached.
      const finishedBreak = isReleasing && !media.nextAiringEpisode && media.episodes != null && (progress ?? 0) >= media.episodes;
      if (!media.nextAiringEpisode && !customPlan && (!isReleasing || finishedBreak)) {
        logger.debug(
          `[CalendarService] Skipping "${media.title.romaji}" - No upcoming episode (caught up or not currently releasing)`
        );
        continue;
      }

      // Catch-up shows (no upcoming episode) have no future air date; surface
      // them on today's column so they remain visible/actionable.
      const airingAt = media.nextAiringEpisode
        ? new Date(media.nextAiringEpisode.airingAt * 1000)
        : customPlan ? customPlanEntry(customPlan, entry.id, progress ?? 0).airingAt : new Date();
      const dayOfWeek = DAYS_OF_WEEK[airingAt.getDay()];

      // Determine clean title (prefer English, fallback to Romaji)
      const cleanTitle = media.title.english || media.title.romaji || media.title.native || `Anime ${media.id}`;

      const animeEntry: AnimeEntry = {
        id: entry.id,
        mediaId: media.id,
        title: customPlan && !media.nextAiringEpisode ? customPlan.title : cleanTitle,
        cleanTitle: customPlan && !media.nextAiringEpisode ? customPlan.title : cleanTitle,
        episode: media.nextAiringEpisode ? media.nextAiringEpisode.episode : customPlan ? (progress ?? 0) + 1 : Math.max(1, lastAired),
        airingAt,
        timeUntilAiring: media.nextAiringEpisode ? media.nextAiringEpisode.timeUntilAiring
          : customPlan ? Math.floor((airingAt.getTime() - Date.now()) / 1000) : 0,
        coverImage: media.coverImage.large || media.coverImage.medium || customPlan?.coverImage || '',
        siteUrl: media.siteUrl || customPlan?.siteUrl || `https://anilist.co/anime/${media.id}`,
        progress,
        totalEpisodes: media.episodes ?? customPlan?.totalEpisodes ?? null,
        dayOfWeek,
        // Schedule-backed rows are marked 'airing' so expiry checks can ignore personal and catch-up rows.
        ...(media.nextAiringEpisode ? { calendarKind: 'airing' as const } : customPlan ? { calendarKind: 'personal' as const } : {}),
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
      logger.info('Updating progress', { mediaId, progress: newProgress });

      const result = await this.ratingService.updateProgress(mediaId, newProgress);

      logger.success('Progress updated successfully');

      // Emit PROGRESS_UPDATED event
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId,
        progress: newProgress,
        previousProgress: result.previousProgress,
        userId: result.userId,
        status: result.status,
      });

      return true;
    } catch (error) {
      logger.error('Failed to update progress', error);
      throw error;
    }
  }

  async incrementProgress(mediaId: number): Promise<AstraProgressResult> {
    const result = await this.ratingService.updateProgress(mediaId);
    this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, result);
    return result;
  }

  /**
   * Update anime notes (saves to AniList global notes AND Astra episode journal)
   */
  async updateNotes(mediaId: number, episode: number, notes: string): Promise<boolean> {
    try {
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !Number.isSafeInteger(episode) || episode <= 0 || typeof notes !== 'string') throw new Error('Invalid episode note');
      const context = await captureApiContext(this.apiClient);
      // PRIVACY: Never log user-generated content (notes are private)
      logger.debug(
        `[CalendarService] Saving note for media ${mediaId}, episode ${episode} (${notes.length} chars)`
      );

      await this.syncQueue.appendNote(mediaId, episode, notes, context?.sessionId);
      assertApiContext(this.apiClient, context);

      // 2. Update Astra Episode Journal (Per-episode notes) via EventBus to avoid circular dependency
      this.eventBus.emit(EVENT_TYPES.ASTRA_SAVE_NOTE, { mediaId, episode, notes, ...(context ? { ownerId: context.userId } : {}) });
      logger.debug('[CalendarService] Astra Journal event emitted');

      logger.success('Episode note durably queued');
      return true;
    } catch (error) {
      logger.error('[CalendarService] Failed to save notes:', error);
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
    return entry.airingAt.getTime() <= Date.now();
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
