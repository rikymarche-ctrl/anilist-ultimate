/**
 * @file CalendarStore.ts
 * @description Enterprise-grade reactive store for calendar state with automated persistent caching.
 *
 * Manages anime entries, user preferences, and UI states.
 * Integrates with CacheService for high-performance schedule persistence.
 *
 * @see Store.ts for the reactive base class
 */

import { injectable, inject } from 'tsyringe';
import { Store } from '@core/state/Store';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { log } from '@core/logger';
import { DEFAULT_CALENDAR_PREFERENCES, STORAGE_KEYS, DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry, CalendarPreferences } from '@core/types';

/**
 * Structure for persistent calendar cache including integrity fingerprint
 */
interface CalendarCache {
  entries: AnimeEntry[];
  fingerprint: string;
}

/**
 * Internal state structure for the CalendarStore
 */
interface CalendarState {
  /** All anime entries (schedule + user progress) */
  entries: AnimeEntry[];
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
 * Implements persistent state and reactive updates.
 */
@injectable()
export class CalendarStore extends Store<CalendarState> {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  /** Dedicated persistent cache for airing schedules */
  private scheduleCache: ICacheService<string, CalendarCache>;

  /**
   * @param storage Injected storage for preferences
   * @param cacheFactory Factory to create the schedule cache
   */
  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(CacheFactory) cacheFactory: CacheFactory
  ) {
    super(initialState);

    this.scheduleCache = cacheFactory.create<string, CalendarCache>({
      namespace: 'calendar_schedule',
      maxSize: 1, // We only need the latest schedule
      ttlMs: 30 * 60 * 1000 // 30 minutes
    });
  }

  /**
   * Initializes the store by loading preferences from storage.
   * Safe to call multiple times (idempotent).
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadPreferences();
    await this.initPromise;
    this.initialized = true;
  }

  /**
   * Loads user preferences from persistent storage.
   */
  private async loadPreferences(): Promise<void> {
    try {
      const stored = await this.storage.get<CalendarPreferences>(STORAGE_KEYS.CALENDAR_PREFS);
      if (stored) {
        this.setState({
          preferences: { ...DEFAULT_CALENDAR_PREFERENCES, ...stored },
        });
        log.info('[CalendarStore] Preferences loaded');
      }
    } catch (error) {
      log.error('[CalendarStore] Failed to load preferences', error);
    }
  }

  /**
   * Persists preferences and updates local state.
   */
  public async savePreferences(preferences: Partial<CalendarPreferences>): Promise<void> {
    const newPreferences = { ...this.getState().preferences, ...preferences };
    this.setState({ preferences: newPreferences });

    try {
      await this.storage.set(STORAGE_KEYS.CALENDAR_PREFS, newPreferences);
    } catch (error) {
      log.error('[CalendarStore] Failed to save preferences', error);
    }
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

    return grouped;
  }

  // ─── Persistent Cache Management ──────────────────────────────────────────

  /**
   * Generates a unique fingerprint for a schedule to validate cache integrity.
   * Based on media IDs and airing timestamps.
   */
  private generateFingerprint(entries: AnimeEntry[]): string {
    if (entries.length === 0) return '';
    const sorted = entries.slice().sort((a, b) => a.mediaId - b.mediaId);
    
    const data = sorted.map(e => {
      // Handle both Date objects (live state) and strings (raw cache data)
      const time = e.airingAt instanceof Date 
        ? e.airingAt.getTime() 
        : new Date(e.airingAt).getTime();
        
      return `${e.mediaId}:${time}`;
    }).join('|');
 
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Persists airing schedule to the unified cache service.
   */
  public async saveEntriesToCache(entries: AnimeEntry[]): Promise<void> {
    const fingerprint = this.generateFingerprint(entries);
    await this.scheduleCache.set('main_schedule', { entries, fingerprint });
    log.debug(`[CalendarStore] Schedule cached with fingerprint: ${fingerprint}`);
  }

  /**
   * Loads entries from persistent cache with integrity check.
   */
  public async loadEntriesFromCache(): Promise<AnimeEntry[] | null> {
    const cache = await this.scheduleCache.get('main_schedule');
    if (!cache) return null;

    // Verify fingerprint integrity
    const currentFingerprint = this.generateFingerprint(cache.entries);
    if (currentFingerprint !== cache.fingerprint) {
      log.warn('[CalendarStore] Cache fingerprint mismatch. Invalidating.');
      await this.invalidateCache();
      return null;
    }

    log.info(`[CalendarStore] Loaded ${cache.entries.length} entries from persistent cache`);

    // Hydrate Date objects after JSON restoration
    return cache.entries.map(entry => ({
      ...entry,
      airingAt: new Date(entry.airingAt)
    }));
  }

  /**
   * Invalidates the persistent schedule cache.
   */
  public async invalidateCache(): Promise<void> {
    await this.scheduleCache.clear();
    log.info('[CalendarStore] Schedule cache invalidated');
  }
}

/**
 * Global singleton instance for non-injectable UI components.
 * Resolved through the centralized DI container to maintain singleton integrity.
 */
import { container } from 'tsyringe';

let _instance: CalendarStore | null = null;
export const calendarStore = new Proxy({} as CalendarStore, {
  get: (_, prop: keyof CalendarStore) => {
    if (!_instance) {
      _instance = container.resolve<CalendarStore>(TOKENS.CalendarStore);
    }
    const val = _instance[prop];
    return typeof val === 'function' ? val.bind(_instance) : val;
  }
});
