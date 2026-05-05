/**
 * @file AstraDashboardController.ts
 * @description Orchestrator for the Astra Dashboard. 
 * Manages state, coordinates services, and provides data to UI components.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { AstraService } from '../AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IDashboardController } from '../interfaces/IDashboardController';
import type { IFilterService } from '../interfaces/IFilterService';
import type { IStatsService } from '../interfaces/IStatsService';
import { IDashboardState, IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';

/**
 * Enterprise implementation of the Dashboard Controller.
 * Handles the state lifecycle and coordination of specialized services.
 */
@injectable()
export class AstraDashboardController implements IDashboardController {
  private state: IDashboardState;
  private listeners: Array<(state: IDashboardState) => void> = [];

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.AstraFilterService) private filterService: IFilterService,
    @inject(TOKENS.AstraStatsService) private statsService: IStatsService,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {
    // Initial empty state
    this.state = this.getInitialState();
  }

  /**
   * Initializes the dashboard and performs initial data processing.
   */
  public async open(): Promise<void> {
    log.info('[AstraDashboardController] Initializing dashboard...');
    
    try {
      this.updateState({ isLoading: true, error: null });
      
      // Ensure service is initialized
      await this.astraService.init();
      
      const allWorks = this.astraService.getWorks();
      
      // Calculate initial filtered data and stats
      const filtered = this.filterService.filter(allWorks, this.state.filters);
      const sorted = this.filterService.sort(filtered, this.state.sort);
      const stats = this.statsService.calculateStats(sorted);

      this.updateState({
        filteredWorks: sorted,
        stats: stats,
        isLoading: false
      });

      log.success('[AstraDashboardController] Dashboard ready.');
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown initialization error';
      log.error('[AstraDashboardController] Failed to initialize', error);
      this.updateState({ isLoading: false, error });
    }
  }

  /**
   * Cleanup on close.
   */
  public close(): void {
    log.debug('[AstraDashboardController] Closing dashboard.');
    this.listeners = []; // Clear subscribers
  }

  /**
   * Returns a snapshot of the current state.
   */
  public getState(): IDashboardState {
    return { ...this.state };
  }

  /**
   * Reactive state updates for UI components.
   */
  public subscribe(listener: (state: IDashboardState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Updates filters and refreshes the data view.
   */
  public setFilters(filters: Partial<IDashboardFilters>): void {
    const newFilters = { ...this.state.filters, ...filters };
    this.refreshView(newFilters, this.state.sort);
  }

  /**
   * Updates sort criteria and refreshes the view.
   */
  public setSort(sort: AstraSortType): void {
    this.refreshView(this.state.filters, sort);
  }

  /**
   * Switches the active navigation tab.
   */
  public setTab(tab: 'dashboard' | 'settings'): void {
    this.updateState({ activeTab: tab });
  }

  /**
   * Triggers AniList synchronization and refreshes local state.
   */
  public async syncWithAnilist(): Promise<void> {
    try {
      this.updateState({ isLoading: true });
      await this.astraService.syncWithAniList(this.apiClient);
      await this.open(); // Re-run initialization to refresh data
    } catch (err) {
      log.error('[AstraDashboardController] Sync failed', err);
      this.updateState({ isLoading: false, error: 'Synchronization failed' });
    }
  }

  /**
   * Internal method to refresh the view based on current filters/sort.
   */
  private refreshView(filters: IDashboardFilters, sort: AstraSortType): void {
    const allWorks = this.astraService.getWorks();
    const filtered = this.filterService.filter(allWorks, filters);
    const sorted = this.filterService.sort(filtered, sort);
    const stats = this.statsService.calculateStats(sorted);

    this.updateState({
      filters,
      sort,
      filteredWorks: sorted,
      stats
    });
  }

  /**
   * Core state mutation logic. Triggers all listeners.
   */
  private updateState(partialState: Partial<IDashboardState>): void {
    this.state = { ...this.state, ...partialState };
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Factory for the default state.
   */
  private getInitialState(): IDashboardState {
    return {
      filters: {
        search: '',
        type: 'all',
        status: 'all',
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
  }
}
