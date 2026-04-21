/**
 * Calendar State Management
 * Central store for calendar data and preferences
 */

import { Store } from '@core/state/Store';
import { storage } from '@core/storage/StorageManager';
import { log } from '@core/logger';
import { DEFAULT_CALENDAR_PREFERENCES, STORAGE_KEYS } from '@core/constants';
import type { AnimeEntry, CalendarPreferences } from '@core/types';

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
  countdownInterval: number | null;
}

const initialState: CalendarState = {
  entries: [],
  loading: false,
  error: null,
  lastUpdate: null,
  preferences: { ...DEFAULT_CALENDAR_PREFERENCES },
  selectedDay: null,
  countdownInterval: null,
};

export class CalendarStore extends Store<CalendarState> {
  constructor() {
    super(initialState);
    this.loadPreferences();
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
}

// Singleton instance
export const calendarStore = new CalendarStore();
