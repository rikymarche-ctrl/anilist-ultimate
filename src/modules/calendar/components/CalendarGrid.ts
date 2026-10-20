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
import type { DependencyContainer } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { container } from '@core/di/container';
import { DayColumn } from './DayColumn';
import type { DayColumnProps } from './DayColumn';
import { CalendarSkeleton } from './CalendarSkeleton';
import { CalendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import { DAYS_OF_WEEK, TIME } from '@core/constants';
import { logger } from '@core/logger';
import type { DayOfWeek, AnimeEntry } from '@core/types';

interface CalendarGridProps {
  onMarkWatched: (mediaId: number) => Promise<void>;
  astraEnabled: boolean;
  onRetry?: () => Promise<void>;
  onManagePersonalPlan?: (mediaId: number) => void;
}

@injectable()
export class CalendarGrid extends BaseComponent<CalendarGridProps> {
  private dayColumns: DayColumn[] = [];
  private unsubscribe: (() => void) | null = null;
  private countdownInterval: number | null = null;
  private renderedDate = '';
  private retryToken: object | null = null;

  constructor(
    @inject('CalendarGridProps') props: CalendarGridProps,
    @inject(TOKENS.CalendarStore) private store: CalendarStore,
    @inject(TOKENS.ComponentScope) private scope: DependencyContainer = container,
  ) {
    super(props);
    // Re-render now that this.store is assigned (BaseComponent constructor calls render BEFORE this assignment)
    this.element = this.render();
  }

  protected render(): HTMLElement {
    if (!this.store) return this.createElement('div', { class: 'calendar-grid-loading' });
    
    const state = this.store.getState();
    const { preferences, loading, entries, error } = state;
    const { hideEmptyDays, showEmptyToday } = preferences;

    logger.debug('[CalendarGrid] Rendering grid', {
      loading, 
      entryCount: entries.length, 
      hideEmptyDays 
    });

    // Reset column tracking
    this.dayColumns = [];
    this.renderedDate = new Date().toDateString();

    try {
      if (error && !entries.length) return this.renderError('provider');

      // Show skeleton while loading if no data yet
      if (loading && entries.length === 0) {
        return new CalendarSkeleton({}).getElement();
      }

      const grid = this.createElement('div', { class: 'calendar-grid' });
      if (error) grid.append(this.renderError('provider'));
      
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
      
      daysToShow.forEach((day) => {
        const props = this.columnProps(day as DayOfWeek);
        const child = this.scope.createChildContainer();
        child.registerInstance('DayColumnProps', props);
        const column = child.resolve(DayColumn);
        
        this.dayColumns.push(column);
      });

      return grid;
    } catch (error: unknown) {
      this.dayColumns = [];
      logger.error('[CalendarGrid] Render failed', error);
      return this.renderError('render');
    }
  }

  private renderError(kind: 'provider' | 'render'): HTMLElement {
    const error = this.createElement('div', { class: 'calendar-grid__error' });
    error.dataset.errorKind = kind;
    const content = this.createElement('div', { class: 'calendar-grid__error-content', role: 'alert' });
    const icon = this.createElement('i', { class: 'fa-solid fa-triangle-exclamation', 'aria-hidden': 'true' });
    const message = document.createElement('p');
    message.textContent = kind === 'render' ? 'Failed to render calendar grid.'
      : this.store.getState().entries.length ? 'Unable to refresh calendar. Previously loaded episodes are shown.'
      : 'Unable to load calendar. Please try again.';
    content.append(icon, message);
    if (kind === 'render' || this.props.onRetry) {
      const button = this.createElement('button', { class: 'calendar-grid__retry-btn', type: 'button',
        'aria-label': 'Retry loading calendar', 'data-retry': kind });
      button.textContent = 'Retry';
      const busy = kind === 'provider' && (this.store.getState().loading || this.retryToken !== null);
      button.disabled = busy; button.setAttribute('aria-busy', String(busy)); content.append(button);
    }
    error.append(content); return error;
  }

  /** Refresh the feedback independently of card instances and their pending actions. */
  private syncProviderError(): void {
    const previous = this.element.matches('[data-error-kind="provider"]') ? this.element
      : this.element.querySelector<HTMLElement>('[data-error-kind="provider"]');
    if (this.store.getState().error) {
      if (previous && Boolean(previous.querySelector('[data-retry="provider"]')) === Boolean(this.props.onRetry)) {
        this.syncRetryButton(); return;
      }
      const feedback = this.renderError('provider');
      if (previous === this.element) previous.replaceChildren(...feedback.childNodes);
      else if (previous) previous.replaceWith(feedback); else this.element.prepend(feedback);
    } else previous?.remove();
  }

  private async retryProvider(): Promise<void> {
    if (this.retryToken || this.store.getState().loading || !this.props.onRetry) return;
    const token = {}; this.retryToken = token;
    const retry = this.props.onRetry;
    this.syncRetryButton();
    try { await retry(); }
    catch (error) { logger.warn('[CalendarGrid] Retry failed', error); }
    finally {
      if (this.retryToken === token) { this.retryToken = null; this.syncRetryButton(); }
    }
  }

  private syncRetryButton(): void {
    if (!this.mounted || !this.element.isConnected) return;
    const button = this.element.querySelector<HTMLButtonElement>('[data-retry="provider"]');
    if (!button) return;
    const busy = this.store.getState().loading || this.retryToken !== null;
    button.disabled = busy; button.setAttribute('aria-busy', String(busy));
  }

  /**
   * Renders an empty state when no anime are airing
   */
  private renderEmptyState(): HTMLElement {
    const empty = this.createElement('div', { class: 'calendar-grid__empty' });
    empty.innerHTML = `
      <div class="calendar-grid__empty-content">
        <i class="fa-solid fa-calendar-xmark"></i>
        <h3>No anime airing this week</h3>
        <p>Your watching list doesn't have any airing episodes scheduled for the next 7 days.</p>
      </div>
    `;
    return empty;
  }

  public override mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.element = this.render(); super.mount(parent);
  }

  protected onMount(): void {
    this.dayColumns.forEach(column => column.mount(this.element));
  }

  protected attachEvents(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.store.subscribe((state, prevState) => {
      if (!this.mounted || !this.element.isConnected) return;
      if (state.error !== prevState.error || state.loading !== prevState.loading || state.entries !== prevState.entries
        || state.expandedDays !== prevState.expandedDays
        || !this.shallowEqualPreferences(state.preferences, prevState.preferences)) {
        if (!this.updateColumns()) this.rerender();
      }
    });
    this.addEventListener(this.element, 'click', event => {
      if (!this.mounted || !this.element.isConnected || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('.calendar-grid__retry-btn');
      if (!button || !this.element.contains(button) || button.disabled) return;
      if (button.dataset.retry === 'provider') void this.retryProvider();
      else this.rerender();
    });
    this.countdownInterval = window.setInterval(() => {
      if (!this.mounted || !this.element.isConnected) return;
      if (this.renderedDate !== new Date().toDateString()) this.rerender();
      else this.updateCountdowns();
    }, TIME.COUNTDOWN_UPDATE_INTERVAL);
  }

  private columnProps(day: DayOfWeek): DayColumnProps {
    const { preferences, expandedDays } = this.store.getState();
    return { day, entries: this.store.getEntriesByDay()[day] || [],
      isToday: day === DAYS_OF_WEEK[new Date().getDay()], isExpanded: expandedDays.has(day),
      cardOptions: { layoutMode: preferences.layoutMode, showTime: preferences.showTime,
        showEpisodeNumbers: preferences.showEpisodeNumbers, timeFormat: preferences.timeFormat,
        fullWidthImages: preferences.fullWidthImages, titleAlignment: preferences.titleAlignment,
        columnJustify: preferences.columnJustify, maxCardsPerDay: preferences.maxCardsPerDay,
        openInNewTab: preferences.openInNewTab, astraEnabled: this.props.astraEnabled, onMarkWatched: this.props.onMarkWatched,
        onManagePersonalPlan: this.props.onManagePersonalPlan } };
  }

  /** Keep existing card instances when the day layout is unchanged. */
  private updateColumns(): boolean {
    if (!this.mounted) return false;
    if (this.element.dataset.errorKind === 'provider' && this.store.getState().error && !this.store.getState().entries.length) {
      this.syncProviderError(); return true;
    }
    if (!this.element.classList.contains('calendar-grid')
      || this.renderedDate !== new Date().toDateString()) return false;
    const { preferences, entries, loading } = this.store.getState();
    if (loading && !entries.length) return false;
    const ordered = this.getOrderedDays(preferences.startDay);
    let days = preferences.hideEmptyDays ? this.getNonEmptyDays(entries, ordered) : ordered;
    if (!days.length && preferences.showEmptyToday) days = [DAYS_OF_WEEK[new Date().getDay()]];
    if (!days.length || days.length !== this.dayColumns.length
      || this.dayColumns.some((column, index) => column.getDay() !== days[index])) return false;
    this.syncProviderError();
    this.dayColumns.forEach(column => column.update(this.columnProps(column.getDay() as DayOfWeek)));
    return true;
  }

  protected override shouldUpdate(prev: CalendarGridProps, next: CalendarGridProps): boolean {
    return prev.astraEnabled !== next.astraEnabled || prev.onMarkWatched !== next.onMarkWatched
      || prev.onRetry !== next.onRetry || prev.onManagePersonalPlan !== next.onManagePersonalPlan;
  }
  protected override onUpdate(): boolean { return this.updateColumns(); }

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
  private getNonEmptyDays(entries: AnimeEntry[], orderedDays: string[]): string[] {
    const daysWithEntries = new Set(entries.map((e: AnimeEntry) => e.airingAt.getDay()));
    return orderedDays.filter(dayName => {
      const dayIndex = DAYS_OF_WEEK.indexOf(dayName as DayOfWeek);
      return daysWithEntries.has(dayIndex);
    });
  }

  /**
   * Update countdown timers in all cards
   */
  private updateCountdowns(): void {
    const { preferences } = this.store.getState();
    this.dayColumns.forEach(column => column.updateCardTimes(preferences.timeFormat));
  }

  /**
   * Force a full re-render of the grid
   */
  public refresh(): void {
    this.rerender();
  }

  public showLoading(): void { }
  public hideLoading(): void { }

  public showError(message: string): void {
    this.store.setError(new Error(message));
  }

  /**
   * Shallow equality check for preferences
   * Performance: Much faster than JSON.stringify for objects with many properties
   */
  private shallowEqualPreferences(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      return false;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => Object.prototype.hasOwnProperty.call(b, key)
      && (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
  }

  public override unmount(): void {
    // A rerender retains the pending request guard; a closed view relinquishes it.
    this.retryToken = null;
    super.unmount();
  }

  protected onUnmount(): void {
    if (this.countdownInterval !== null) window.clearInterval(this.countdownInterval);
    this.countdownInterval = null;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.dayColumns.forEach((column) => column.unmount());
    this.dayColumns = [];
  }
}
