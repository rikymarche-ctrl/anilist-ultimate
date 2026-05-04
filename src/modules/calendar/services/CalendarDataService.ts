/**
 * @file CalendarDataService.ts
 * @description Service layer for loading airing schedules with intelligent caching
 *
 * Fetches airing schedule and user anime list via the API client,
 * merges them through CalendarService, and stores results in CalendarStore.
 * Implements persistent cache with fingerprint validation to reduce API calls.
 *
 * Caching:
 *   - Checks CalendarStore.loadEntriesFromCache() before API call
 *   - TTL 30 minutes with fingerprint validation
 *   - Auto-invalidates cache on progress updates
 *   - forceRefresh parameter bypasses cache
 *
 * @see CalendarService.ts for data transformation
 * @see CalendarStore.ts for persistent cache implementation
 * @see docs/MODULES.md#1-calendar-module
 * @see docs/PERFORMANCE.md for caching metrics
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CalendarService } from '../CalendarService';
import { CalendarStore } from '../CalendarStore';
import { log } from '@core/logger';
import { AnimeEntry } from '@core/types';

@injectable()
export class CalendarDataService {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.CalendarService) private calendarService: CalendarService,
    @inject(TOKENS.ToastService) private toastService: any,
    @inject(TOKENS.CalendarStore) private calendarStore: CalendarStore
  ) {}

  /**
   * Load airing schedule for the user with intelligent caching
   * Tries cache first, falls back to API if stale/missing
   */
  public async loadSchedule(userId: number, forceRefresh: boolean = false): Promise<void> {
    try {
      this.calendarStore.setLoading(true);

      // Try loading from cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedEntries = await this.calendarStore.loadEntriesFromCache();
        if (cachedEntries && cachedEntries.length > 0) {
          log.info(`[CalendarData] Cache hit: found ${cachedEntries.length} entries`);
          this.calendarStore.setEntries(cachedEntries);
          
          // Emit global event
          this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
            scheduleCount: cachedEntries.length,
            progressCount: cachedEntries.filter((e: any) => e.progress !== undefined).length,
            timestamp: new Date(),
            fromCache: true,
          });

          return;
        }
        log.info('[CalendarData] Cache miss or empty cache');
      }

      // Cache miss or force refresh - fetch from API
      log.info(`[CalendarData] Fetching fresh schedule from API for user ${userId}`);
      const entries = await this.calendarService.fetchAiringSchedule(userId);
      
      log.info(`[CalendarData] API returned ${entries.length} transformed entries`);
      
      this.calendarStore.setEntries(entries);

      // Save to cache for future loads
      if (entries.length > 0) {
        await this.calendarStore.saveEntriesToCache(entries);
        log.debug('[CalendarData] Entries saved to cache');
      } else {
        log.warn('[CalendarData] API returned 0 entries. Skipping cache save to avoid poisoning.');
      }

      log.success(`[CalendarData] Successfully loaded ${entries.length} anime entries`);

      // Emit global event
      this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
        scheduleCount: entries.length,
        progressCount: entries.filter((e: any) => e.progress !== undefined).length,
        timestamp: new Date(),
        fromCache: false,
      });
    } catch (error) {
      log.error('[CalendarData] Failed to load schedule from API', error);
      
      // FALLBACK: Try loading stale cache if we haven't already
      const state = this.calendarStore.getState();
      if (state.entries.length === 0) {
        log.info('[CalendarData] Attempting stale cache fallback after API failure...');
        const staleEntries = await this.calendarStore.loadEntriesFromCache();
        if (staleEntries) {
          this.calendarStore.setEntries(staleEntries);
          log.success(`[CalendarData] Fallback successful: Loaded ${staleEntries.length} stale entries`);
          
          this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
            scheduleCount: staleEntries.length,
            progressCount: staleEntries.filter((e: any) => e.progress !== undefined).length,
            timestamp: new Date(),
            fromCache: true,
          });
          return; // Success via fallback
        }
      }

      this.calendarStore.setError(error as Error);
      throw error;
    } finally {
      this.calendarStore.setLoading(false);
    }
  }

  /**
   * Mark an episode as watched
   * Invalidates cache to ensure fresh data on next load
   */
  public async updateProgress(mediaId: number): Promise<number | null> {
    try {
      const entry = this.calendarStore.getState().entries.find((e: AnimeEntry) => e.mediaId === mediaId);
      if (!entry) throw new Error('Entry not found');

      const newProgress = (entry.progress || 0) + 1;
      await this.calendarService.updateProgress(mediaId, newProgress);

      // Update local state
      this.calendarStore.updateEntry(mediaId, { progress: newProgress });
      this.toastService.success(`Updated progress for ${entry.title}.`, { mediaId, progress: newProgress });

      // Invalidate cache since progress changed
      await this.calendarStore.invalidateCache();
      log.debug('[CalendarData] Cache invalidated after progress update');

      // Emit progression event
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId,
        progress: newProgress,
        previousProgress: newProgress - 1,
        userId: 0
      });

      return newProgress;
    } catch (error) {
      log.error('[CalendarData] Failed to update progress', error);
      throw error;
    }
  }
}
