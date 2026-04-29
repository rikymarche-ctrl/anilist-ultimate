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
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';

@injectable()
export class CalendarDataService {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.CalendarService) private calendarService: CalendarService,
    @inject(TOKENS.ToastService) private toastService: any
  ) {}

  /**
   * Load airing schedule for the user with intelligent caching
   * Tries cache first, falls back to API if stale/missing
   */
  public async loadSchedule(userId: number, forceRefresh: boolean = false): Promise<void> {
    try {
      calendarStore.setLoading(true);

      // Try loading from cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedEntries = await calendarStore.loadEntriesFromCache();
        if (cachedEntries) {
          calendarStore.setEntries(cachedEntries);
          log.success(`[CalendarData] Loaded ${cachedEntries.length} entries from cache`);

          // Emit global event
          this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
            scheduleCount: cachedEntries.length,
            progressCount: cachedEntries.filter((e: any) => e.progress !== undefined).length,
            timestamp: new Date(),
            fromCache: true,
          });

          return;
        }
      }

      // Cache miss or force refresh - fetch from API
      log.info('[CalendarData] Fetching fresh schedule from API');
      const entries = await this.calendarService.fetchAiringSchedule(userId);
      calendarStore.setEntries(entries);

      // Save to cache for future loads
      await calendarStore.saveEntriesToCache(entries);

      log.success(`[CalendarData] Loaded ${entries.length} anime entries (fresh fetch)`);

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
      const state = calendarStore.getState();
      if (state.entries.length === 0) {
        log.info('[CalendarData] Attempting stale cache fallback after API failure...');
        const staleEntries = await calendarStore.loadEntriesFromCache(true);
        if (staleEntries) {
          calendarStore.setEntries(staleEntries);
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

      calendarStore.setError(error as Error);
      throw error;
    } finally {
      calendarStore.setLoading(false);
    }
  }

  /**
   * Mark an episode as watched
   * Invalidates cache to ensure fresh data on next load
   */
  public async updateProgress(mediaId: number): Promise<number | null> {
    try {
      const entry = calendarStore.getState().entries.find(e => e.mediaId === mediaId);
      if (!entry) throw new Error('Entry not found');

      const newProgress = (entry.progress || 0) + 1;
      await this.calendarService.updateProgress(mediaId, newProgress);

      // Update local state
      calendarStore.updateEntry(mediaId, { progress: newProgress });
      this.toastService.success(`Updated progress for ${entry.title}.`);

      // Invalidate cache since progress changed
      await calendarStore.invalidateCache();
      log.debug('[CalendarData] Cache invalidated after progress update');

      // Emit progression event
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        animeId: mediaId,
        progress: newProgress,
        timestamp: new Date(),
      });

      return newProgress;
    } catch (error) {
      log.error('[CalendarData] Failed to update progress', error);
      throw error;
    }
  }
}
