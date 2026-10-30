import { describe, expect, it, vi } from 'vitest';
import { MediaListStatus } from '@/api/AnilistTypes';
import { validateApiRequest } from '@/api/ApiBoundary';
import type { ActivityFilterType } from './ActivityUtils';
import {
  activityTypesFor,
  FEED_MAX_PAGES_PER_LOAD,
  FilteredFeedCursor,
  FOLLOWING_FEED_QUERY,
  isNarrowing,
  matchesFeedFilter,
  USERS_FEED_QUERY,
  type FeedFilter,
} from './FilteredFeed';

const filter = (filters: ActivityFilterType[], search = ''): FeedFilter => ({
  filters: new Set(filters),
  search,
});

function listRow(id: number, status: string, progress: string | null = null, userId = 1) {
  return {
    id,
    type: status.includes('read') || status.includes('chapter') ? 'MANGA_LIST' : 'ANIME_LIST',
    userId,
    status,
    progress,
    createdAt: 1700000000 - id,
    isLiked: false,
    user: { id: userId, name: `user${userId}`, avatar: { medium: '' } },
    media: {
      id: 100 + id,
      title: { romaji: `Show ${id}`, userPreferred: `Show ${id}` },
      coverImage: { medium: '' },
      type: 'ANIME',
    },
    replyCount: 0,
    likeCount: 0,
  };
}

function textRow(id: number, text: string, userId = 1) {
  return {
    id,
    type: 'TEXT',
    userId,
    text,
    createdAt: 1700000000 - id,
    isLiked: false,
    user: { id: userId, name: `user${userId}`, avatar: { medium: '' } },
    replyCount: 0,
    likeCount: 0,
  };
}

const page = (activities: unknown[], hasNextPage: boolean) => ({
  Page: { pageInfo: { hasNextPage }, activities },
});

describe('filtered feed query shape', () => {
  it('narrows activity types on the server for each filter', () => {
    expect(activityTypesFor(new Set(['ALL']))).toEqual(['ANIME_LIST', 'MANGA_LIST', 'TEXT']);
    expect(activityTypesFor(new Set([MediaListStatus.WATCHING]))).toEqual(['ANIME_LIST']);
    expect(activityTypesFor(new Set(['REREAD']))).toEqual(['MANGA_LIST']);
    expect(activityTypesFor(new Set([MediaListStatus.DROPPED]))).toEqual([
      'ANIME_LIST',
      'MANGA_LIST',
    ]);
    expect(activityTypesFor(new Set(['TEXT']))).toEqual(['TEXT']);
  });

  it('treats only "All" without search as the plain feed', () => {
    expect(isNarrowing(filter(['ALL']))).toBe(false);
    expect(isNarrowing(filter(['ALL'], 'frieren'))).toBe(true);
    expect(isNarrowing(filter([MediaListStatus.PAUSED]))).toBe(true);
  });

  it('passes the extension API boundary for both sources', () => {
    const base = { types: ['ANIME_LIST'], page: 1, perPage: 50 };
    expect(() =>
      validateApiRequest({
        query: USERS_FEED_QUERY,
        variables: { ...base, userIds: [1] },
        method: 'query',
      })
    ).not.toThrow();
    expect(() =>
      validateApiRequest({ query: FOLLOWING_FEED_QUERY, variables: base, method: 'query' })
    ).not.toThrow();
  });
});

