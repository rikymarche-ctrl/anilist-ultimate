/**
 * Calendar Data Service
 * Fetches and transforms anime schedule data
 */

import { anilistClient } from '@/api/AnilistClient';
import { USER_ANIME_LIST_QUERY, UPDATE_PROGRESS_MUTATION } from '@/api/queries/calendar';
import { log } from '@core/logger';
import { DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry, MediaListResponse } from '@core/types';

export class CalendarService {
  /**
   * Fetch user's currently watching anime with airing schedules
   */
  async fetchAiringSchedule(userId: number): Promise<AnimeEntry[]> {
    try {
      log.time('Fetch airing schedule');

      const data = await anilistClient.query<MediaListResponse>(USER_ANIME_LIST_QUERY, {
        userId,
        type: 'ANIME',
        status: 'CURRENT',
      });

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

      // Only include anime with upcoming episodes
      if (!media.nextAiringEpisode) {
        continue;
      }

      seenMediaIds.add(media.id); // Mark as seen

      const airingAt = new Date(media.nextAiringEpisode.airingAt * 1000);
      const dayOfWeek = DAYS_OF_WEEK[airingAt.getDay()];

      // Determine clean title (prefer English, fallback to Romaji)
      const cleanTitle = media.title.english || media.title.romaji;

      const animeEntry: AnimeEntry = {
        id: entry.id,
        mediaId: media.id,
        title: cleanTitle,
        cleanTitle,
        episode: media.nextAiringEpisode.episode,
        airingAt,
        timeUntilAiring: media.nextAiringEpisode.timeUntilAiring,
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

      await anilistClient.query(UPDATE_PROGRESS_MUTATION, {
        mediaId,
        progress: newProgress,
      });

      log.success('Progress updated successfully');
      return true;
    } catch (error) {
      log.error('Failed to update progress', error);
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
    const now = Date.now();
    const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;

    return entries.filter((entry) => {
      const airingTime = entry.airingAt.getTime();
      return airingTime >= now && airingTime <= weekFromNow;
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

// Singleton instance
export const calendarService = new CalendarService();
