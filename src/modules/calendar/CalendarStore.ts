/**
 * @file CalendarStore.ts
 * @description Reactive calendar state with validated preferences and a disposable schedule cache.
 *
 * Manages anime entries, user preferences, and UI states.
 * Integrates with CacheService for high-performance schedule caching.
 *
 * @see Store.ts for the reactive base class
 */

import { injectable, inject } from 'tsyringe';
import { Store } from '@core/state/Store';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { logger } from '@core/logger';
import { DEFAULT_CALENDAR_PREFERENCES, STORAGE_KEYS, STORAGE_PREFIX, DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry, CalendarCustomPlan, CalendarPreferences } from '@core/types';
import { calendarPreferencePatch } from './CalendarPreferences';
import { calendarEntries, calendarFingerprint, isCalendarId } from './CalendarEntries';
import { isRecord } from '@/api/GraphQLResponse';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { calendarCustomPlans, customPlanEntry } from './CalendarCustomPlans';
import { CalendarSessionCacheClient } from './CalendarSessionCache';

/**
 * Structure for the in-memory calendar cache and consistency fingerprint
 */
interface CalendarCache {
  version: 1;
  entries: AnimeEntry[];
  fingerprint: string;
}
interface CalendarCacheScope { key: string; revision: number; context: ApiContext | undefined; assertCurrent: () => void; }

/**
 * Internal state structure for the CalendarStore
 */
interface CalendarState {
  /** All anime entries (schedule + user progress) */
  entries: AnimeEntry[];
  customPlans: CalendarCustomPlan[];
  customOwner: number | null;
  /** Global loading state */
  loading: boolean;
  /** Global error state */
  error: Error | null;
  /** Last time the data was refreshed from API */
  lastUpdate: Date | null;
  /** User-specific UI preferences */
  preferences: CalendarPreferences;
  /** Currently selected day in the UI */
  selectedDay: string | null;
  /** Set of day keys currently expanded in the grid */
  expandedDays: Set<string>;
  /** ID of the active countdown update interval */
  countdownInterval: number | null;
}

/** Initial state for the store */
const initialState: CalendarState = {
  entries: [],
  customPlans: [],
  customOwner: null,
  loading: false,
  error: null,
  lastUpdate: null,
  preferences: { ...DEFAULT_CALENDAR_PREFERENCES },
  selectedDay: null,
  expandedDays: new Set<string>(),
  countdownInterval: null,
};

/**
 * Centralized Store for the Calendar module.
 * Persists preferences and provides reactive state updates.
 */
@injectable()
export class CalendarStore extends Store<CalendarState> {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private preferenceWrites: Promise<void> = Promise.resolve();
  /** Dedicated in-memory cache for airing schedules */
  private scheduleCache: ICacheService<string, CalendarCache>;
  private cacheRevision = 0;
  private cacheWrites: Promise<void> = Promise.resolve();
  private customPlanWrites: Promise<void> = Promise.resolve();

