/**
 * @file CalendarGrid.ts
 * @description Main calendar layout component that orchestrates day columns
 *
 * Subscribes to CalendarStore for reactive updates, computes day grouping,
 * handles preference-driven re-renders (layout mode, empty day hiding,
 * start day rotation), and manages the settings panel toggle.
 *
 * @see DayColumn.ts for individual day rendering
 * @see CalendarStore.ts for state subscriptions
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { container } from '@core/di/container';
import { DayColumn } from './DayColumn';
import { CalendarSkeleton } from './CalendarSkeleton';
import { calendarStore } from '../CalendarStore';
import { DAYS_OF_WEEK, TIME } from '@core/constants';
import { log } from '@core/logger';
import type { DayOfWeek } from '@core/types';

interface CalendarGridProps {
  onMarkWatched: (mediaId: number) => Promise<void>;
  astraEnabled: boolean;
}

@injectable()
export class CalendarGrid extends BaseComponent<CalendarGridProps> {
  private dayColumns: DayColumn[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    @inject('CalendarGridProps') props: CalendarGridProps
  ) {
    super(props);
  }

  protected render(): HTMLElement {
    const state = calendarStore.getState();
    const { preferences, loading, entries } = state;
    const { hideEmptyDays, showEmptyToday } = preferences;

    log.debug('[CalendarGrid] Rendering grid', { 
      loading, 
      entryCount: entries.length, 
      hideEmptyDays 
    });

    // Reset column tracking
    this.dayColumns = [];

    try {
      // Show skeleton while loading if no data yet
      if (loading && entries.length === 0) {
        return new CalendarSkeleton({}).getElement();
      }

      const grid = this.createElement('div', { class: 'calendar-grid' });
      
      // Determine which days to show
      const orderedDays = this.getOrderedDays(preferences.startDay);
      let daysToShow = orderedDays;

      if (hideEmptyDays) {
        daysToShow = this.getNonEmptyDays(entries, orderedDays);
      }

      const today = DAYS_OF_WEEK[new Date().getDay()];

      // Fallback: if all days are empty, show at least today if requested
      if (daysToShow.length === 0) {
        if (showEmptyToday) {
          daysToShow = [today];
        } else if (!loading) {
          return this.renderEmptyState();
        } else {
          return new CalendarSkeleton({}).getElement();
        }
      }

      // Track days count for CSS grid layout
      grid.classList.add(`days-count-${daysToShow.length}`);

      // Create day columns
      const entriesByDay = calendarStore.getEntriesByDay();
      
      daysToShow.forEach((day) => {
        const props = {
          day,
          entries: entriesByDay[day] || [],
          isToday: day === today,
          isExpanded: state.expandedDays.has(day),
          cardOptions: {
            layoutMode: preferences.layoutMode,
            showTime: preferences.showTime,
            showEpisodeNumbers: preferences.showEpisodeNumbers,
            timeFormat: preferences.timeFormat,
            fullWidthImages: preferences.fullWidthImages,
            titleAlignment: preferences.titleAlignment,
            columnJustify: preferences.columnJustify,
            maxCardsPerDay: preferences.maxCardsPerDay,
            openInNewTab: preferences.openInNewTab,
            astraEnabled: this.props.astraEnabled,
            onMarkWatched: this.props.onMarkWatched
          },
        };

        const child = container.createChildContainer();
        child.register('DayColumnProps', { useValue: props });
        const column = child.resolve(DayColumn);
        
        this.dayColumns.push(column);
        grid.appendChild(column.getElement());
      });

      return grid;
    } catch (error: unknown) {
      log.error('[CalendarGrid] Render failed', error);
      const errorEl = this.createElement('div', { class: 'calendar-grid__error' });

      const errorContent = document.createElement('div');
      errorContent.className = 'calendar-grid__error-content';

      const icon = document.createElement('i');
      icon.className = 'fa fa-exclamation-triangle';
      icon.setAttribute('aria-hidden', 'true');
      errorContent.appendChild(icon);

      const message = document.createElement('p');
      message.textContent = 'Failed to render calendar grid.';
      errorContent.appendChild(message);

      const details = document.createElement('div');
      details.className = 'calendar-error-details';
      details.style.cssText = 'font-size: 10px; opacity: 0.7; margin: 10px 0; font-family: monospace;';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      details.textContent = errorMessage;
      errorContent.appendChild(details);

      const retryBtn = document.createElement('button');
      retryBtn.className = 'calendar-grid__retry-btn';
      retryBtn.setAttribute('aria-label', 'Retry loading calendar');
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        this.rerender();
      });
      errorContent.appendChild(retryBtn);

      errorEl.appendChild(errorContent);
      return errorEl;
    }
  }

  /**
   * Renders an empty state when no anime are airing
   */
  private renderEmptyState(): HTMLElement {
    const empty = this.createElement('div', { class: 'calendar-grid__empty' });
    empty.innerHTML = `
      <div class="calendar-grid__empty-content">
        <i class="fa fa-calendar-xmark"></i>
        <h3>No anime airing this week</h3>
        <p>Your watching list doesn't have any airing episodes scheduled for the next 7 days.</p>
      </div>
    `;
    return empty;
  }

  protected attachEvents(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Subscribe to store changes
    this.unsubscribe = calendarStore.subscribe((state, prevState) => {
      // Performance: Use direct comparisons instead of JSON.stringify
      const shouldRerender =
        state.loading !== prevState.loading ||
        state.entries !== prevState.entries ||
        state.expandedDays !== prevState.expandedDays ||
        !this.shallowEqualPreferences(state.preferences, prevState.preferences);

      if (shouldRerender) {
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
   * Filter days that have at least one entry
   */
  private getNonEmptyDays(entries: any[], orderedDays: string[]): string[] {
    const daysWithEntries = new Set(entries.map(e => e.airingAt.getDay()));
    return orderedDays.filter(dayName => {
      const dayIndex = DAYS_OF_WEEK.indexOf(dayName as DayOfWeek);
      return daysWithEntries.has(dayIndex);
    });
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

  public showLoading(): void { }
  public hideLoading(): void { }

  public showError(message: string): void {
    log.error('[CalendarGrid] Error reported', { message });
    this.rerender(); // Use render-based error handling
  }

  /**
   * Shallow equality check for preferences
   * Performance: Much faster than JSON.stringify for objects with many properties
   */
  private shallowEqualPreferences(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      return false;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => a[key] === b[key]);
  }

  protected onUnmount(): void {
    calendarStore.stopCountdownInterval();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    this.dayColumns.forEach((column) => column.unmount());
    this.dayColumns = [];
  }
}