describe('matchesFeedFilter', () => {
  const parse = (row: ReturnType<typeof listRow>) => row as never;

  it('classifies list activities by their AniList status text', () => {
    expect(
      matchesFeedFilter(
        parse(listRow(1, 'watched episode', '3')),
        filter([MediaListStatus.WATCHING])
      )
    ).toBe(true);
    expect(
      matchesFeedFilter(
        parse(listRow(1, 'watched episode', '3')),
        filter([MediaListStatus.READING])
      )
    ).toBe(false);
    expect(
      matchesFeedFilter(parse(listRow(1, 'rewatched episode', '3')), filter(['REWATCHED']))
    ).toBe(true);
    expect(
      matchesFeedFilter(
        parse(listRow(1, 'rewatched episode', '3')),
        filter([MediaListStatus.WATCHING])
      )
    ).toBe(false);
    expect(matchesFeedFilter(parse(listRow(1, 'dropped')), filter([MediaListStatus.DROPPED]))).toBe(
      true
    );
    expect(
      matchesFeedFilter(parse(listRow(1, 'paused watching')), filter([MediaListStatus.PAUSED]))
    ).toBe(true);
    expect(
      matchesFeedFilter(parse(listRow(1, 'plans to read')), filter([MediaListStatus.PLANNING]))
    ).toBe(true);
  });

  it('searches user, title and the words of text posts, not their markup', () => {
    const post = {
      id: 9,
      type: 'TEXT',
      html: '<p>Loving <strong>Frieren</strong></p>',
      user: { name: 'Mika' },
    } as never;
    expect(matchesFeedFilter(post, filter(['ALL'], 'frieren'))).toBe(true);
    expect(matchesFeedFilter(post, filter(['ALL'], 'mika'))).toBe(true);
    expect(matchesFeedFilter(post, filter(['ALL'], 'strong'))).toBe(false);
    expect(matchesFeedFilter(parse(listRow(4, 'completed')), filter(['ALL'], 'show 4'))).toBe(true);
  });
});

describe('FilteredFeedCursor', () => {
  it('pages until enough rows match, then continues where it stopped', async () => {
    const dropped = Array.from({ length: 12 }, (_, i) => listRow(i + 1, 'dropped'));
    const watched = Array.from({ length: 38 }, (_, i) => listRow(100 + i, 'watched episode', '1'));
    const query = vi
      .fn()
      .mockResolvedValueOnce(page([...dropped, ...watched], true))
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 10 }, (_, i) => listRow(200 + i, 'dropped')),
          true
        )
      )
      .mockResolvedValueOnce(page([listRow(300, 'dropped')], false));
    const cursor = new FilteredFeedCursor(
      { query } as never,
      { kind: 'users', userIds: [1] },
      filter([MediaListStatus.DROPPED])
    );

    const first = await cursor.next();
    expect(first.activities).toHaveLength(22);
    expect(first.hasMore).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual({
      types: ['ANIME_LIST', 'MANGA_LIST'],
      page: 1,
      perPage: 50,
      userIds: [1],
    });

    const second = await cursor.next();
    expect(second.activities.map((a) => a.id)).toEqual([300]);
    expect(second.hasMore).toBe(false);
    expect(query.mock.calls[2][1]).toMatchObject({ page: 3 });
  });

  it('stops after a bounded number of pages for a rare filter', async () => {
    let next = 1;
    const query = vi.fn(async (_query: string, _variables: unknown) =>
      page([listRow(next++, 'watched episode', '1')], true)
    );
    const cursor = new FilteredFeedCursor(
      { query } as never,
      { kind: 'following' },
      filter([MediaListStatus.PAUSED])
    );
    const batch = await cursor.next();
    expect(batch.activities).toEqual([]);
    expect(batch.hasMore).toBe(true);
    expect(query).toHaveBeenCalledTimes(FEED_MAX_PAGES_PER_LOAD);
    expect(query.mock.calls[0][0]).toBe(FOLLOWING_FEED_QUERY);
  });

  it('rejects rows from users outside the custom list', async () => {
    const query = vi.fn(async () => page([listRow(1, 'dropped', null, 99)], false));
    const cursor = new FilteredFeedCursor(
      { query } as never,
      { kind: 'users', userIds: [1] },
      filter(['ALL'])
    );
    await expect(cursor.next()).rejects.toThrow();
  });

  it('requests feed pages in the priority lane, ahead of background requests', async () => {
    const query = vi.fn(async (..._args: unknown[]) =>
      page([listRow(1, 'dropped', null, 1)], false)
    );
    for (const source of [{ kind: 'users', userIds: [1] }, { kind: 'following' }] as const) {
      await new FilteredFeedCursor({ query } as never, source, filter(['ALL'])).next();
    }
    expect(query.mock.calls.map((call) => call[3])).toEqual([
      { priority: true },
      { priority: true },
    ]);
  });

  it('keeps text posts for the text filter', async () => {
    const query = vi.fn(async () => page([textRow(5, '<p>hi</p>')], false));
    const cursor = new FilteredFeedCursor(
      { query } as never,
      { kind: 'users', userIds: [1] },
      filter(['TEXT'])
    );
    expect((await cursor.next()).activities.map((a) => a.id)).toEqual([5]);
  });
});
