/**
 * @file AstraDashboardStore.ts
 * @description Reactive state store for the Astra Dashboard
 *
 * Handles filtering, sorting, and search state. Subscribes to AstraService
 * events to provide a "Live" view of the data to UI components.
 *
 * Built on the shared reactive `Store<T>` base (same primitive used by
 * CalendarStore) — one store pattern across the codebase.
 *
 * @see core/state/Store.ts for the reactive base class
 */

import { injectable, singleton, inject } from 'tsyringe';
import { Store } from '@core/state/Store';
import { TOKENS } from '@core/di/tokens';
import { AstraRepository } from './AstraRepository';
import { AstraFilterService } from '../services/AstraFilterService';
import { AstraStatsService } from '../services/AstraStatsService';
import {
  IDashboardState,
  IDashboardFilters,
  AstraSortType,
  AstraDashboardLayout,
} from '../interfaces/IDashboardState';
import { logger } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';

const SORT_OPTIONS = new Set<string>([
  'updated-desc', 'updated-asc', 'score-desc', 'score-asc', 'title-asc', 'title-desc',
  'type-asc', 'type-desc', 'progress-desc', 'progress-asc',
  'started-asc', 'started-desc', 'completed-asc', 'completed-desc',
]);

function validFilters(saved: Partial<IDashboardFilters>): Partial<IDashboardFilters> {
  const filters: Partial<IDashboardFilters> = {};
  if (typeof saved.search === 'string') filters.search = saved.search;
  if (['all', 'anime', 'manga', 'novel'].includes(saved.type!)) filters.type = saved.type;
  if (['all', 'rated', 'unrated'].includes(saved.ratingStatus!)) filters.ratingStatus = saved.ratingStatus;
  if (typeof saved.country === 'string') filters.country = saved.country;
  if (typeof saved.isGrouped === 'boolean') filters.isGrouped = saved.isGrouped;
  if (Array.isArray(saved.customLists) && saved.customLists.every(value => typeof value === 'string')) {
    filters.customLists = [...saved.customLists];
  }
  if (saved.anilistStatus === 'all') filters.anilistStatus = 'all';
  else if (Array.isArray(saved.anilistStatus) && saved.anilistStatus.every(value => Object.values(MediaListStatus).includes(value))) {
    filters.anilistStatus = [...saved.anilistStatus];
  }
  return filters;
}

const INITIAL_STATE: IDashboardState = {
  filters: {
    search: '',
    type: 'all',
    ratingStatus: 'all',
    country: 'all',
    customLists: [],
    isGrouped: true,
    anilistStatus: 'all',
  },
  sort: 'title-asc',
  stats: {
    totalCount: 0,
    averageScore: 0,
    completedCount: 0,
    droppedCount: 0,
    planningCount: 0,
    genreDistribution: {},
    statusDistribution: {},
  },
  filteredWorks: [],
  layout: 'table',
  showProgress: false,
  separateAiring: true,
  activeTab: 'dashboard',
  isLoading: false,
  error: null,
};

@injectable()
@singleton()
export class AstraDashboardStore extends Store<IDashboardState> {
  private disposed = false;
  private unsubscribers: Array<() => void> = [];
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private viewUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Transient search text held until the debounce window applies it. */
  private pendingSearch = '';
  /** Distinguishes a user's explicit choice from the former default-off value. */
  private separateAiringConfigured = false;
  private readonly initialized: Promise<void>;
  private editedPreferences = new Set<'filters' | 'sort' | 'layout' | 'showProgress' | 'separateAiring'>();
  private readonly STORAGE_KEY = 'au_astra_dashboard_state_v2';

  constructor(
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(AstraFilterService) private filterService: AstraFilterService,
    @inject(AstraStatsService) private statsService: AstraStatsService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    super(structuredClone(INITIAL_STATE));
    this.initialized = this.init();

    for (const event of [EVENT_TYPES.ASTRA_DATA_UPDATED, EVENT_TYPES.PROGRESS_UPDATED, EVENT_TYPES.ASTRA_SYNC_COMPLETE]) {
      this.unsubscribers.push(this.eventBus.on(event, () => this.scheduleFilteredListUpdate()).unsubscribe);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.searchDebounceTimer !== null) clearTimeout(this.searchDebounceTimer);
    if (this.viewUpdateTimer !== null) clearTimeout(this.viewUpdateTimer);
    this.searchDebounceTimer = this.viewUpdateTimer = null;
    this.pendingSearch = '';
    this.editedPreferences.clear();
    this.clearListeners();
    // Reset both current and previous snapshots without publishing or erasing
    // persisted preferences; neither snapshot may retain private work rows.
    super.reset(structuredClone(INITIAL_STATE));
    super.reset(structuredClone(INITIAL_STATE));
  }

  /** Resolves after persisted dashboard preferences and the initial work list are loaded. */
  public ready(): Promise<void> {
    return this.initialized;
  }

  public override setState(partial: Partial<IDashboardState> | ((state: IDashboardState) => Partial<IDashboardState>)): void {
    if (!this.disposed) super.setState(partial);
  }

  public override reset(state?: Partial<IDashboardState>): void {
    if (!this.disposed) super.reset(state);
  }

  public override batch(updater: () => void): void {
    if (!this.disposed) super.batch(updater);
  }

