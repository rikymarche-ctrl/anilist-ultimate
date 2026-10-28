/**
 * @file CalendarDataService.ts
 * @description Service layer for loading airing schedules with intelligent caching
 *
 * Fetches airing schedule and user anime list via the API client,
 * merges them through CalendarService, and stores results in CalendarStore.
 * Uses a disposable in-memory cache with fingerprint validation to reduce API calls.
 *
 * Caching:
 *   - Checks CalendarStore.loadEntriesFromCache(userId) before API call
 *   - TTL 30 minutes with fingerprint validation
 *   - Auto-invalidates cache on progress updates
 *   - forceRefresh parameter bypasses cache
 *
 * @see CalendarService.ts for data transformation
 * @see CalendarStore.ts for the disposable schedule cache and persistent preferences
 * @see docs/MODULES.md#1-calendar-module
 * @see docs/PERFORMANCE.md for caching metrics
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CalendarService } from '../CalendarService';
import { CalendarStore } from '../CalendarStore';
import { logger } from '@core/logger';
import type { ToastService } from '@core/services/ToastService';
import type { AnimeEntry } from '@core/types';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { syncQueueSnapshot } from '@core/services/SyncQueueSnapshot';
import { calendarEntries, isCalendarId } from '../CalendarEntries';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { customPlanEntry } from '../CalendarCustomPlans';

@injectable()
export class CalendarDataService {
  private loadVersion = 0;
  private accountVersion = 0;
  private queueRevision: string | null = null;
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.CalendarService) private calendarService: CalendarService,
    @inject(TOKENS.ToastService) private toastService: ToastService,
    @inject(TOKENS.CalendarStore) private calendarStore: CalendarStore,
    @inject(TOKENS.ApiClient) private api?: IApiClient,
    @inject(TOKENS.SyncQueue) private syncQueue?: ISyncQueueService,
  ) {
    this.eventBus.on?.(EVENT_TYPES.AUTH_STATE_CHANGED, () => { this.accountVersion++; this.loadVersion++; this.queueRevision = null; this.calendarStore.setEntries([]); this.calendarStore.clearCustomPlans(); this.calendarStore.setLoading(false); });
    this.eventBus.on?.(EVENT_TYPES.SYNC_QUEUE_CHANGED, () => {
      // Only a signal crosses contexts; private payloads remain behind the queue protocol.
      this.queueRevision = null; this.loadVersion++;
      this.calendarStore.setLoading(false);
      void this.calendarStore.invalidateCache().catch(error => logger.warn('[CalendarData] Disposable cache clear failed', error));
    });
    this.eventBus.on?.(EVENT_TYPES.PROGRESS_UPDATED, payload => {
      if (!payload || !isCalendarId(payload.userId) || !isCalendarId(payload.mediaId)
        || !Number.isInteger(payload.progress) || payload.progress < 0 || payload.progress > 2147483647
        || this.api?.getContext?.().userId !== payload.userId) return;
      // Quick Edit and other views also publish accepted progress changes.
      this.loadVersion++;
      this.calendarStore.setLoading(false);
      void this.calendarStore.invalidateCache().catch(error => logger.warn('[CalendarData] Disposable cache clear failed', error));
    });
  }

  /**
   * Load airing schedule for the current account
   * Tries cache first, falls back to API if expired/missing
   */
  public async loadSchedule(userId: number, forceRefresh: boolean = false): Promise<void> {
    if (!isCalendarId(userId)) throw new Error('Invalid calendar owner');
    const version = ++this.loadVersion;
    const customPlans = this.calendarStore.getCustomPlans(userId);
    let context: ApiContext | undefined;
    let contextReady = false;
    let queueReady = !this.syncQueue;
    const assertCurrent = () => {
      if (this.api && contextReady) assertApiContext(this.api, context, userId);
      if (version !== this.loadVersion) throw new Error('Calendar request superseded');
    };
    const readCache = async (): Promise<AnimeEntry[] | null> => {
      try {
        const cached = await this.calendarStore.loadEntriesFromCache(userId, assertCurrent, this.queueRevision ?? undefined);
        assertCurrent();
        if (cached === null || cached === undefined) return null;
        const cachedEntries = calendarEntries(cached);
        // A cached personal row keeps the progress it was cached with; the plan supplies only rows that are not cached.
        const cachedPersonal = new Map(cachedEntries.filter(entry => entry.calendarKind === 'personal').map(entry => [entry.mediaId, entry]));
        const entries = cachedEntries.filter(entry => entry.calendarKind !== 'personal');
        const present = new Set(entries.map(entry => entry.mediaId));
        for (const plan of customPlans) {
          if (present.has(plan.mediaId)) continue;
          const cachedPlan = cachedPersonal.get(plan.mediaId);
          const progress = cachedPlan?.progress ?? plan.progress;
          if (plan.totalEpisodes !== null && progress >= plan.totalEpisodes) continue;
          entries.push(cachedPlan ?? customPlanEntry(plan, plan.mediaId, plan.progress));
        }
        return entries;
      } catch (error) {
        assertCurrent();
        logger.warn('[CalendarData] Disposable cache read failed', error);
        return null;
      }
    };
    const publish = (entries: AnimeEntry[], fromCache: boolean): void => {
      assertCurrent();
      // Store listeners receive their own graph, separate from API and cache input.
      this.calendarStore.setEntries(calendarEntries(entries));
      assertCurrent();
      this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
        scheduleCount: entries.length, progressCount: entries.filter(entry => entry.progress !== undefined).length,
        timestamp: new Date(), fromCache,
      });
    };
    try {
      this.calendarStore.setLoading(true);
      const captured = this.api ? await captureApiContext(this.api) : undefined;
      context = captured ? { ...captured } : undefined;
      contextReady = true;
      assertCurrent();
      await this.checkQueueRevision(assertCurrent);
      queueReady = true;
      if (!forceRefresh) {
        const cached = await readCache();
        if (cached !== null && await this.checkQueueRevision(assertCurrent)) { publish(cached, true); return; }
      }
      assertCurrent();
      // With nothing on screen the user is watching a skeleton, so the first read takes the
      // priority lane instead of queueing behind other modules' background reads (which can
      // exhaust the per-minute budget on page load). Refreshes of a visible grid stay background.
      const requestOptions = { priority: this.calendarStore.getState().entries.length === 0 };
      for (let attempt = 0; attempt < 3; attempt++) {
        assertCurrent();
        const entries = calendarEntries(await this.calendarService.fetchAiringSchedule(userId, customPlans, requestOptions));
        assertCurrent();
        try { await this.calendarStore.saveEntriesToCache(entries, userId, assertCurrent, this.queueRevision ?? undefined); }
        catch (error) { assertCurrent(); logger.warn('[CalendarData] Disposable cache write failed', error); }
        if (!(await this.checkQueueRevision(assertCurrent))) continue;
        publish(entries, false); return;
      }
      throw new Error('Calendar changed during loading; please retry');
    } catch (error) {
      assertCurrent();
      // No fallback can be attributed to an account whose initialization failed.
      if (contextReady && queueReady && this.calendarStore.getState().entries.length === 0) {
        try {
          await this.checkQueueRevision(assertCurrent);
          const cached = await readCache();
          if (cached !== null && await this.checkQueueRevision(assertCurrent)) { publish(cached, true); return; }
        } catch (fallbackError) {
          assertCurrent();
          logger.warn('[CalendarData] Safe cache fallback unavailable', fallbackError);
        }
      }
      this.calendarStore.setError(error instanceof Error ? error : new Error('Calendar load failed'));
      throw error;
    } finally {
      if (version === this.loadVersion) this.calendarStore.setLoading(false);
    }
  }

  /** Revalidate cached reads and publication after asynchronous cache writes. */
  private async checkQueueRevision(assertCurrent: () => void): Promise<boolean> {
    if (!this.syncQueue) return true;
    const snapshot = syncQueueSnapshot(await this.syncQueue.getSnapshot());
    assertCurrent();
    if (this.queueRevision === snapshot.revision) return true;
    // The first revision seen by this page is not a change: the session copy is checked against it on read.
    try { await this.calendarStore.invalidateCache(this.queueRevision === null ? 'memory' : 'all'); }
    catch (error) { logger.warn('[CalendarData] Disposable cache clear failed', error); }
    assertCurrent(); this.queueRevision = snapshot.revision;
    return false;
  }

  /**
   * Mark an episode as watched
   * Invalidates cache to ensure fresh data on next load
   */
  public async updateProgress(mediaId: number): Promise<number | null> {
    let accepted = false;
    try {
      const entry = this.calendarStore.getState().entries.find((e: AnimeEntry) => e.mediaId === mediaId);
      if (!entry) throw new Error('Entry not found');

      const version = this.accountVersion;
      const context = this.api ? await captureApiContext(this.api) : undefined;
      if (this.api) assertApiContext(this.api, context);
      if (version !== this.accountVersion) throw new Error('Calendar account changed');
      const result = await this.calendarService.incrementProgress(mediaId);
      if (this.api) assertApiContext(this.api, context, result.userId);
      if (version !== this.accountVersion) throw new Error('Calendar account changed');
      const newProgress = result.progress;

      // An earlier schedule response must not replace the accepted progress.
      this.loadVersion++;
      this.calendarStore.setLoading(false);
      // Update local state
      this.calendarStore.updateEntry(mediaId, { progress: newProgress });
      accepted = true;
      this.toastService.success(`Updated progress for ${entry.title}.`, { mediaId, progress: newProgress });

      this.eventBus.emit(EVENT_TYPES.EPISODE_MARKED_WATCHED, {
        mediaId,
        episodeNumber: newProgress,
        userId: result.userId,
        timestamp: new Date(),
      });

      // Invalidate cache since progress changed
      try { await this.calendarStore.invalidateCache(); }
      catch (error) { logger.warn('[CalendarData] Disposable cache clear failed', error); }
      if (this.api) assertApiContext(this.api, context, result.userId);
      if (version !== this.accountVersion) throw new Error('Calendar account changed');
      logger.debug('[CalendarData] Cache invalidated after progress update');

      return newProgress;
    } catch (error) {
      logger.error('[CalendarData] Failed to update progress', error);
      // Failures after the progress was accepted must not read as "not marked watched".
      if (!accepted) this.toastService.error('Could not mark this episode as watched. Please try again.', { mediaId });
      throw error;
    }
  }
}
