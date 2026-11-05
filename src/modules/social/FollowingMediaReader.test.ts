import { describe, expect, it, vi } from 'vitest';
import {
  buildFollowingMediaQuery,
  FOLLOWING_MEDIA_QUERY,
  FollowingMediaReader,
  parseFollowingMedia,
} from './FollowingMediaReader';

describe('following media response', () => {
  it('keeps valid followings once, and drops malformed or insecure entries individually', () => {
    const response = {
      Page: {
        following: [
          {
            status: 'CURRENT',
            score: 80,
            user: { id: 2, name: 'ann', avatar: { large: 'https://example.com/a.png' } },
          },
          {
            status: 'CURRENT',
            score: 80,
            user: { id: 2, name: 'ann', avatar: { large: 'https://example.com/a.png' } },
          },
          {
            status: 'NOT_A_STATUS',
            score: null,
            user: { id: 3, name: 'bob', avatar: { large: null } },
          },
          { status: 'PLANNING', score: 101, user: { id: 4, name: 'eve', avatar: { large: null } } },
          {
            status: 'PLANNING',
            score: null,
            user: { id: 5, name: 'dan', avatar: { large: 'http://insecure.example/a.png' } },
          },
        ],
      },
    };
    expect(parseFollowingMedia(response)).toEqual([
      { userId: 2, name: 'ann', avatar: 'https://example.com/a.png', status: 'CURRENT', score: 80 },
      { userId: 5, name: 'dan', avatar: '', status: 'PLANNING', score: null },
    ]);
  });

  it('rejects a response without a following list', () => {
    expect(() => parseFollowingMedia({ Page: {} })).toThrow('Invalid following media response');
  });

  it('reads with a background (non-priority) request and formats with the viewer score format', async () => {
    const api = {
      query: vi.fn(async () => ({
        Page: {
          following: [
            { status: 'CURRENT', score: 70, user: { id: 2, name: 'ann', avatar: { large: null } } },
          ],
        },
      })),
      getCurrentUser: vi.fn(async () => ({ mediaListOptions: { scoreFormat: 'POINT_10' } })),
    };
    const result = await new FollowingMediaReader(api as never).read(1);
    expect(api.query).toHaveBeenCalledWith(buildFollowingMediaQuery(false), { mediaId: 1 }, true, {
      priority: false,
    });
    expect(FOLLOWING_MEDIA_QUERY).toContain('isFollowing: true');
    expect(result.scoreFormat).toBe('POINT_10');
    expect(result.entries).toHaveLength(1);
  });
});

describe('following media members', () => {
  const entry = (id: number, name: string, status = 'CURRENT') => ({
    status,
    score: null,
    user: { id, name, avatar: { large: null } },
  });

  it('lists group members before followings and keeps the member entry for a duplicate user', () => {
    const response = {
      Page: {
        members: [entry(9, 'member'), entry(2, 'member-copy')],
        following: [entry(2, 'ann'), entry(3, 'bob')],
      },
    };
    expect(parseFollowingMedia(response).map((item) => item.name)).toEqual([
      'member',
      'member-copy',
      'bob',
    ]);
  });

  it('accepts a response without a members alias', () => {
    expect(parseFollowingMedia({ Page: { following: [entry(3, 'bob')] } })).toHaveLength(1);
  });

  it('sends member ids only when there are some, deduplicated and validated', async () => {
    const api = {
      query: vi.fn(async () => ({ Page: { following: [] } })),
      getCurrentUser: vi.fn(async () => ({ mediaListOptions: { scoreFormat: 'POINT_100' } })),
    };
    const reader = new FollowingMediaReader(api as never);
    await reader.read(1, [5, 5, -1, 7]);
    expect(api.query).toHaveBeenLastCalledWith(
      buildFollowingMediaQuery(true),
      { mediaId: 1, members: [5, 7] },
      true,
      { priority: false }
    );
    expect(FOLLOWING_MEDIA_QUERY).toContain('userId_in: $members');
    await reader.read(1, []);
    expect(api.query).toHaveBeenLastCalledWith(
      buildFollowingMediaQuery(false),
      { mediaId: 1 },
      true,
      { priority: false }
    );
    expect(buildFollowingMediaQuery(false)).not.toContain('userId_in');
  });
  it('never declares $members when the query does not use it', () => {
    // AniList answers 400 "Variable is never used" otherwise.
    expect(buildFollowingMediaQuery(false)).not.toContain('$members');
    expect(buildFollowingMediaQuery(true)).toContain('$members: [Int]');
  });
});
