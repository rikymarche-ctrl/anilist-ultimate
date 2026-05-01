import { injectable } from 'tsyringe';
/**
 * @file CalendarStore.ts
 * @description Central reactive store for calendar state with intelligent caching
 *
 * Extends Store<CalendarStoreState> to manage:
 *   - Anime entries (schedule + progress merged)
 *   - Loading/error UI state
 *   - User preferences (layout, time format, social toggles)
 *   - Persistent cache with fingerprint-based invalidation
 *
 * Intelligent Caching:
 *   - Persists entries to chrome.storage.local
 *   - TTL 30 minutes
 *   - Fingerprint validation (mediaId + airingAt hash)
 *   - Auto-invalidation on progress updates
 *
 * @see Store.ts for the reactive base class
 * @see docs/MODULES.md#1-calendar-module
 */

import { Store } from '@core/state/Store';
import { storage } from '@core/storage/StorageManager';
import { log } from '@core/logger';
import { DEFAULT_CALENDAR_PREFERENCES, STORAGE_KEYS } from '@core/constants';
import type { AnimeEntry, CalendarPreferences } from '@core/types';

interface CalendarCache {
  entries: AnimeEntry[];
  fingerprint: string;
  timestamp: number;
}

interface CalendarState {
  // Data
  entries: AnimeEntry[];
  loading: boolean;
  error: Error | null;
  lastUpdate: Date | null;

  // User preferences
  preferences: CalendarPreferences;

  // UI state
  selectedDay: string | null;
  expandedDays: Set<string>;
  countdownInterval: number | null;
}

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

