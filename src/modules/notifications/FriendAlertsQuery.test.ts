import { describe, expect, it } from 'vitest';
import { friendAlertsBatch, FRIEND_ALERTS_QUERY, parseFriendAlertPage, type FriendAlertQueryInput } from './FriendAlertsQuery';
import { validateApiRequest } from '@/api/ApiBoundary';

describe('friend alert alias batching', () => {
  it('groups more than six audiences/checkpoints into one bounded GraphQL operation', () => {
    const inputs = Array.from({ length: 12 }, (_, index) => ({
      mediaIds: [index + 1, index + 100],
      users: index % 2 ? [2, 3] : undefined,
      following: index % 2 ? undefined : true,
      since: index + 1000,
      until: 1200,
      page: index + 1,
      ids: [index + 10],
      owner: 1,
      checkRecent: true,
    }));
    const batch = friendAlertsBatch(inputs);
    expect(() =>
      validateApiRequest({ query: batch.query, variables: batch.variables, method: 'query' })
    ).not.toThrow();
    for (const [index, input] of inputs.entries()) {
      for (const [key, value] of Object.entries(input))
        expect(batch.variables[`v${index}_${key}`]).toEqual(value);
      expect(
        batch.decode(
          { [`p${index}`]: { activities: [index] }, [`r${index}`]: { activities: ['recent'] } },
          index
        )
      ).toEqual({ Page: { activities: [index] }, recent: { activities: ['recent'] } });
    }
  });
  it('rejects an empty operation or an actual request-size overflow', () => {
    expect(() => friendAlertsBatch([])).toThrow('batch size');
    const input: FriendAlertQueryInput = { mediaIds: [10], following: true, owner: 1, since: 1000, until: 1200,
      page: 1, ids: [0], checkRecent: false };
    expect(() => friendAlertsBatch(Array.from({ length: 1000 }, () => input))).toThrow();
  });
  it('requests only fields used by the inbox and skips an empty recent lookup on the server', () => {
    expect(FRIEND_ALERTS_QUERY).toContain('mediaId_in: $mediaIds');
    expect(FRIEND_ALERTS_QUERY).toContain('@include(if: $checkRecent)');
    expect(FRIEND_ALERTS_QUERY).not.toMatch(/avatar|coverImage|replyCount|likeCount|romaji/);
  });
  it.each([{ mediaIds: [] }, { users: [], following: undefined }, { following: undefined }, { users: [2] }])('rejects filters that could become an unfiltered query: %j', patch => {
    expect(() => friendAlertsBatch([{ mediaIds: [10], following: true, owner: 1, since: 1000, until: 1200,
      page: 1, ids: [0], checkRecent: false, ...patch }])).toThrow('filters');
  });
  it('parses a compact response and rejects activities from other titles or audiences', () => {
    const input: FriendAlertQueryInput = { mediaIds: [10, 20], users: [2], owner: 1, since: 1000, until: 1200,
      page: 1, ids: [7], checkRecent: true };
    const row = { id: 7, type: 'ANIME_LIST', userId: 2, status: 'watched episode', progress: '3', createdAt: 1050,
      user: { id: 2, name: 'Friend' }, media: { id: 20, type: 'ANIME' } };
    expect(parseFriendAlertPage({ activities: [row], pageInfo: { hasNextPage: false } }, input).activities[0]).toMatchObject({ mediaId: 20, userName: 'Friend' });
    for (const invalid of [{ ...row, media: { ...row.media, id: 30 } }, { ...row, userId: 9 }, { ...row, createdAt: 1200 }, { ...row, type: 'TEXT' }]) {
      expect(() => parseFriendAlertPage({ activities: [invalid], pageInfo: { hasNextPage: false } }, input)).toThrow();
    }
    expect(() => parseFriendAlertPage({ activities: [{ ...row, id: 8 }] }, input, true)).toThrow();
  });
});