  private async init(): Promise<void> {
    try {
      const saved = await this.storage.get<{
        filters?: Partial<IDashboardFilters>;
        sort?: AstraSortType;
        layout?: AstraDashboardLayout;
        showProgress?: boolean;
        separateAiring?: boolean;
        separateAiringConfigured?: boolean;
      }>(this.STORAGE_KEY);
      if (this.disposed) return;
      if (saved) {
        const patch: Partial<IDashboardState> = {};
        if (!this.editedPreferences.has('filters') && saved.filters && typeof saved.filters === 'object') {
          patch.filters = { ...this.getState().filters, ...validFilters(saved.filters) };
        }
        if (!this.editedPreferences.has('sort') && typeof saved.sort === 'string'
          && (SORT_OPTIONS.has(saved.sort) || /^section-.+-(asc|desc)$/.test(saved.sort))) patch.sort = saved.sort;
        if (!this.editedPreferences.has('layout') && ['table', 'list', 'grid'].includes(saved.layout!)) patch.layout = saved.layout;
        if (!this.editedPreferences.has('showProgress') && typeof saved.showProgress === 'boolean') patch.showProgress = saved.showProgress;
        if (!this.editedPreferences.has('separateAiring') && saved.separateAiringConfigured === true) {
          this.separateAiringConfigured = true;
          if (typeof saved.separateAiring === 'boolean') patch.separateAiring = saved.separateAiring;
        }
        if (Object.keys(patch).length > 0) this.setState(patch);
      }
    } catch (e) {
      if (this.disposed) return;
      logger.error('[AstraDashboardStore] Failed to load saved state', e);
    }

    this.updateFilteredList();
  }

  /**
   * Subscribe with an immediate emission of the current state (single-arg
   * listener), preserving the dashboard's original contract on top of Store.
   */
  public override subscribe(
    listener: (state: IDashboardState, prevState: IDashboardState) => void
  ): () => void {
    if (this.disposed) return () => {};
    const unsubscribe = super.subscribe(listener);
    const current = this.getState();
    listener(current, current); // immediate emission (callers may ignore prevState)
    return unsubscribe;
  }

  /** Copy editable filters as well as the state object to protect live preferences. */
  public override getState(): IDashboardState {
    const state = super.getState();
    return { ...state, filters: structuredClone(state.filters) };
  }

  public setSearch(search: string): void {
    if (this.disposed) return;
    this.editedPreferences.add('filters');
    // Debounced: hold the text and recompute+notify once after the window,
    // so typing doesn't rebuild the grid on every keystroke.
    this.pendingSearch = search;

    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

    this.searchDebounceTimer = setTimeout(() => {
      if (this.disposed) return;
      const filters = { ...this.getState().filters, search: this.pendingSearch };
      this.setState({ filters, ...this.computeView(filters, this.getState().sort) });
      this.searchDebounceTimer = null;
      void this.persist();
    }, 300);
  }

  public setFilters(filters: Partial<IDashboardFilters>): void {
    if (this.disposed) return;
    this.editedPreferences.add('filters');
    if (filters.search !== undefined) {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
      this.pendingSearch = filters.search;
    }
    const merged = { ...this.getState().filters, ...validFilters(filters) };
    this.setState({ filters: merged, ...this.computeView(merged, this.getState().sort) });
    void this.persist();
  }

  public setSort(sort: AstraSortType): void {
    if (this.disposed) return;
    this.editedPreferences.add('sort');
    this.setState({ sort, ...this.computeView(this.getState().filters, sort) });
    void this.persist();
  }

  public setLayout(layout: AstraDashboardLayout): void {
    if (this.disposed) return;
    this.editedPreferences.add('layout');
    this.setState({ layout });
    void this.persist();
  }

  public setShowProgress(showProgress: boolean): void {
    if (this.disposed) return;
    this.editedPreferences.add('showProgress');
    this.setState({ showProgress });
    void this.persist();
  }

  public setSeparateAiring(separateAiring: boolean): void {
    if (this.disposed) return;
    this.separateAiringConfigured = true;
    this.editedPreferences.add('separateAiring');
    this.setState({ separateAiring });
    void this.persist();
  }

  public setTab(tab: 'dashboard' | 'settings'): void {
    if (this.disposed) return;
    this.setState({ activeTab: tab });
  }

  private updateFilteredList(): void {
    if (this.disposed) return;
    const { filters, sort } = this.getState();
    this.setState(this.computeView(filters, sort));
  }

  private scheduleFilteredListUpdate(): void {
    if (this.disposed || this.viewUpdateTimer) return;

    this.viewUpdateTimer = setTimeout(() => {
      this.viewUpdateTimer = null;
      this.updateFilteredList();
    }, 0);
  }

  /** Pure derivation of the filtered list + stats from the current works. */
  private computeView(
    filters: IDashboardFilters,
    sort: AstraSortType
  ): Pick<IDashboardState, 'filteredWorks' | 'stats'> {
    const allWorks = this.repository.getWorks();
    let filtered = this.filterService.filter(allWorks, filters);
    filtered = this.filterService.sort(filtered, sort);
    return {
      filteredWorks: filtered,
      stats: this.statsService.calculateStats(allWorks),
    };
  }

  private async persist(): Promise<void> {
    if (this.disposed) return;
    try {
      const { filters, sort, layout, showProgress, separateAiring } = this.getState();
      const saved = await this.storage.set(this.STORAGE_KEY, {
        filters, sort, layout, showProgress, separateAiring,
        separateAiringConfigured: this.separateAiringConfigured,
      });
      if (this.disposed) return;
      if (!saved) {
        throw new Error('Dashboard preferences storage write failed');
      }
    } catch (e) {
      if (this.disposed) return;
      logger.error('[AstraDashboardStore] Failed to persist state', e);
    }
  }
}
