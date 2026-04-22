/**
 * Calendar Grid Component
 * Main calendar UI - orchestrates day columns
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { DayColumn } from './DayColumn';
import { CalendarSkeleton } from './CalendarSkeleton';
import { calendarStore } from '../CalendarStore';
import { DAYS_OF_WEEK, TIME } from '@core/constants';
import { log } from '@core/logger';
import type { CardOptions } from '@core/types';

interface CalendarGridProps {
  onMarkWatched: (mediaId: number) => Promise<void>;
}

export class CalendarGrid extends BaseComponent<CalendarGridProps> {
  private dayColumns: DayColumn[] = [];
  private unsubscribe?: () => void;

  protected render(): HTMLElement {
    const state = calendarStore.getState();
    const { preferences, loading, entries } = state;

    // Show skeleton if loading and no entries
    if (loading && entries.length === 0) {
      const skeleton = new CalendarSkeleton({});
      return skeleton.getElement();
    }

    const grid = this.createElement('div', { class: 'calendar-grid' });

    // Apply layout mode class
    grid.classList.add(`calendar-grid--${preferences.layoutMode}`);

    // Apply column justify class
    if (preferences.columnJustify === 'center') {
      grid.classList.add('calendar-grid--center-justify');
    }

    // Group entries by day
    const entriesByDay = calendarStore.getEntriesByDay();

    // Get ordered days based on start day preference
    const orderedDays = this.getOrderedDays(preferences.startDay);

    // Get today's day name
    const today = DAYS_OF_WEEK[new Date().getDay()];

    // Create card options
    const cardOptions: CardOptions = {
      layoutMode: preferences.layoutMode,
      showTime: preferences.showTime,
      showEpisodeNumbers: preferences.showEpisodeNumbers,
      timeFormat: preferences.timeFormat,
      fullWidthImages: preferences.fullWidthImages,
      titleAlignment: preferences.titleAlignment,
      columnJustify: preferences.columnJustify,
      maxCardsPerDay: preferences.maxCardsPerDay,
      openInNewTab: preferences.openInNewTab,
      onMarkWatched: this.props.onMarkWatched,
    };

    // Filter days if hideEmptyDays is enabled
    let daysToShow = orderedDays;
    if (preferences.hideEmptyDays) {
      daysToShow = orderedDays.filter((day) => {
        const entries = entriesByDay[day] || [];
        return entries.length > 0;
      });

      // If all days are empty, show at least today
      if (daysToShow.length === 0) {
        daysToShow = [today];
      }
    }

    // Add days-count class to grid for responsive layout
    grid.classList.remove(
      'days-count-1',
      'days-count-2',
      'days-count-3',
      'days-count-4',
      'days-count-5',
      'days-count-6',
      'days-count-7'
    );
    grid.classList.add(`days-count-${daysToShow.length}`);

    // Create day columns
    this.dayColumns = daysToShow
      .map((day) => {
        const entries = entriesByDay[day] || [];

        const column = new DayColumn({
          day,
          entries,
          cardOptions,
          isToday: day === today,
        });

        column.mount(grid);
        return column;
      })
      .filter((col): col is DayColumn => col !== null);

    return grid;
  }

  protected attachEvents(): void {
    // Unsubscribe from existing listener if any before re-subscribing
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Subscribe to store changes
    this.unsubscribe = calendarStore.subscribe((state, prevState) => {
      // Check if we need to re-render
      const shouldRerender =
        state.loading !== prevState.loading ||
        state.entries !== prevState.entries ||
        state.preferences.layoutMode !== prevState.preferences.layoutMode ||
        state.preferences.hideEmptyDays !== prevState.preferences.hideEmptyDays ||
        state.preferences.startDay !== prevState.preferences.startDay ||
        state.preferences.showTime !== prevState.preferences.showTime ||
        state.preferences.showEpisodeNumbers !== prevState.preferences.showEpisodeNumbers ||
        state.preferences.fullWidthImages !== prevState.preferences.fullWidthImages ||
        state.preferences.titleAlignment !== prevState.preferences.titleAlignment ||
        state.preferences.columnJustify !== prevState.preferences.columnJustify ||
        state.preferences.maxCardsPerDay !== prevState.preferences.maxCardsPerDay ||
        state.preferences.timeFormat !== prevState.preferences.timeFormat ||
        state.preferences.openInNewTab !== prevState.preferences.openInNewTab ||
        state.preferences.socialEnabled !== prevState.preferences.socialEnabled ||
        state.preferences.socialShowAvatars !== prevState.preferences.socialShowAvatars;

      if (shouldRerender) {
        log.debug('Calendar preferences changed, re-rendering grid');
        this.rerender();
      }
    });

    // Start countdown update interval
    calendarStore.startCountdownInterval(() => {
      this.updateCountdowns();
    }, TIME.COUNTDOWN_UPDATE_INTERVAL);
  }

  /**
   * Get ordered days based on start day preference
   */
  private getOrderedDays(startDay: string): string[] {
    if (startDay === 'today') {
      const todayIndex = new Date().getDay();
      return [
        ...DAYS_OF_WEEK.slice(todayIndex),
        ...DAYS_OF_WEEK.slice(0, todayIndex),
      ];
    }

    const startIndex = parseInt(startDay, 10);
    if (!isNaN(startIndex) && startIndex >= 0 && startIndex < 7) {
      return [
        ...DAYS_OF_WEEK.slice(startIndex),
        ...DAYS_OF_WEEK.slice(0, startIndex),
      ];
    }

    // Default: Monday first
    return [...DAYS_OF_WEEK.slice(1), DAYS_OF_WEEK[0]];
  }

  /**
   * Update countdown timers in all cards
   */
  private updateCountdowns(): void {
    const { preferences } = calendarStore.getState();

    if (preferences.timeFormat === 'countdown') {
      this.dayColumns.forEach((column) => {
        column.updateCardTimes('countdown');
      });
    }
  }

  /**
   * Show loading state (no-op as it's handled by render)
   */
  public showLoading(): void { }

  /**
   * Hide loading state (no-op as it's handled by render)
   */
  public hideLoading(): void { }

  /**
   * Show error message
   */
  public showError(message: string): void {
    const errorEl = this.createElement('div', { class: 'calendar-grid__error' });
    errorEl.innerHTML = `
      <div class="calendar-grid__error-content">
        <i class="fa fa-exclamation-circle"></i>
        <p>${message}</p>
        <button class="calendar-grid__retry-btn">Retry</button>
      </div>
    `;

    this.element.appendChild(errorEl);

    // Add retry button handler
    const retryBtn = errorEl.querySelector('.calendar-grid__retry-btn');
    if (retryBtn) {
      this.addEventListener(retryBtn as HTMLElement, 'click', () => {
        errorEl.remove();
        // Trigger reload event (handled by parent module)
        this.element.dispatchEvent(new CustomEvent('retry'));
      });
    }
  }

  protected onUnmount(): void {
    // Stop countdown interval
    calendarStore.stopCountdownInterval();

    // Unsubscribe from store
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Clean up day columns
    this.dayColumns.forEach((column) => column.unmount());
    this.dayColumns = [];
  }
}
