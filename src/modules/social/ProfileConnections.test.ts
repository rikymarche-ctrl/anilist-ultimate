import { describe, expect, it, vi } from 'vitest';
import { validateApiRequest } from '@/api/ApiBoundary';
import type { IApiClient } from '@core/interfaces/IApiClient';
import {
  CONNECTIONS_MAX_PAGES,
  attributeLists,
  buildRelationsQuery,
  computeConnections,
  fetchRelations,
  formatConnectionsSummary,
  formatTally,
  intersectUsers,
  pagesFor,
  type SocialUser,
} from './ProfileConnections';

const user = (id: number, name = `user${id}`): SocialUser => ({ id, name, avatar: { medium: '' } });
const usersPage = (relation: 'followers' | 'following', ids: number[], hasNextPage: boolean) => ({
  pageInfo: { hasNextPage },
  [relation]: ids.map((id) => ({ id, name: `user${id}`, avatar: { medium: '' } })),
});
const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

function apiReturning(response: unknown) {
  const query = vi.fn().mockResolvedValue(response);
  return { api: { query } as unknown as IApiClient, query };
}

describe('profile relations query', () => {
  it('reads every page as an aliased Page root that passes the API operation allowlist', () => {
    const query = buildRelationsQuery({ followers: CONNECTIONS_MAX_PAGES, following: CONNECTIONS_MAX_PAGES }, [
      'mutualFollowers',
      'threadComments',
    ]);
    expect(query).toContain('followers10: Page(page: 10, perPage: 50)');
    expect(() => validateApiRequest({ method: 'query', query, variables: { userId: 1 } })).not.toThrow();
  });

  it('refuses an unbounded plan', () => {
    expect(() => buildRelationsQuery({ followers: 15, following: 15 })).toThrow('Too many');
  });

  it('plans only the pages an exact total needs, up to the cap', () => {
    expect(pagesFor(0, 10)).toBe(0);
    expect(pagesFor(50, 10)).toBe(1);
    expect(pagesFor(51, 10)).toBe(2);
    expect(pagesFor(3524, 10)).toBe(10);
  });
});

