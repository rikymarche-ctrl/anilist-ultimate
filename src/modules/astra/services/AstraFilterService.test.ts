/**
 * @file AstraFilterService.test.ts
 * @description Unit tests for the AstraFilterService logic.
 * (Relocated from /tests so vitest's `src/**` include actually runs it.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AstraFilterService } from './AstraFilterService';
import type { IDashboardFilters, AstraSortType } from '../interfaces/IDashboardState';
import type { AstraWorkSummary } from '../AstraInterfaces';
import { MediaListStatus, type AniListDate } from '@/api/AnilistTypes';

describe('AstraFilterService', () => {
  let service: AstraFilterService;
  let mockWorks: AstraWorkSummary[];

  beforeEach(() => {
    service = new AstraFilterService();
    mockWorks = [
      {
        id: 'anime-1',
        mediaId: 1,
        title: 'Cowboy Bebop',
        type: 'anime',
        status: MediaListStatus.COMPLETED,
        updatedAt: 1000,
        currentScore: 10,
      },
      {
        id: 'manga-2',
        mediaId: 2,
        title: 'Berserk',
        type: 'manga',
        status: MediaListStatus.CURRENT,
        updatedAt: 2000,
        currentScore: 9,
      },
    ];
  });

  it('filters by media type', () => {
    const filters: IDashboardFilters = {
      type: 'anime',
      ratingStatus: 'all',
      anilistStatus: 'all',
      search: '', country: 'all', customLists: [], isGrouped: false,
    };
    const result = service.filter(mockWorks, filters);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Cowboy Bebop');
  });

  it('performs a fuzzy search on the title', () => {
    const result = service.search(mockWorks, 'ber');
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Berserk');
  });

  it('sorts by updatedAt descending', () => {
    const sorted = service.sort(mockWorks, 'updated-desc');
    expect(sorted[0].mediaId).toBe(2);
    expect(sorted[1].mediaId).toBe(1);
  });

  it('sorts by score descending', () => {
    const sorted = service.sort(mockWorks, 'score-desc');
    expect(sorted[0].mediaId).toBe(1); // 10 vs 9
  });
  const ids = (works: AstraWorkSummary[]) => works.map(work => work.id);
  it.each(['started', 'completed'] as const)('sorts %s dates by known fuzzy components with unknown years always last', field => {
    const key = field === 'started' ? 'startedAt' : 'completedAt';
    const dates: Array<[string, AniListDate | null | undefined]> = [
      ['missing', undefined], ['new', { year: 2028, month: 1, day: 1 }], ['year', { year: 2026, month: null, day: null }],
      ['null', null], ['month', { year: 2026, month: 2, day: null }], ['day', { year: 2026, month: 2, day: 3 }],
      ['no-year', { year: null, month: 3, day: 4 }], ['same-day', { year: 2026, month: 2, day: 3 }],
      ['old', { year: 4, month: 2, day: 29 }],
    ];
    const works = dates.map(([id, date]) => ({ ...mockWorks[0], id, [key]: date }));
    const snapshot = structuredClone(works);
    expect(ids(service.sort(works, `${field}-asc` as AstraSortType))).toEqual(['old', 'year', 'month', 'day', 'same-day', 'new', 'missing', 'null', 'no-year']);
    expect(ids(service.sort(works, `${field}-desc` as AstraSortType))).toEqual(['new', 'day', 'same-day', 'month', 'year', 'old', 'missing', 'null', 'no-year']);
    expect(works).toEqual(snapshot);
  });

  it('keeps local Updated sorting distinct from start/completion and does not interpret a missing date as epoch zero', () => {
    const works = [
      { ...mockWorks[0], id: 'updated-first', updatedAt: 50, startedAt: { year: 2020, month: 1, day: 1 }, completedAt: { year: 2026, month: 1, day: 1 } },
      { ...mockWorks[0], id: 'started-first', updatedAt: 10, startedAt: { year: 2025, month: 1, day: 1 }, completedAt: null },
      { ...mockWorks[0], id: 'completed-first', updatedAt: 20, startedAt: null, completedAt: { year: 2028, month: 1, day: 1 } },
    ];
    expect(ids(service.sort(works, 'updated-desc'))).toEqual(['updated-first', 'completed-first', 'started-first']);
    expect(ids(service.sort(works, 'started-desc'))).toEqual(['started-first', 'updated-first', 'completed-first']);
    expect(ids(service.sort(works, 'completed-desc'))).toEqual(['completed-first', 'updated-first', 'started-first']);
  });

  it('keeps huge fuzzy years and equal partial components stable without native Date limits', () => {
    const works = [
      { ...mockWorks[0], id: 'max-year', startedAt: { year: 2147483647, month: null, day: null } },
      { ...mockWorks[0], id: 'a', startedAt: { year: 2026, month: 2, day: null } },
      { ...mockWorks[0], id: 'b', startedAt: { year: 2026, month: 2, day: null } },
    ];
    const sorted = service.sort(works, 'started-asc'); expect(ids(sorted)).toEqual(['a', 'b', 'max-year']);
    expect(sorted).not.toBe(works); expect(sorted[0].startedAt).toEqual({ year: 2026, month: 2, day: null });
  });

});