@injectable()
export class CalendarStore extends Store<CalendarState> {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    super(initialState);
    // Don't call async methods in constructor - violates constructor contract
  }

  /**
   * Initialize the store - MUST be called before using the store
   * Safe to call multiple times (idempotent)
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadPreferences();
    await this.initPromise;
    this.initialized = true;
  }

  /**
   * Load preferences from storage
   */
  private async loadPreferences(): Promise<void> {
    try {
      const stored = await storage.get<CalendarPreferences>(STORAGE_KEYS.CALENDAR_PREFS);

      if (stored) {
        this.setState({
          preferences: { ...DEFAULT_CALENDAR_PREFERENCES, ...stored },
        });
        log.info('Calendar preferences loaded', stored);
      }
    } catch (error) {
      log.error('Failed to load calendar preferences', error);
    }
  }

  /**
   * Save preferences to storage
   */
  async savePreferences(preferences: Partial<CalendarPreferences>): Promise<void> {
    const newPreferences = { ...this.getState().preferences, ...preferences };

    this.setState({ preferences: newPreferences });

    try {
      await storage.set(STORAGE_KEYS.CALENDAR_PREFS, newPreferences);
      log.success('Calendar preferences saved');
    } catch (error) {
      log.error('Failed to save calendar preferences', error);
    }
  }

  /**
   * Set anime entries
   */
  setEntries(entries: AnimeEntry[]): void {
    this.setState({
      entries,
      lastUpdate: new Date(),
      error: null,
    });
  }

  /**
   * Set loading state
   */
  setLoading(loading: boolean): void {
    this.setState({ loading });
  }

  /**
   * Set error state
   */
  setError(error: Error): void {
    this.setState({ error, loading: false });
  }

  /**
   * Clear error
   */
  clearError(): void {
    this.setState({ error: null });
  }

  /**
   * Update a single anime entry
   */
  updateEntry(mediaId: number, updates: Partial<AnimeEntry>): void {
    const entries = this.getState().entries.map((entry) =>
      entry.mediaId === mediaId ? { ...entry, ...updates } : entry
    );

    this.setState({ entries });
  }

  /**
   * Update multiple entries at once
   */
  updateEntriesBatch(updatesMap: Map<number, Partial<AnimeEntry>>): void {
    const entries = this.getState().entries.map((entry) => {
      const updates = updatesMap.get(entry.mediaId);
      return updates ? { ...entry, ...updates } : entry;
    });

    this.setState({ entries });
  }

  /**
   * Remove an entry
   */
  removeEntry(mediaId: number): void {
    const entries = this.getState().entries.filter((entry) => entry.mediaId !== mediaId);
    this.setState({ entries });
  }

  /**
   * Toggle expanded state for a specific day
   */
  toggleExpandedDay(day: string): void {
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
   * Set selected day
   */
  setSelectedDay(day: string | null): void {
    this.setState({ selectedDay: day });
  }

  /**
   * Update layout mode
   */
  setLayoutMode(layoutMode: CalendarPreferences['layoutMode']): void {
    this.savePreferences({ layoutMode });
  }

  /**
   * Update time format
   */
  setTimeFormat(timeFormat: CalendarPreferences['timeFormat']): void {
    this.savePreferences({ timeFormat });
  }

  /**
   * Toggle show time
   */
  toggleShowTime(): void {
    const { showTime } = this.getState().preferences;
    this.savePreferences({ showTime: !showTime });
  }

  /**
   * Toggle show episode numbers
   */
  toggleShowEpisodeNumbers(): void {
    const { showEpisodeNumbers } = this.getState().preferences;
    this.savePreferences({ showEpisodeNumbers: !showEpisodeNumbers });
  }

  /**
   * Toggle hide empty days
   */
  toggleHideEmptyDays(): void {
    const { hideEmptyDays } = this.getState().preferences;
    this.savePreferences({ hideEmptyDays: !hideEmptyDays });
  }

  /**
   * Set start day
   */
  setStartDay(startDay: CalendarPreferences['startDay']): void {
    this.savePreferences({ startDay });
  }

  /**
   * Set title alignment
   */
  setTitleAlignment(titleAlignment: CalendarPreferences['titleAlignment']): void {
    this.savePreferences({ titleAlignment });
  }

  /**
   * Set column justification
   */
  setColumnJustify(columnJustify: CalendarPreferences['columnJustify']): void {
    this.savePreferences({ columnJustify });
  }

  /**
   * Toggle full width images
   */
  toggleFullWidthImages(): void {
    const { fullWidthImages } = this.getState().preferences;
    this.savePreferences({ fullWidthImages: !fullWidthImages });
  }

  /**
   * Set max cards per day
   */
  setMaxCardsPerDay(maxCardsPerDay: number): void {
    this.savePreferences({ maxCardsPerDay });
  }

  /**
   * Start countdown update interval
   */
  startCountdownInterval(callback: () => void, intervalMs: number = 60000): void {
    // Clear existing interval
    this.stopCountdownInterval();

    const intervalId = window.setInterval(callback, intervalMs);
    this.setState({ countdownInterval: intervalId });

    log.debug('Countdown interval started');
  }

  /**
   * Stop countdown update interval
   */
  stopCountdownInterval(): void {
    const { countdownInterval } = this.getState();

    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      this.setState({ countdownInterval: null });
      log.debug('Countdown interval stopped');
    }
  }

  /**
   * Reset to default preferences
   */
  async resetPreferences(): Promise<void> {
    this.setState({ preferences: { ...DEFAULT_CALENDAR_PREFERENCES } });

    try {
      await storage.set(STORAGE_KEYS.CALENDAR_PREFS, DEFAULT_CALENDAR_PREFERENCES);
      log.success('Calendar preferences reset to defaults');
    } catch (error) {
      log.error('Failed to reset preferences', error);
    }
  }

  /**
   * Get entries grouped by day
   */
  getEntriesByDay(): Record<string, AnimeEntry[]> {
    const { entries } = this.getState();
    const grouped: Record<string, AnimeEntry[]> = {
      Sunday: [],
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
    };

    entries.forEach((entry) => {
      grouped[entry.dayOfWeek].push(entry);
    });

    return grouped;
  }

  /**
   * Get entries for a specific day
   */
  getEntriesForDay(day: string): AnimeEntry[] {
    return this.getState().entries.filter((entry) => entry.dayOfWeek === day);
  }

  /**
   * Check if data needs refresh
   */
  needsRefresh(maxAgeMs: number = 30 * 60 * 1000): boolean {
    const { lastUpdate } = this.getState();

    if (!lastUpdate) return true;

    const age = Date.now() - lastUpdate.getTime();
    return age > maxAgeMs;
  }

  // ─── Intelligent Caching with Fingerprint Validation ─────────────────────

  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Generate fingerprint from entries (mediaId + airingAt)
   * Used to detect if schedule data has changed
   */
  private generateFingerprint(entries: AnimeEntry[]): string {
    if (entries.length === 0) return '';

    // Sort by mediaId for consistent fingerprinting
    const sorted = entries.slice().sort((a, b) => a.mediaId - b.mediaId);

    // Create hash from mediaId + airingAt timestamp
    const data = sorted.map(e => `${e.mediaId}:${e.airingAt.getTime()}`).join('|');

    // Simple hash function (FNV-1a)
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Save entries to persistent cache with fingerprint
   */
  async saveEntriesToCache(entries: AnimeEntry[]): Promise<void> {
    try {
      const fingerprint = this.generateFingerprint(entries);
      const cache: CalendarCache = {
        entries,
        fingerprint,
        timestamp: Date.now(),
      };

      await storage.set(STORAGE_KEYS.CACHE_SCHEDULE, cache);
      log.debug(`[CalendarStore] Cached ${entries.length} entries with fingerprint ${fingerprint}`);
    } catch (error) {
      log.error('[CalendarStore] Failed to save cache', error);
    }
  }

  /**
   * Load entries from cache if valid and fresh
   * Returns null if cache is missing or corrupted
   * @param allowStale If true, returns data even if TTL has expired
   */
  async loadEntriesFromCache(allowStale: boolean = false): Promise<AnimeEntry[] | null> {
    try {
      const cache = await storage.get<CalendarCache>(STORAGE_KEYS.CACHE_SCHEDULE);

      if (!cache || !cache.entries || !cache.timestamp || !cache.fingerprint) {
        log.debug('[CalendarStore] No valid cache found');
        return null;
      }

      // Check TTL
      const age = Date.now() - cache.timestamp;
      if (!allowStale && age > this.CACHE_TTL_MS) {
        log.debug(`[CalendarStore] Cache expired (${Math.round(age / 60000)}min old)`);
        return null;
      }

      if (allowStale && age > this.CACHE_TTL_MS) {
        log.info(`[CalendarStore] Using stale cache (${Math.round(age / 60000)}min old) as fallback`);
      }

      // Validate fingerprint matches (optional paranoia check)
      const currentFingerprint = this.generateFingerprint(cache.entries);
      if (currentFingerprint !== cache.fingerprint) {
        log.warn('[CalendarStore] Cache fingerprint mismatch - data corrupted?');
        return null;
      }

      log.info(`[CalendarStore] Loaded ${cache.entries.length} entries from cache (${Math.round(age / 1000)}s old)`);
      return cache.entries;
    } catch (error) {
      log.error('[CalendarStore] Failed to load cache', error);
      return null;
    }
  }

  /**
   * Invalidate cache (e.g., after progress update)
   */
  async invalidateCache(): Promise<void> {
    try {
      await storage.remove(STORAGE_KEYS.CACHE_SCHEDULE);
      log.info('[CalendarStore] Cache invalidated');
    } catch (error) {
      log.error('[CalendarStore] Failed to invalidate cache', error);
    }
  }

  /**
   * Check if cached data fingerprint matches new data
   * Returns true if data is identical (no need to refetch)
   */
  async isCacheFingerprintMatch(newEntries: AnimeEntry[]): Promise<boolean> {
    try {
      const cache = await storage.get<CalendarCache>(STORAGE_KEYS.CACHE_SCHEDULE);
      if (!cache || !cache.fingerprint) return false;

      const newFingerprint = this.generateFingerprint(newEntries);
      return newFingerprint === cache.fingerprint;
    } catch (error) {
      log.error('[CalendarStore] Failed to check fingerprint', error);
      return false;
    }
  }
}

// Singleton instance
export const calendarStore = new CalendarStore();
