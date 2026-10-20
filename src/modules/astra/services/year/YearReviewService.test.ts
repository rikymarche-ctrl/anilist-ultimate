import { describe, expect, it, vi } from 'vitest';
import { validateApiRequest } from '@/api/ApiBoundary';
import {
  YEAR_ACTIVITY_QUERY,
  YEAR_MEDIA_QUERY,
  YEAR_SOCIAL_QUERY,
  yearPriorQuery,
} from '@/api/queries/year-review';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '../../utils/AstraConstants';
import { YearReviewService } from './YearReviewService';

const owner = 42;
const period = { start: '2024-01-01', end: '2024-12-31' };
const at = (date: string) => new Date(`${date}T12:00:00`).getTime() / 1000;
const activity = (
  id: number,
  mediaId: number,
  status: string,
  progress: string | null,
  date: string
) => ({
  id,
  userId: owner,
  status,
  progress,
  createdAt: at(date),
  likeCount: 0,
  replyCount: 0,
  likes: [],
  media: { id: mediaId },
});
const mediaRow = (id: number) => ({
  id,
  type: 'ANIME',
  format: 'TV',
  episodes: 12,
  chapters: null,
  duration: 24,
  countryOfOrigin: 'JP',
  source: 'ORIGINAL',
  seasonYear: 2024,
  startDate: null,
  title: { userPreferred: `Title ${id}` },
  coverImage: null,
  genres: [],
  meanScore: 70,
  popularity: 10,
  tags: [],
  studios: null,
  staff: null,
  characters: null,
  stats: null,
  mediaListEntry: { score: 0, status: 'COMPLETED', private: false, hiddenFromStatusLists: false },
});
const social = {
  posts: { pageInfo: { hasNextPage: false }, activities: [] },
  messages: { pageInfo: { hasNextPage: false }, activities: [] },
  User: { id: owner, statistics: { anime: { genres: [{ genre: 'Drama', count: 2 }] } } },
};

function fixture() {
  let sessionId = 'one';
  const astra = {
    exportJSON: vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        manifest: [],
        works: {},
        sections: DEFAULT_SECTIONS,
        settings: DEFAULT_SETTINGS,
      })
    ),
    calcSeriesOverall: () => null,
  };
  const pages = [
    {
      Page: {
        pageInfo: { hasNextPage: true },
        activities: [
          activity(1, 10, 'completed', null, '2024-02-01'),
          activity(2, 11, 'plans to watch', null, '2024-02-02'),
        ],
      },
    },
    {
      Page: {
        pageInfo: { hasNextPage: false },
        activities: [
          activity(3, 12, 'watched episode', '1 - 3', '2024-03-01'),
          activity(4, 12, 'completed', null, '2024-03-02'),
        ],
      },
    },
  ];
  const query = vi.fn(async (text: string, variables: Record<string, unknown>) => {
    if (text === YEAR_ACTIVITY_QUERY) return pages[(variables.page as number) - 1];
    if (text === YEAR_SOCIAL_QUERY) return social;
    if (text === YEAR_MEDIA_QUERY)
      return { Page: { media: (variables.ids as number[]).map(mediaRow) } };
    return {
      m0: {
        activities: [
          {
            userId: owner,
            status: 'watched episode',
            progress: '1 - 8',
            media: { id: variables.m0 },
          },
        ],
      },
    };
  });
  const api = {
    ensureContext: async () => ({ sessionId, userId: owner }),
    getContext: () => ({ sessionId, userId: owner }),
    getCurrentUserId: async () => owner,
    isAuthenticated: () => true,
    query,
  };
  return {
    api,
    astra,
    service: new YearReviewService(astra as never, api as never),
    switchSession: () => {
      sessionId = 'two';
    },
  };
}

describe('Astra Wrapped loading', () => {
  it('passes the production API boundary', () => {
    const variables = { userId: owner, page: 1, after: 0, before: 1 };
    for (const query of [YEAR_ACTIVITY_QUERY, YEAR_SOCIAL_QUERY])
      expect(validateApiRequest({ method: 'query', query, variables }).method).toBe('query');
    expect(
      validateApiRequest({ method: 'query', query: YEAR_MEDIA_QUERY, variables: { ids: [1] } })
        .method
    ).toBe('query');
    expect(
      validateApiRequest({
        method: 'query',
        query: yearPriorQuery(10),
        variables: { userId: owner, before: 1, m9: 3 },
      }).method
    ).toBe('query');
    expect(() => yearPriorQuery(11)).toThrow('batch');
  });
  it('pages through activity, skips planning-only titles and looks up earlier progress only when needed', async () => {
    const f = fixture();
    const steps: string[] = [];
    const data = await f.service.load(
      period,
      () => true,
      (step) => steps.push(step)
    );
    expect(data.input.activities).toHaveLength(4);
    const mediaCall = f.api.query.mock.calls.find(([text]) => text === YEAR_MEDIA_QUERY)!;
    expect(mediaCall[1]).toEqual({ ids: [10, 12] });
    const priorCalls = f.api.query.mock.calls.filter(([text]) =>
      text.startsWith('query YearPrior')
    );
    expect(priorCalls).toHaveLength(1);
    expect(priorCalls[0][1]).toMatchObject({ m0: 10, userId: owner });
    expect(data.input.priorProgress).toEqual({ 10: 8 });
    expect(data.input.allTimeGenres).toEqual([{ name: 'Drama', count: 2 }]);
    expect(steps.length).toBeGreaterThan(3);
  });
  it('reuses a recent result for the same account and period, and reloads after an account change', async () => {
    const f = fixture();
    await f.service.load(period, () => true);
    const calls = f.api.query.mock.calls.length;
    await f.service.load(period, () => true);
    expect(f.api.query.mock.calls.length).toBe(calls);
    expect(f.astra.exportJSON).toHaveBeenCalledTimes(2); // Astra privacy and scores are never served from the cache.
    f.switchSession();
    await f.service.load(period, () => true);
    expect(f.api.query.mock.calls.length).toBe(calls * 2);
  });
  it('stops when the view closes and refuses signed-out users', async () => {
    const f = fixture();
    await expect(f.service.load(period, () => false)).rejects.toThrow('closed');
    const signedOut = new YearReviewService(
      f.astra as never,
      { ...f.api, isAuthenticated: () => false } as never
    );
    await expect(signedOut.load(period, () => true)).rejects.toThrow('Sign in');
  });
});
