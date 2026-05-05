/**
 * @file AstraFilterService.test.ts
 * @description Unit tests for the AstraFilterService logic.
 */

import { AstraFilterService } from '../src/modules/astra/services/AstraFilterService';
import { AstraWork } from '../src/modules/astra/AstraService';
import { IDashboardFilters } from '../src/modules/astra/interfaces/IDashboardState';
import { MediaListStatus } from '../src/api/AnilistTypes';

describe('AstraFilterService', () => {
  let service: AstraFilterService;
  let mockWorks: AstraWork[];

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
        seasons: [{ legacyScore: 10 }]
      },
      {
        mediaId: 2,
        title: 'Berserk',
        type: 'manga',
        status: MediaListStatus.CURRENT,
        updatedAt: 2000,
        anilistUrl: 'https://anilist.co/manga/2',
        seasons: [{ legacyScore: 9 }]
      }
    ] as any;
  });

  test('should filter by media type', () => {
    const filters: Partial<IDashboardFilters> = { type: 'anime', status: 'all', anilistStatus: 'all' };
    const result = service.filter(mockWorks, filters as any);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Cowboy Bebop');
  });

  test('should perform fuzzy search on title', () => {
    const result = service.search(mockWorks, 'ber');
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Berserk');
  });

  test('should sort by updatedAt descending', () => {
    const sorted = service.sort(mockWorks, 'updated-desc');
    expect(sorted[0].mediaId).toBe(2);
    expect(sorted[1].mediaId).toBe(1);
  });

  test('should sort by score descending', () => {
    const sorted = service.sort(mockWorks, 'score-desc');
    expect(sorted[0].mediaId).toBe(1); // 10 vs 9
  });
});
