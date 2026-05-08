/**
 * @file AstraDashboardStore.ts
 * @description Reactive state store for the Astra Dashboard
 * 
 * Handles filtering, sorting, and search state. Subscribes to AstraService
 * events to provide a "Live" view of the data to UI components.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraRepository } from './AstraRepository';
import { AstraFilterService } from '../services/AstraFilterService';
import { AstraStatsService } from '../services/AstraStatsService';
import { IDashboardState, IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';
import { log } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EVENT_TYPES } from '@core/events/EventTypes';

@injectable()
@singleton()
export class AstraDashboardStore {
  private state: IDashboardState = {
    filters: {
      search: '',
      type: 'all',
      ratingStatus: 'all',
      country: 'all',
      isGrouped: true,
      anilistStatus: 'all'
    },
    sort: 'updated-desc',
    stats: {
      totalCount: 0,
      averageScore: 0,
      completedCount: 0,
      droppedCount: 0,
      planningCount: 0,
      genreDistribution: {},
      statusDistribution: {}
    },
    filteredWorks: [],
    activeTab: 'dashboard',
    isLoading: false,
    error: null
  };

  private listeners: ((state: IDashboardState) => void)[] = [];
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STORAGE_KEY = 'au_astra_dashboard_state_v2';

  constructor(
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(AstraFilterService) private filterService: AstraFilterService,
    @inject(AstraStatsService) private statsService: AstraStatsService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    this.init();

    this.eventBus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, () => this.updateFilteredList());
    this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, () => this.updateFilteredList());
  }

  private async init(): Promise<void> {
    try {
      const saved = await this.storage.get<any>(this.STORAGE_KEY);
      if (saved) {
        if (saved.filters) this.state.filters = { ...this.state.filters, ...saved.filters };
        if (saved.sort) this.state.sort = saved.sort;
      }
    } catch (e) {
      log.error('[AstraDashboardStore] Failed to load saved state', e);
    }
    
    this.updateFilteredList();
  }

  public subscribe(listener: (state: IDashboardState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public getState(): IDashboardState {
    return { ...this.state };
  }

  public setSearch(search: string): void {
    this.state.filters.search = search;
    
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    
    this.searchDebounceTimer = setTimeout(() => {
      this.updateFilteredList();
      this.searchDebounceTimer = null;
    }, 300);
  }

  public setFilters(filters: Partial<IDashboardFilters>): void {
    this.state.filters = { ...this.state.filters, ...filters };
    this.updateFilteredList();
    this.persist();
  }

  public setSort(sort: AstraSortType): void {
    this.state.sort = sort;
    this.updateFilteredList();
    this.persist();
  }

  public setTab(tab: 'dashboard' | 'settings'): void {
    this.state.activeTab = tab;
    this.notify();
  }

  private updateFilteredList(): void {
    const allWorks = this.repository.getWorks();
    
    let filtered = this.filterService.filter(allWorks, this.state.filters);
    filtered = this.filterService.sort(filtered, this.state.sort);

    this.state.filteredWorks = filtered;
    this.state.stats = this.statsService.calculateStats(allWorks);
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.state));
  }

  private async persist(): Promise<void> {
    try {
      const toSave = {
        filters: this.state.filters,
        sort: this.state.sort
      };
      await this.storage.set(this.STORAGE_KEY, toSave);
    } catch (e) {
      log.error('[AstraDashboardStore] Failed to persist state', e);
    }
  }
}
