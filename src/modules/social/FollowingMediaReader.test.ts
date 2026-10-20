import { describe, expect, it, vi } from 'vitest';
import {
  FOLLOWING_MEDIA_QUERY,
  FollowingMediaReader,
  parseFollowingMedia,
} from './FollowingMediaReader';

describe('following media response', () => {
  it('keeps valid followings once, and drops malformed or insecure entries individually', () => {
    const response = {
      Page: {
        mediaList: [
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

  it('rejects a response without a media list', () => {
    expect(() => parseFollowingMedia({ Page: {} })).toThrow('Invalid following media response');
  });

  it('reads with a background (non-priority) request and formats with the viewer score format', async () => {
    const api = {
      query: vi.fn(async () => ({
        Page: {
          mediaList: [
            { status: 'CURRENT', score: 70, user: { id: 2, name: 'ann', avatar: { large: null } } },
          ],
        },
      })),
      getCurrentUser: vi.fn(async () => ({ mediaListOptions: { scoreFormat: 'POINT_10' } })),
    };
    const result = await new FollowingMediaReader(api as never).read(1);
    expect(api.query).toHaveBeenCalledWith(FOLLOWING_MEDIA_QUERY, { mediaId: 1 }, true, {
      priority: false,
    });
    expect(FOLLOWING_MEDIA_QUERY).toContain('isFollowing: true');
    expect(result.scoreFormat).toBe('POINT_10');
    expect(result.entries).toHaveLength(1);
  });
});
