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
import { IDashboardState, IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';
import { log } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EVENT_TYPES } from '@core/events/EventTypes';

const INITIAL_STATE: IDashboardState = {
  filters: {
    search: '',
    type: 'all',
    ratingStatus: 'all',
    country: 'all',
    isGrouped: true,
    anilistStatus: 'all',
  },
  sort: 'updated-desc',
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
  activeTab: 'dashboard',
  isLoading: false,
  error: null,
};

@injectable()
@singleton()
export class AstraDashboardStore extends Store<IDashboardState> {
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Transient search text held until the debounce window applies it. */
  private pendingSearch = '';
  private readonly STORAGE_KEY = 'au_astra_dashboard_state_v2';

  constructor(
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(AstraFilterService) private filterService: AstraFilterService,
    @inject(AstraStatsService) private statsService: AstraStatsService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    super(INITIAL_STATE);
    this.init();

    this.eventBus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, () => this.updateFilteredList());
    this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, () => this.updateFilteredList());
    this.eventBus.on(EVENT_TYPES.ASTRA_SYNC_COMPLETE, () => this.updateFilteredList());
  }

  private async init(): Promise<void> {
    try {
      const saved = await this.storage.get<{
        filters?: Partial<IDashboardFilters>;
        sort?: AstraSortType;
      }>(this.STORAGE_KEY);
      if (saved) {
        const patch: Partial<IDashboardState> = {};
        if (saved.filters) patch.filters = { ...this.getState().filters, ...saved.filters };
        if (saved.sort) patch.sort = saved.sort;
        if (Object.keys(patch).length > 0) this.setState(patch);
      }
    } catch (e) {
      log.error('[AstraDashboardStore] Failed to load saved state', e);
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
    const unsubscribe = super.subscribe(listener);
    const current = this.getState();
    listener(current, current); // immediate emission (callers may ignore prevState)
    return unsubscribe;
  }

  /** Returns a shallow copy so callers cannot mutate the live state. */
  public override getState(): IDashboardState {
    return { ...super.getState() };
  }

  public setSearch(search: string): void {
    // Debounced: hold the text and recompute+notify once after the window,
    // so typing doesn't rebuild the grid on every keystroke.
    this.pendingSearch = search;

    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

    this.searchDebounceTimer = setTimeout(() => {
      const filters = { ...this.getState().filters, search: this.pendingSearch };
      this.setState({ filters, ...this.computeView(filters, this.getState().sort) });
      this.searchDebounceTimer = null;
    }, 300);
  }

  public setFilters(filters: Partial<IDashboardFilters>): void {
    const merged = { ...this.getState().filters, ...filters };
    this.setState({ filters: merged, ...this.computeView(merged, this.getState().sort) });
    this.persist();
  }

  public setSort(sort: AstraSortType): void {
    this.setState({ sort, ...this.computeView(this.getState().filters, sort) });
    this.persist();
  }

  public setTab(tab: 'dashboard' | 'settings'): void {
    this.setState({ activeTab: tab });
  }

  private updateFilteredList(): void {
    const { filters, sort } = this.getState();
    this.setState(this.computeView(filters, sort));
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
    try {
      const { filters, sort } = this.getState();
      await this.storage.set(this.STORAGE_KEY, { filters, sort });
    } catch (e) {
      log.error('[AstraDashboardStore] Failed to persist state', e);
    }
  }
}
