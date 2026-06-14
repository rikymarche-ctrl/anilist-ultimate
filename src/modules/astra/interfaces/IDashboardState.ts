/**
 * @file IDashboardState.ts
 * @description Contract for the global state of the Astra Dashboard.
 * Includes search parameters, active filters, and calculated view data.
 */

import type { AstraWorkSummary } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';

/**
 * Valid sort directions and criteria for the dashboard grid
 */
export type AstraSortType = 
  | 'updated-desc' 
  | 'updated-asc' 
  | 'score-desc' 
  | 'score-asc' 
  | 'title-asc' 
  | 'progress-desc';

/**
 * Filter configuration for narrowing down the work list
 */
export interface IDashboardFilters {
  search: string;
  type: 'all' | 'anime' | 'manga' | 'novel';
  ratingStatus: 'all' | 'rated' | 'unrated';
  anilistStatus: 'all' | MediaListStatus[];
  country: 'all' | string;
  isGrouped: boolean;
}

/**
 * Statistical summary of the current dataset
 */
export interface IDashboardStats {
  totalCount: number;
  averageScore: number;
  completedCount: number;
  droppedCount: number;
  planningCount: number;
  genreDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
}

/**
 * The unified state object consumed by dashboard components
 */
export interface IDashboardState {
  filters: IDashboardFilters;
  sort: AstraSortType;
  stats: IDashboardStats;
  filteredWorks: AstraWorkSummary[];
  activeTab: 'dashboard' | 'settings';
  isLoading: boolean;
  error: string | null;
}
