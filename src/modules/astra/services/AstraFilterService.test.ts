/**
 * @file AstraFilterService.test.ts
 * @description Unit tests for the AstraFilterService logic.
 * (Relocated from /tests so vitest's `src/**` include actually runs it.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AstraFilterService } from './AstraFilterService';
import type { IDashboardFilters } from '../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

describe('AstraFilterService', () => {
  let service: AstraFilterService;
  // Typed as any: the service consumes AstraWorkSummary; these fixtures only
  // populate the fields the filter/sort/search logic actually reads.
  let mockWorks: any[];

  beforeEach(() => {
    service = new AstraFilterService();
    mockWorks = [
      {
        mediaId: 1,
        title: 'Cowboy Bebop',
        type: 'anime',
        status: MediaListStatus.COMPLETED,
        updatedAt: 1000,
        anilistUrl: 'https://anilist.co/anime/1',
        seasons: [{ legacyScore: 10 }],
      },
      {
        mediaId: 2,
        title: 'Berserk',
        type: 'manga',
        status: MediaListStatus.CURRENT,
        updatedAt: 2000,
        anilistUrl: 'https://anilist.co/manga/2',
        seasons: [{ legacyScore: 9 }],
      },
    ] as any;
  });

  it('filters by media type', () => {
    const filters: Partial<IDashboardFilters> = {
      type: 'anime',
      ratingStatus: 'all',
      anilistStatus: 'all',
    } as any;
    const result = service.filter(mockWorks, filters as any);
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
});
