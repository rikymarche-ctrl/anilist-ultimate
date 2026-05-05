/**
 * @file AstraStore.ts
 * @description Reactive state store for the Astra Dashboard
 * 
 * Handles filtering, sorting, and search state. Subscribes to AstraService
 * events to provide a "Live" view of the data to UI components.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService, AstraWorkSummary } from '../AstraService';
import { log } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';

export type AstraSortOption = 'updated-desc' | 'updated-asc' | 'score-desc' | 'score-asc' | 'title-asc';

export interface DashboardState {
  search: string;
  type: string;
  status: string;
  anilistStatus: string;
  sort: AstraSortOption;
  country: string;
  isGrouped: boolean;
  collapsedGroups: Set<string>;
  filteredWorks: AstraWorkSummary[];
  stats: DashboardStats;
}

export interface DashboardStats {
  total: number;
  averageScore: number;
  completed: number;
  inProgress: number;
  planned: number;
}

@injectable()
@singleton()
export class AstraStore {
  private state: DashboardState = {
    search: '',
    type: 'all',
    status: 'all',
    anilistStatus: 'all',
    sort: 'updated-desc',
    country: 'all',
    isGrouped: true,
    collapsedGroups: new Set(),
    filteredWorks: [],
    stats: {
      total: 0,
      averageScore: 0,
      completed: 0,
      inProgress: 0,
      planned: 0
    }
  };

  private listeners: ((state: DashboardState) => void)[] = [];
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STORAGE_KEY = 'au_astra_dashboard_state';

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    this.init();

    // Listen for data updates to refresh filtered list
    this.eventBus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, () => this.updateFilteredList());
    this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, () => this.updateFilteredList());
  }

  /**
   * Load persisted state
   */
  private async init(): Promise<void> {
    try {
      const saved = await this.storage.get<Partial<DashboardState>>(this.STORAGE_KEY);
      if (saved) {
        // Restore non-transient fields
        if (saved.type) this.state.type = saved.type;
        if (saved.status) this.state.status = saved.status;
        if (saved.anilistStatus) this.state.anilistStatus = saved.anilistStatus;
        if (saved.country) this.state.country = saved.country;
        if (saved.sort) this.state.sort = saved.sort;
        if (saved.isGrouped !== undefined) this.state.isGrouped = saved.isGrouped;
      }
    } catch (e) {
      log.error('[AstraStore] Failed to load saved state', e);
    }
    
    // Initial run
    this.updateFilteredList();
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(listener: (state: DashboardState) => void): () => void {
    this.listeners.push(listener);
    // Emit current state immediately
    listener(this.state);
    
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Get current state snapshot
   */
  public getState(): DashboardState {
    return { ...this.state };
  }

  /**
   * Update search term with debounce
   */
  public setSearch(search: string): void {
    this.state.search = search;
    
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    
    this.searchDebounceTimer = setTimeout(() => {
      this.updateFilteredList();
      this.searchDebounceTimer = null;
    }, 300);
  }

  /**
   * Update filters
   */
  public setFilters(filters: Partial<Pick<DashboardState, 'type' | 'status' | 'anilistStatus' | 'country' | 'sort' | 'isGrouped'>>): void {
    Object.assign(this.state, filters);
    this.updateFilteredList();
    this.persist();
  }

  /**
   * Toggle group collapse
   */
  public toggleGroup(group: string): void {
    if (this.state.collapsedGroups.has(group)) {
      this.state.collapsedGroups.delete(group);
    } else {
      this.state.collapsedGroups.add(group);
    }
    this.notify();
  }

  /**
   * Force update filtered list from service
   */
  private updateFilteredList(): void {
    const allWorks = this.service.getWorks();
    
    // Apply filters
    let filtered = allWorks.filter(work => {
      const matchSearch = !this.state.search || 
        work.title.toLowerCase().includes(this.state.search.toLowerCase());
      
      const matchType = this.state.type === 'all' || work.type === this.state.type;
      
      const matchStatus = this.state.status === 'all' || 
        (this.state.status === 'rated' ? (work.currentScore !== null) : (work.currentScore === null));
      
      const matchAnilist = this.state.anilistStatus === 'all' || work.status === this.state.anilistStatus;
      
      const matchCountry = this.state.country === 'all' || work.country === this.state.country;

      return matchSearch && matchType && matchStatus && matchAnilist && matchCountry;
    });

    // Apply sorting
    filtered.sort((a, b) => {
      switch (this.state.sort) {
        case 'updated-desc': return b.updatedAt - a.updatedAt;
        case 'updated-asc': return a.updatedAt - b.updatedAt;
        case 'score-desc': return (b.currentScore || 0) - (a.currentScore || 0);
        case 'score-asc': return (a.currentScore || 0) - (b.currentScore || 0);
        case 'title-asc': return a.title.localeCompare(b.title);
        default: return 0;
      }
    });

    this.state.filteredWorks = filtered;
    this.calculateStats(allWorks);
    this.notify();
  }

  /**
   * Calculate dashboard statistics
   */
  private calculateStats(works: AstraWorkSummary[]): void {
    const total = works.length;
    const ratedWorks = works.filter(w => w.currentScore !== null);
    const averageScore = ratedWorks.length > 0 
      ? ratedWorks.reduce((acc, w) => acc + (w.currentScore || 0), 0) / ratedWorks.length 
      : 0;

    this.state.stats = {
      total,
      averageScore,
      completed: works.filter(w => w.status === MediaListStatus.COMPLETED).length,
      inProgress: works.filter(w => w.status === MediaListStatus.CURRENT || w.status === MediaListStatus.REWATCHING).length,
      planned: works.filter(w => w.status === MediaListStatus.PLANNING).length
    };
  }

  /**
   * Notify all subscribers
   */
  private notify(): void {
    this.listeners.forEach(l => l(this.state));
  }

  /**
   * Persist relevant state parts
   */
  private async persist(): Promise<void> {
    try {
      const toSave = {
        type: this.state.type,
        status: this.state.status,
        anilistStatus: this.state.anilistStatus,
        country: this.state.country,
        sort: this.state.sort,
        isGrouped: this.state.isGrouped
      };
      await this.storage.set(this.STORAGE_KEY, toSave);
    } catch (e) {
      log.error('[AstraStore] Failed to persist state', e);
    }
  }
}
