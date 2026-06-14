/**
 * @file AstraFilterService.ts
 * @description Implementation of the filtering and sorting engine for Astra works.
 */

import { injectable } from 'tsyringe';
import type { AstraWorkSummary } from '../AstraInterfaces';
import { IFilterService } from '../interfaces/IFilterService';
import { IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';

/**
 * Enterprise implementation of the Astra filtering engine.
 */
@injectable()
export class AstraFilterService implements IFilterService {
  /**
   * Filters works based on multiple criteria.
   */
  public filter(works: AstraWorkSummary[], filters: IDashboardFilters): AstraWorkSummary[] {
    let result = works;

    // 1. Media Type Filter
    if (filters.type !== 'all') {
      result = result.filter(w => w.type === filters.type);
    }

    // 2. Rating Status Filter
    if (filters.ratingStatus !== 'all') {
      result = result.filter(w => 
        filters.ratingStatus === 'rated' ? (w.currentScore !== null) : (w.currentScore === null)
      );
    }

    // 3. AniList Status Filter
    if (filters.anilistStatus !== 'all') {
      const statuses = Array.isArray(filters.anilistStatus)
        ? filters.anilistStatus
        : [filters.anilistStatus];
      result = statuses.length > 0
        ? result.filter(w => statuses.includes(w.status))
        : result;
    }

    // 4. Country Filter
    if (filters.country !== 'all') {
      result = result.filter(w => w.country === filters.country);
    }

    // 5. Search (if query exists)
    if (filters.search && filters.search.trim() !== '') {
      result = this.search(result, filters.search);
    }

    return result;
  }

  /**
   * Performs fuzzy-like search.
   */
  public search(works: AstraWorkSummary[], query: string): AstraWorkSummary[] {
    const q = query.toLowerCase().trim();
    return works.filter(w => 
      w.title.toLowerCase().includes(q) ||
      w.genres?.some(g => g.toLowerCase().includes(q))
    );
  }

  /**
   * Sorts works based on the selected criteria.
   */
  public sort(works: AstraWorkSummary[], sortType: AstraSortType): AstraWorkSummary[] {
    const sorted = [...works];

    switch (sortType) {
      case 'updated-desc':
        return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      case 'updated-asc':
        return sorted.sort((a, b) => a.updatedAt - b.updatedAt);
      case 'title-asc':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'progress-desc':
        return sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0));
      case 'score-desc':
        return sorted.sort((a, b) => (b.currentScore || 0) - (a.currentScore || 0));
      case 'score-asc':
        return sorted.sort((a, b) => (a.currentScore || 0) - (b.currentScore || 0));
      default:
        return sorted;
    }
  }
}
