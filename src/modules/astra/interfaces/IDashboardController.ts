/**
 * @file IDashboardController.ts
 * @description Contract for the high-level orchestrator of the Astra Dashboard.
 */

import { IDashboardState, IDashboardFilters, AstraSortType } from './IDashboardState';

/**
 * Interface for the primary controller that manages the dashboard lifecycle.
 * Acts as the bridge between Domain Services and the UI Components.
 */
export interface IDashboardController {
  /**
   * Initializes the dashboard, loading data and preparing the initial state.
   */
  open(): Promise<void>;

  /**
   * Closes the dashboard and performs necessary cleanup.
   */
  close(): void;

  /**
   * Updates the active filters and triggers a state refresh.
   * 
   * @param filters - Partial or full filter configuration.
   */
  setFilters(filters: Partial<IDashboardFilters>): void;

  /**
   * Updates the sorting criteria and refreshes the view.
   * 
   * @param sort - The new sorting type.
   */
  setSort(sort: AstraSortType): void;

  /**
   * Switches the active tab in the dashboard.
   * 
   * @param tab - The tab to switch to ('dashboard' | 'settings').
   */
  setTab(tab: 'dashboard' | 'settings'): void;

  /**
   * Returns the current immutable state of the dashboard.
   */
  getState(): IDashboardState;

  /**
   * Subscribes to state changes for reactive UI updates.
   * 
   * @param listener - Callback function triggered on state changes.
   * @returns Unsubscribe function.
   */
  subscribe(listener: (state: IDashboardState) => void): () => void;

  /**
   * Triggers a manual synchronization with AniList.
   */
  syncWithAnilist(): Promise<void>;
}