describe('intersection', () => {
  it('keeps only the viewer followings present in the profile list, sorted by name', () => {
    const viewer = [user(1, 'zed'), user(2, 'Amy'), user(3, 'bob')];
    expect(intersectUsers(viewer, [user(3), user(2), user(9)]).map((entry) => entry.name)).toEqual([
      'Amy',
      'bob',
    ]);
  });

  it('excludes the viewer and the profile itself, and deduplicates', () => {
    const viewer = [user(1), user(2), user(2), user(5)];
    expect(
      intersectUsers(viewer, [user(1), user(2), user(5)], new Set([1, 5])).map((entry) => entry.id)
    ).toEqual([2]);
  });

  it('computes followers in common and following separately', () => {
    const viewer = [user(1), user(2), user(3), user(4)];
    const result = computeConnections(
      viewer,
      {
        followers: [user(1), user(2), user(3)],
        followersComplete: true,
        following: [user(4)],
        followingComplete: false,
      },
      {},
      new Set()
    );
    expect(result.followers.users.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(result.following).toEqual({ users: [user(4)], complete: false });
    expect(formatConnectionsSummary(result)).toBe('3 followers in common, at least 1 following');
  });
});

describe('custom list attribution', () => {
  const lists = {
    'Best Friends': [
      { id: 2, name: 'user2', avatar: '' },
      { id: 8, name: 'user8', avatar: '' },
    ],
    Rivals: [
      { id: 2, name: 'user2', avatar: '' },
      { id: 4, name: 'user4', avatar: '' },
    ],
    Empty: [],
  };

  it('names each list with only its connected members and drops lists without any', () => {
    expect(attributeLists(lists, [user(2), user(4)])).toEqual([
      { name: 'Best Friends', users: [user(2)] },
      { name: 'Rivals', users: [user(2), user(4)] },
    ]);
  });

  it('attributes members connected on either side once, and renders the example line', () => {
    const result = computeConnections(
      [user(1), user(2), user(3), user(4)],
      {
        followers: [user(1), user(3), user(2)],
        followersComplete: true,
        following: [user(2)],
        followingComplete: true,
      },
      { 'Best Friends': [{ id: 2, name: 'user2', avatar: '' }] },
      new Set()
    );
    expect(result.lists).toEqual([{ name: 'Best Friends', users: [user(2)] }]);
    expect(formatConnectionsSummary(result)).toBe(
      '3 followers in common, 1 following (1 in Best Friends)'
    );
  });

  it('uses the singular for one follower in common', () => {
    const result = computeConnections(
      [user(1)],
      { followers: [user(1)], followersComplete: true, following: [], followingComplete: true },
      {},
      new Set()
    );
    expect(formatConnectionsSummary(result)).toBe('1 follower in common');
  });
});

describe('single request with a page cap', () => {
  it('reads all planned pages in one request and marks a capped relation incomplete', async () => {
    const response = Object.fromEntries(
      range(1, 10).map((page) => [`followers${page}`, usersPage('followers', range((page - 1) * 50 + 1, 50), true)])
    );
    const { api, query } = apiReturning(response);
    const result = await fetchRelations(api, 7, { followers: 10 }, []);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual({ userId: 7 });
    expect(result.tallies.followers).toEqual({ count: 500, complete: false });
    expect(result.users.followers).toHaveLength(500);
  });

  it('is complete when a page reports no next page, ignoring later empty pages', async () => {
    const { api, query } = apiReturning({
      followers1: usersPage('followers', [1, 2], false),
      following1: usersPage('following', range(10, 50), true),
      following2: usersPage('following', [99], false),
    });
    const result = await fetchRelations(api, 7, { followers: 1, following: 2 }, []);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.tallies).toEqual({
      followers: { count: 2, complete: true },
      following: { count: 51, complete: true },
    });
  });

  it('counts threads and messages by rows and reads exact totals in the same request', async () => {
    const { api, query } = apiReturning({
      threads1: { pageInfo: { hasNextPage: true }, threads: range(1, 50).map((id) => ({ id })) },
      threads2: { pageInfo: { hasNextPage: true }, threads: range(51, 50).map((id) => ({ id })) },
      messages1: { pageInfo: { hasNextPage: false }, activities: [{ id: 9 }, {}] },
      messages2: { pageInfo: { hasNextPage: false }, activities: [] },
      mutualFollowers: { pageInfo: { total: 15 }, mutualFollowers: [{ id: 1 }] },
      threadComments: { pageInfo: { total: 5000 }, threadComments: [{ id: 1 }] },
    });
    const result = await fetchRelations(api, 7, { threads: 2, messages: 2 }, ['mutualFollowers', 'threadComments']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.tallies.threads).toEqual({ count: 100, complete: false });
    expect(result.tallies.messages).toEqual({ count: 1, complete: true });
    expect(result.totals.mutualFollowers).toEqual({ count: 15, complete: true });
    expect(formatTally(result.totals.threadComments!)).toBe('5000+');
    expect(formatTally(result.tallies.threads!)).toBe('100+');
  });

  it('counts only messages the profile sent, as the Messages tab does, without blocked recipients', async () => {
    const { api, query } = apiReturning({
      messages1: {
        pageInfo: { hasNextPage: false },
        activities: [
          { id: 1, recipient: { isBlocked: true } },
          { id: 2, recipient: { isBlocked: true } },
          { id: 3, recipient: { isBlocked: false } },
          { id: 4, recipient: null },
        ],
      },
    });
    const result = await fetchRelations(api, 7, { messages: 1 }, []);
    expect(query.mock.calls[0][0]).toContain('activities(messengerId: $userId, type: MESSAGE)');
    expect(query.mock.calls[0][0]).not.toContain('activities(userId:');
    expect(result.tallies.messages).toEqual({ count: 2, complete: true });
  });

  it('rejects malformed or missing pages instead of counting them', async () => {
    await expect(
      fetchRelations(apiReturning({ followers1: usersPage('followers', [-1], false) }).api, 7, { followers: 1 }, [])
    ).rejects.toThrow();
    await expect(fetchRelations(apiReturning({}).api, 7, { followers: 1 }, [])).rejects.toThrow();
  });

  it('discards the response when the account changed while it was in flight', async () => {
    const { api } = apiReturning({ followers1: usersPage('followers', [1], false) });
    const assertCurrent = () => {
      throw new Error('Astra account changed');
    };
    await expect(fetchRelations(api, 7, { followers: 1 }, [], assertCurrent)).rejects.toThrow('account changed');
  });
});
