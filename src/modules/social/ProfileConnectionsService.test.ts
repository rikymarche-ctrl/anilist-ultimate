import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileConnectionsService } from './ProfileConnectionsService';

const person = (id: number) => ({ id, name: `user${id}`, avatar: { medium: '' } });

describe('ProfileConnectionsService', () => {
  let context: { sessionId: string; userId: number | null };
  let api: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    ensureContext: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
  let social: {
    getViewerId: ReturnType<typeof vi.fn>;
    getFullUser: ReturnType<typeof vi.fn>;
    getAllFollowings: ReturnType<typeof vi.fn>;
  };
  let lists: { init: ReturnType<typeof vi.fn>; getLists: ReturnType<typeof vi.fn> };
  let service: ProfileConnectionsService;

  beforeEach(() => {
    context = { sessionId: 's1', userId: 1 };
    api = {
      isAuthenticated: vi.fn(() => true),
      ensureContext: vi.fn(async () => ({ ...context })),
      getContext: vi.fn(() => ({ ...context })),
      query: vi.fn(async () => ({
        followers1: { pageInfo: { hasNextPage: false }, followers: [person(2), person(3)] },
        following1: { pageInfo: { hasNextPage: false }, following: [person(3)] },
      })),
    };
    social = {
      getViewerId: vi.fn(async () => 1),
      getFullUser: vi.fn(async () => ({
        id: 50,
        name: 'Friend',
        avatar: { medium: '' },
        followers: 2,
        following: 1,
      })),
      getAllFollowings: vi.fn(async () => [person(2), person(3), person(4)]),
    };
    lists = {
      init: vi.fn(async () => undefined),
      getLists: vi.fn(() => ({ 'Best Friends': [{ id: 3, name: 'user3', avatar: '' }] })),
    };
    service = new ProfileConnectionsService(api as never, social as never, lists as never);
  });

  it('shows nothing and makes no request when the extension is not connected', async () => {
    api.isAuthenticated.mockReturnValue(false);
    await expect(service.getConnections('Friend')).resolves.toBeNull();
    expect(social.getFullUser).not.toHaveBeenCalled();
    expect(api.query).not.toHaveBeenCalled();
  });

  it("shows nothing on the viewer's own profile", async () => {
    social.getFullUser.mockResolvedValue({
      id: 1,
      name: 'Me',
      avatar: { medium: '' },
      followers: 5,
      following: 5,
    });
    await expect(service.getConnections('Me')).resolves.toBeNull();
    expect(social.getAllFollowings).not.toHaveBeenCalled();
    expect(api.query).not.toHaveBeenCalled();
  });

  it('intersects the profile relations with the viewer followings and attributes lists', async () => {
    const result = await service.getConnections('Friend');
    expect(result?.followers.users.map((user) => user.id)).toEqual([2, 3]);
    expect(result?.following.users.map((user) => user.id)).toEqual([3]);
    expect(result?.lists).toEqual([{ name: 'Best Friends', users: [person(3)] }]);
  });

  it('caches profile relations for the session but rereads custom lists', async () => {
    await service.getConnections('Friend');
    lists.getLists.mockReturnValue({});
    const second = await service.getConnections('Friend');
    expect(api.query).toHaveBeenCalledTimes(1);
    expect(second?.lists).toEqual([]);
  });

  it('skips paging a side the profile totals report as empty, and everything when the viewer follows nobody', async () => {
    social.getFullUser.mockResolvedValue({
      id: 50,
      name: 'Friend',
      avatar: { medium: '' },
      followers: 2,
      following: 0,
    });
    await service.getConnections('Friend');
    expect(api.query.mock.calls[0][0]).not.toContain('following(');

    service.clear();
    api.query.mockClear();
    social.getAllFollowings.mockResolvedValue([]);
    await expect(service.getConnections('Friend')).resolves.toMatchObject({
      followers: { users: [] },
    });
    expect(api.query).not.toHaveBeenCalled();
  });

  it('keeps going without list attribution when custom lists fail to load', async () => {
    lists.init.mockRejectedValue(new Error('storage'));
    await expect(service.getConnections('Friend')).resolves.toMatchObject({ lists: [] });
  });

  it('rejects a result that arrives after the account changed', async () => {
    api.query.mockImplementation(async () => {
      context = { sessionId: 's2', userId: 9 };
      return {
        followers1: { pageInfo: { hasNextPage: false }, followers: [] },
        following1: { pageInfo: { hasNextPage: false }, following: [] },
      };
    });
    await expect(service.getConnections('Friend')).rejects.toThrow('account changed');
  });

  it('counts sidebar relations once per profile and account', async () => {
    api.query.mockResolvedValue({
      threads1: { pageInfo: { hasNextPage: false }, threads: [{ id: 1 }] },
      messages1: { pageInfo: { hasNextPage: false }, activities: [] },
      mutualFollowers: { pageInfo: { total: 15 }, mutualFollowers: [] },
      threadComments: { pageInfo: { total: 7 }, threadComments: [] },
    });
    const counts = await service.getSocialCounts(50);
    await service.getSocialCounts(50);
    expect(api.query).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({
      mutualFollowers: { count: 15, complete: true },
      forumThreads: { count: 1, complete: true },
      forumComments: { count: 7, complete: true },
      messages: { count: 0, complete: true },
    });
  });
});
