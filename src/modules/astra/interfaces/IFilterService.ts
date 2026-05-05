/**
 * @file IFilterService.ts
 * @description Contract for the business logic responsible for filtering and sorting Astra data.
 */

import { AstraWorkSummary } from '../AstraService';
import { IDashboardFilters, AstraSortType } from './IDashboardState';

/**
 * Service responsible for efficient data filtering and sorting.
 * Should handle logic isolation from UI components.
 */
export interface IFilterService {
  /**
   * Filters a collection of works based on provided criteria.
   * 
   * @param works - The source collection of Astra works.
   * @param filters - The active filtering criteria.
   * @returns A filtered subset of the works.
   */
  filter(works: AstraWorkSummary[], filters: IDashboardFilters): AstraWorkSummary[];

  /**
   * Sorts a collection of works based on a specific criteria.
   * 
   * @param works - The collection to sort.
   * @param sortType - The sorting algorithm to apply.
   * @returns The sorted collection.
   */
  sort(works: AstraWorkSummary[], sortType: AstraSortType): AstraWorkSummary[];

  /**
   * Performs fuzzy search across title, and searchable metadata.
   * 
   * @param works - The collection to search within.
   * @param query - The search string.
   */
  search(works: AstraWorkSummary[], query: string): AstraWorkSummary[];
}
