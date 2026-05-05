/**
 * @file AstraFilterService.ts
 * @description Implementation of the filtering and sorting engine for Astra works.
 */

import { injectable } from 'tsyringe';
import { AstraWork } from '../AstraService';
import { IFilterService } from '../interfaces/IFilterService';
import { IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';

/**
 * Enterprise implementation of the Astra filtering engine.
 * Provides optimized filtering and sorting for large datasets.
 */
@injectable()
export class AstraFilterService implements IFilterService {
  /**
   * Filters works based on multiple criteria.
   * Implementation note: Uses a combined filter pass for O(n) performance.
   */
  public filter(works: AstraWork[], filters: IDashboardFilters): AstraWork[] {
    let result = works;

    // 1. Media Type Filter
    if (filters.type !== 'all') {
      result = result.filter(w => w.type === filters.type);
    }

    // 2. Status Filter
    if (filters.status !== 'all') {
      result = result.filter(w => w.status === filters.status);
    }

    // 3. Country Filter
    if (filters.country !== 'all') {
      result = result.filter(w => w.country === filters.country);
    }

    // 4. AniList Sync Status Filter
    if (filters.anilistStatus !== 'all') {
      if (filters.anilistStatus === 'synced') {
        result = result.filter(w => !!w.anilistUrl);
      } else {
        result = result.filter(w => !w.anilistUrl);
      }
    }

    // 5. Search (if query exists)
    if (filters.search && filters.search.trim() !== '') {
      result = this.search(result, filters.search);
    }

    return result;
  }

  /**
   * Performs fuzzy-like search across multiple searchable fields.
   */
  public search(works: AstraWork[], query: string): AstraWork[] {
    const q = query.toLowerCase().trim();
    return works.filter(w => 
      w.title.toLowerCase().includes(q) ||
      w.notes?.toLowerCase().includes(q) ||
      w.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Sorts works based on the selected criteria.
   */
  public sort(works: AstraWork[], sortType: AstraSortType): AstraWork[] {
    const sorted = [...works]; // Avoid mutating original reference

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
        return sorted.sort((a, b) => (this.getOverallScore(b) || 0) - (this.getOverallScore(a) || 0));
      case 'score-asc':
        return sorted.sort((a, b) => (this.getOverallScore(a) || 0) - (this.getOverallScore(b) || 0));
      default:
        return sorted;
    }
  }

  /**
   * Helper to get a stable score for sorting
   */
  private getOverallScore(work: AstraWork): number | null {
    if (!work.seasons || work.seasons.length === 0) return null;
    const latest = work.seasons[work.seasons.length - 1];
    return latest.legacyScore || null;
  }
}
