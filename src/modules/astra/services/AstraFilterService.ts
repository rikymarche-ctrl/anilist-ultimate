/**
 * @file AstraFilterService.ts
 * @description Implementation of the filtering and sorting engine for Astra works.
 */

import { injectable } from 'tsyringe';
import type { AniListDate } from '@/api/AnilistTypes';
import type { AstraWorkSummary } from '../AstraInterfaces';
import { IFilterService } from '../interfaces/IFilterService';
import { IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';

/** Compare known components, without completing a fuzzy date into an invented day. */
function compareDates(a: AniListDate | null | undefined, b: AniListDate | null | undefined, direction: 1 | -1): number {
  const aKnown = typeof a?.year === 'number' && Number.isInteger(a.year) && a.year > 0 && a.year <= 2147483647;
  const bKnown = typeof b?.year === 'number' && Number.isInteger(b.year) && b.year > 0 && b.year <= 2147483647;
  // Unknown years form one stable bucket at the end, in either direction.
  if (!aKnown || !bKnown) return aKnown ? -1 : bKnown ? 1 : 0;
  for (const key of ['year', 'month', 'day'] as const) {
    const left = a![key]; const right = b![key];
    if (left === right) continue;
    // A known prefix precedes its more precise extension in ascending order;
    // descending reverses that order without treating the prefix as January 1.
    if (left == null) return -direction;
    if (right == null) return direction;
    if (left !== right) return (left - right) * direction;
  }
  return 0;
}

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
      result = result.filter((w) => w.type === filters.type);
    }

    // 2. Rating Status Filter
    if (filters.ratingStatus !== 'all') {
      result = result.filter((w) =>
        filters.ratingStatus === 'rated' ? w.currentScore !== null : w.currentScore === null
      );
    }

    // 3. AniList Status Filter
    if (filters.anilistStatus !== 'all') {
      const statuses = Array.isArray(filters.anilistStatus)
        ? filters.anilistStatus
        : [filters.anilistStatus];
      result = statuses.length > 0 ? result.filter((w) => statuses.includes(w.status)) : result;
    }

    // 4. Country Filter
    if (filters.country !== 'all') {
      result = result.filter((w) => w.country === filters.country);
    }

    // 5. Custom list filter (multi-select; incl. AniList's built-in Private /
    //    Hidden pseudo-lists). A work matches if it satisfies ANY selected list.
    if (filters.customLists && filters.customLists.length > 0) {
      result = result.filter((w) =>
        filters.customLists.some((sel) => {
          if (sel === '__private__') return !!w.isPrivate;
          if (sel === '__hidden__') return !!w.isHidden;
          return w.customLists?.includes(sel);
        })
      );
    }

    // 6. Search (if query exists)
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
    return works.filter(
      (w) => w.title.toLowerCase().includes(q) || w.genres?.some((g) => g.toLowerCase().includes(q))
    );
  }

  /**
   * Sorts works based on the selected criteria.
   */
  public sort(works: AstraWorkSummary[], sortType: AstraSortType): AstraWorkSummary[] {
    const sorted = [...works];

    switch (sortType) {
      case 'started-asc':
      case 'started-desc':
        return sorted.sort((a, b) => compareDates(a.startedAt, b.startedAt, sortType === 'started-asc' ? 1 : -1));
      case 'completed-asc':
      case 'completed-desc':
        return sorted.sort((a, b) => compareDates(a.completedAt, b.completedAt, sortType === 'completed-asc' ? 1 : -1));
      case 'updated-desc':
        return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      case 'updated-asc':
        return sorted.sort((a, b) => a.updatedAt - b.updatedAt);
      case 'title-asc':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'title-desc':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'type-asc':
        return sorted.sort((a, b) => (a.type || '').localeCompare(b.type || ''));
      case 'type-desc':
        return sorted.sort((a, b) => (b.type || '').localeCompare(a.type || ''));
      case 'progress-desc':
        return sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0));
      case 'progress-asc':
        return sorted.sort((a, b) => (a.progress || 0) - (b.progress || 0));
      case 'score-desc':
        return sorted.sort((a, b) => (b.currentScore || 0) - (a.currentScore || 0));
      case 'score-asc':
        return sorted.sort((a, b) => (a.currentScore || 0) - (b.currentScore || 0));
      default: {
        // Dynamic per-section sort: "section-<id>-asc" | "section-<id>-desc".
        const match = /^section-(.+)-(asc|desc)$/.exec(sortType);
        if (match) {
          const [, sectionId, dir] = match;
          return sorted.sort((a, b) => {
            const av = a.sectionScores?.[sectionId] ?? -1;
            const bv = b.sectionScores?.[sectionId] ?? -1;
            return dir === 'asc' ? av - bv : bv - av;
          });
        }
        return sorted;
      }
    }
  }
}