  /**
   * @param storage Injected storage for preferences
   * @param cacheFactory Factory to create the schedule cache
   */
  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(CacheFactory) cacheFactory: CacheFactory,
    @inject(TOKENS.ApiClient) private api?: IApiClient,
    @inject(CalendarSessionCacheClient) private sessionCache: CalendarSessionCacheClient = new CalendarSessionCacheClient(),
  ) {
    super(initialState);

    this.scheduleCache = cacheFactory.create<string, CalendarCache>({
      namespace: 'calendar_schedule',
      maxSize: 1, // We only need the latest schedule
      ttlMs: 30 * 60 * 1000, // 30 minutes
      persistent: false,
    });
  }

  /**
   * Initializes the store by loading preferences from storage.
   * Safe to call multiple times (idempotent).
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    const pending = this.loadPreferences();
    this.initPromise = pending;
    try {
      await pending;
      this.initialized = true;
    } finally {
      if (this.initPromise === pending) this.initPromise = null;
    }
  }

  /**
   * Loads user preferences from persistent storage.
   */
  private async loadPreferences(): Promise<void> {
    try {
      const stored = await this.storage.get<unknown>(STORAGE_KEYS.CALENDAR_PREFS);
      if (stored) {
        this.setState({
          preferences: { ...DEFAULT_CALENDAR_PREFERENCES, ...calendarPreferencePatch(stored, true) },
        });
        logger.info('[CalendarStore] Preferences loaded');
      }
    } catch (error) {
      logger.error('[CalendarStore] Failed to load preferences', error);
      throw error;
    }
  }

  /**
   * Persists preferences and updates local state.
   */
  public async savePreferences(preferences: Partial<CalendarPreferences>): Promise<void> {
    // Capture at acceptance; the caller can change its object while storage is pending.
    const patch = calendarPreferencePatch(preferences);
    const operation = this.preferenceWrites.then(async () => {
      await this.init();
      // Merge into the stored record, not this tab's snapshot, so fields saved by other tabs survive.
      const stored = await this.storage.get<unknown>(STORAGE_KEYS.CALENDAR_PREFS);
      const newPreferences: CalendarPreferences = { ...DEFAULT_CALENDAR_PREFERENCES, ...(stored ? calendarPreferencePatch(stored, true) : {}), ...patch };
      if (!await this.storage.set(STORAGE_KEYS.CALENDAR_PREFS, { ...newPreferences })) {
        throw new Error('Calendar preferences could not be saved');
      }
      this.setState({ preferences: newPreferences });
      // This represents a durable shared preference change, independent of the editor's lifetime.
      window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
    });
    this.preferenceWrites = operation.catch(() => undefined);
    return operation;
  }

  /**
   * Resets all preferences to their default values.
   */
  public async resetPreferences(): Promise<void> {
    await this.savePreferences(DEFAULT_CALENDAR_PREFERENCES);
  }
  public setEntries(entries: AnimeEntry[]): void {
    this.setState({
      entries,
      lastUpdate: new Date(),
      error: null,
    });
  }

  public getCustomPlans(owner?: number): CalendarCustomPlan[] {
    const state = this.getState();
    if (owner !== undefined && state.customOwner !== owner) return [];
    return state.customPlans.map(plan => ({ ...plan }));
  }

  public async loadCustomPlans(owner: number): Promise<CalendarCustomPlan[]> {
    if (!isCalendarId(owner)) throw new Error('Invalid calendar owner');
    if (this.getState().customOwner === owner) return this.getCustomPlans(owner);
    const context = this.api ? await captureApiContext(this.api) : undefined;
    if (this.api) assertApiContext(this.api, context, owner);
    const stored = await this.storage.get<unknown>(`${STORAGE_PREFIX}calendar_custom_${owner}`);
    if (this.api) assertApiContext(this.api, context, owner);
    let plans: CalendarCustomPlan[];
    try { plans = stored == null ? [] : calendarCustomPlans(stored); }
    catch (error) {
      logger.warn('[CalendarStore] Ignoring invalid personal calendar plans without overwriting storage', error);
      plans = [];
    }
    const accountChanged = this.getState().customOwner !== null && this.getState().customOwner !== owner;
    this.setState({ customPlans: plans, customOwner: owner, ...(accountChanged ? { entries: [] } : {}) });
    return plans.map(plan => ({ ...plan }));
  }

  public clearCustomPlans(): void {
    const entries = this.getState().entries.filter(entry => entry.calendarKind !== 'personal');
    this.setState({ customPlans: [], customOwner: null, entries });
  }

  public async saveCustomPlan(owner: number, input: CalendarCustomPlan): Promise<void> {
    if (!isCalendarId(owner)) throw new Error('Invalid calendar owner');
    const plan = calendarCustomPlans([input])[0];
    const operation = this.customPlanWrites.then(async () => {
      if (this.getState().customOwner !== owner) await this.loadCustomPlans(owner);
      if (this.getState().customOwner !== owner) throw new Error('Calendar account changed');
      const context = this.api ? await captureApiContext(this.api) : undefined;
      if (this.api) assertApiContext(this.api, context, owner);
      // Apply only this plan to the stored list: another tab may have saved plans since this one loaded.
      const stored = await this.readStoredCustomPlans(owner);
      const plans = calendarCustomPlans([...stored.filter(item => item.mediaId !== plan.mediaId), plan]);
      if (this.api) assertApiContext(this.api, context, owner);
      if (!await this.storage.set(`${STORAGE_PREFIX}calendar_custom_${owner}`, plans)) throw new Error('Personal calendar plan could not be saved');
      if (this.api) assertApiContext(this.api, context, owner);
      if (this.getState().customOwner !== owner) throw new Error('Calendar account changed');
      this.setState({ customPlans: plans });
      this.syncPersonalEntry(plan);
    });
    this.customPlanWrites = operation.catch(() => undefined);
    return operation;
  }

  public async removeCustomPlan(owner: number, mediaId: number): Promise<void> {
    if (!isCalendarId(owner) || !isCalendarId(mediaId)) throw new Error('Invalid personal calendar plan');
    const operation = this.customPlanWrites.then(async () => {
      if (this.getState().customOwner !== owner) await this.loadCustomPlans(owner);
      if (this.getState().customOwner !== owner) throw new Error('Calendar account changed');
      const context = this.api ? await captureApiContext(this.api) : undefined;
      if (this.api) assertApiContext(this.api, context, owner);
      // Remove only this plan from the stored list, keeping plans saved by other tabs.
      const plans = (await this.readStoredCustomPlans(owner)).filter(item => item.mediaId !== mediaId);
      if (this.api) assertApiContext(this.api, context, owner);
      if (!await this.storage.set(`${STORAGE_PREFIX}calendar_custom_${owner}`, plans)) throw new Error('Personal calendar plan could not be saved');
      if (this.api) assertApiContext(this.api, context, owner);
      if (this.getState().customOwner !== owner) throw new Error('Calendar account changed');
      this.setState({ customPlans: plans,
        entries: this.getState().entries.filter(entry => !(entry.calendarKind === 'personal' && entry.mediaId === mediaId)) });
    });
    this.customPlanWrites = operation.catch(() => undefined);
    return operation;
  }

  /**
   * Reads the stored plan list that a write builds on. Invalid storage counts as empty for
   * this write only, matching the in-memory fallback used by loads.
   */
  private async readStoredCustomPlans(owner: number): Promise<CalendarCustomPlan[]> {
    const stored = await this.storage.get<unknown>(`${STORAGE_PREFIX}calendar_custom_${owner}`);
    if (stored == null) return [];
    try { return calendarCustomPlans(stored); }
    catch (error) {
      logger.warn('[CalendarStore] Ignoring invalid personal calendar plans during write', error);
      return [];
    }
  }

  private syncPersonalEntry(plan: CalendarCustomPlan): void {
    const current = this.getState().entries;
    const realEntry = current.find(entry => entry.mediaId === plan.mediaId && entry.calendarKind !== 'personal');
    const entries = current.filter(entry => !(entry.calendarKind === 'personal' && entry.mediaId === plan.mediaId));
    if (!realEntry && !(plan.totalEpisodes !== null && plan.progress >= plan.totalEpisodes)) {
      entries.push(customPlanEntry(plan, plan.mediaId, plan.progress));
    }
    this.setState({ entries });
  }

  public setLoading(loading: boolean): void {
    this.setState({ loading });
  }

  public setError(error: Error): void {
    this.setState({ error, loading: false });
  }

  public clearError(): void {
    this.setState({ error: null });
  }

  /**
   * Updates a specific entry by mediaId.
   */
  public updateEntry(mediaId: number, updates: Partial<AnimeEntry>): void {
    const entries = this.getState().entries.map((entry) =>
      entry.mediaId === mediaId ? { ...entry, ...updates } : entry
    );
    this.setState({ entries });
    const plan = this.getState().customPlans.find(item => item.mediaId === mediaId);
    if (plan && updates.progress !== undefined && this.getState().customOwner !== null) {
      const progress = updates.progress;
      const owner = this.getState().customOwner!;
      this.setState({ customPlans: this.getState().customPlans.map(item => item.mediaId === mediaId ? { ...item, progress } : item) });
      const persist = this.customPlanWrites.then(async () => {
        const context = this.api ? await captureApiContext(this.api) : undefined;
        if (this.api) assertApiContext(this.api, context, owner);
        // Apply only this progress change to the stored list, not to this tab's snapshot.
        const plans = (await this.readStoredCustomPlans(owner)).map(item => item.mediaId === mediaId ? { ...item, progress } : item);
        if (this.api) assertApiContext(this.api, context, owner);
        if (!await this.storage.set(`${STORAGE_PREFIX}calendar_custom_${owner}`, plans)) throw new Error('Personal calendar progress could not be saved');
        if (this.api) assertApiContext(this.api, context, owner);
        if (this.getState().customOwner === owner) this.setState({ customPlans: plans });
      });
      this.customPlanWrites = persist.catch(error => { logger.warn('[CalendarStore] Personal calendar progress persistence failed', error); });
    }
  }

  /**
   * Updates multiple entries at once using a Map of updates.
   * Efficiently performs a single state update.
   * 
   * @param updates Map of mediaId to partial entry updates
   */
  public updateEntriesBatch(updates: Map<number, Partial<AnimeEntry>>): void {
    const entries = this.getState().entries.map((entry) => {
      const update = updates.get(entry.mediaId);
      return update ? { ...entry, ...update } : entry;
    });
    this.setState({ entries });
  }

  /**
   * Toggles day expansion in the UI grid.
   */
  public toggleExpandedDay(day: string): void {
    const { expandedDays } = this.getState();
    const newExpandedDays = new Set(expandedDays);

    if (newExpandedDays.has(day)) {
      newExpandedDays.delete(day);
    } else {
      newExpandedDays.add(day);
    }

    this.setState({ expandedDays: newExpandedDays });
  }

  /**
   * Removes an entry by mediaId.
   * 
   * @param mediaId The ID to remove
   */
  public removeEntry(mediaId: number): void {
    const entries = this.getState().entries.filter(e => e.mediaId !== mediaId);
    this.setState({ entries });
  }

  /**
   * Manages the countdown update interval.
   */
  public startCountdownInterval(callback: () => void, intervalMs: number = 60000): void {
    this.stopCountdownInterval();
    const intervalId = window.setInterval(callback, intervalMs);
    this.setState({ countdownInterval: intervalId });
  }

  public stopCountdownInterval(): void {
    const { countdownInterval } = this.getState();
    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      this.setState({ countdownInterval: null });
    }
  }

  /**
   * Checks if the current state needs a refresh from the API.
   */
  public needsRefresh(maxAgeMs: number = 30 * 60 * 1000): boolean {
    const { lastUpdate } = this.getState();
    if (!lastUpdate) return true;
    return (Date.now() - lastUpdate.getTime()) > maxAgeMs;
  }

  /**
   * Groups entries by day of the week.
   * 
   * @returns Record mapping day name to its anime entries
   */
  public getEntriesByDay(): Record<string, AnimeEntry[]> {
    const { entries } = this.getState();
    const grouped: Record<string, AnimeEntry[]> = {};

    // Initialize groups
    DAYS_OF_WEEK.forEach((day: string) => {
      grouped[day] = [];
    });

    // Group by airingAt day
    entries.forEach(entry => {
      const dayIndex = entry.airingAt.getDay();
      const dayName = DAYS_OF_WEEK[dayIndex];
      if (grouped[dayName]) {
        grouped[dayName].push(entry);
      }
    });

    Object.values(grouped).forEach(dayEntries => dayEntries.sort((a, b) => a.airingAt.getTime() - b.airingAt.getTime()));

    return grouped;
  }

  // ─── Disposable, account/session-scoped schedule cache ─────────────────────

  private async cacheScope(userId: number | undefined, revision: number, assertCurrent: () => void): Promise<CalendarCacheScope> {
    if (userId !== undefined && !isCalendarId(userId)) throw new Error('Invalid calendar cache owner');
    assertCurrent();
    const captured = this.api ? await captureApiContext(this.api) : undefined;
    const context = captured ? { ...captured } : undefined;
    const scope = { key: JSON.stringify([revision, context?.sessionId ?? null, userId ?? context?.userId ?? null]), revision, context, assertCurrent };
    this.assertCacheScope(scope, userId);
    return scope;
  }

  private assertCacheScope(scope: CalendarCacheScope, owner?: number): void {
    if (this.api) assertApiContext(this.api, scope.context, owner);
    if (scope.revision !== this.cacheRevision) throw new Error('Calendar cache changed');
    scope.assertCurrent();
  }

  /**
   * @param queueRevision Sync queue revision the entries reflect. Only with it is the
   *   schedule also kept for the browser session, so later page loads can reuse it.
   */
  public async saveEntriesToCache(entries: AnimeEntry[], userId?: number, assertCurrent: () => void = () => {}, queueRevision?: string): Promise<void> {
    const snapshot = calendarEntries(entries);
    const revision = this.cacheRevision;
    // Register in acceptance order, even when context initialization resolves out of order.
    const prepared = this.cacheScope(userId, revision, assertCurrent).then(scope => ({ scope }), (error: unknown) => ({ error }));
    const operation = this.cacheWrites.then(async () => {
      const ready = await prepared;
      if ('error' in ready) throw ready.error;
      const scope = ready.scope;
      this.assertCacheScope(scope, userId);
      const value: CalendarCache = { version: 1, entries: snapshot, fingerprint: calendarFingerprint(snapshot) };
      const sessionId = scope.context?.sessionId;
      const validateCompletedWrite = async (): Promise<void> => {
        try { this.assertCacheScope(scope, userId); }
        catch (error) {
          await this.scheduleCache.delete(scope.key).catch(failure => logger.error('[CalendarStore] Obsolete cache removal failed', failure));
          if (queueRevision && sessionId) await this.clearSessionCache(sessionId);
          throw error;
        }
      };
      try { await this.scheduleCache.set(scope.key, value); }
      catch (error) { await validateCompletedWrite(); throw error; }
      await validateCompletedWrite();
      if (!queueRevision || !sessionId) return;
      try {
        await this.sessionCache.write(sessionId, { queueRevision, fingerprint: value.fingerprint, entries: JSON.parse(JSON.stringify(snapshot)) });
      } catch (error) { logger.warn('[CalendarStore] Session cache write failed', error); }
      await validateCompletedWrite();
    });
    this.cacheWrites = operation.catch(() => undefined);
    await operation;
  }

  /**
   * @param queueRevision Current sync queue revision. A memory miss falls back to the
   *   browser-session copy only when that copy was written at this same revision.
   */
  public async loadEntriesFromCache(userId?: number, assertCurrent: () => void = () => {}, queueRevision?: string): Promise<AnimeEntry[] | null> {
    const scope = await this.cacheScope(userId, this.cacheRevision, assertCurrent);
    const value: unknown = await this.scheduleCache.get(scope.key);
    this.assertCacheScope(scope, userId);
    if (value === undefined || value === null) return this.loadSessionEntries(scope, userId, queueRevision);
    try {
      if (!isRecord(value) || value.version !== 1 || typeof value.fingerprint !== 'string') throw new Error('Invalid calendar cache');
      const entries = calendarEntries(value.entries);
      if (calendarFingerprint(entries) !== value.fingerprint) throw new Error('Calendar cache fingerprint mismatch');
      return entries;
    } catch (error) {
      logger.warn('[CalendarStore] Discarding invalid calendar cache', error);
      await this.scheduleCache.delete(scope.key).catch(failure => logger.error('[CalendarStore] Invalid cache removal failed', failure));
      this.assertCacheScope(scope, userId);
      return null;
    }
  }

  /**
   * @param scope 'memory' keeps the browser-session copy. Only safe when no change is
   *   known, because that copy is revision-checked on every read anyway.
   */
  public async invalidateCache(scope: 'all' | 'memory' = 'all'): Promise<void> {
    // Advance before awaiting clear: older reads/writes cannot restore this generation.
    this.cacheRevision++;
    const sessionId = this.api?.getContext?.().sessionId;
    await Promise.all([this.scheduleCache.clear(), scope === 'all' && sessionId ? this.clearSessionCache(sessionId) : undefined]);
    logger.debug('[CalendarStore] Schedule cache invalidated');
  }

  private async loadSessionEntries(scope: CalendarCacheScope, userId: number | undefined, queueRevision: string | undefined): Promise<AnimeEntry[] | null> {
    const sessionId = scope.context?.sessionId;
    if (!queueRevision || !sessionId) return null;
    let stored;
    try { stored = await this.sessionCache.read(sessionId); }
    catch (error) { logger.warn('[CalendarStore] Session cache read failed', error); }
    this.assertCacheScope(scope, userId);
    if (!stored || stored.queueRevision !== queueRevision) return null;
    try {
      const entries = calendarEntries(stored.entries);
      if (calendarFingerprint(entries) !== stored.fingerprint) throw new Error('Calendar session cache fingerprint mismatch');
      await this.scheduleCache.set(scope.key, { version: 1, entries: calendarEntries(entries), fingerprint: stored.fingerprint });
      this.assertCacheScope(scope, userId);
      logger.debug('[CalendarStore] Schedule restored from session cache');
      return entries;
    } catch (error) {
      this.assertCacheScope(scope, userId);
      logger.warn('[CalendarStore] Discarding invalid session calendar cache', error);
      await this.clearSessionCache(sessionId);
      return null;
    }
  }

  private async clearSessionCache(sessionId: string): Promise<void> {
    try { await this.sessionCache.clear(sessionId); }
    catch (error) { logger.warn('[CalendarStore] Session cache clear failed', error); }
  }
}
