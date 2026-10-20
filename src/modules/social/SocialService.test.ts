import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialService } from './SocialService';
import { MediaListStatus } from '@core/types';
import { validateApiRequest } from '@/api/ApiBoundary';
import { CacheFactory } from '@core/cache/CacheFactory';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

const user = { id: 7, name: 'Friend', avatar: { medium: '' } };
const activity = { id: 20, mediaId: 10, userId: 7, score: 68, status: 'CURRENT', progress: 3, notes: 'Notes', updatedAt: 1700000000,
  user: { ...user, mediaListOptions: { scoreFormat: 'POINT_10_DECIMAL' } } };
const page = (rows: unknown[] = [activity], hasNextPage: unknown = false) => ({ Page: { mediaList: rows, pageInfo: { hasNextPage } } });

function fixture() {
  let session = 'one'; let userId = 1;
  const context = () => ({ sessionId: session, userId });
  const api = { getContext: context, ensureContext: async () => context(), isAuthenticated: () => true, getCurrentUserId: async () => userId, query: vi.fn() };
  const batcher = { query: vi.fn() };
  const caches = new Map<string, Map<unknown, unknown>>();
  const factory = { create: ({ namespace }: { namespace: string }) => {
    const cache = new Map(); caches.set(namespace, cache);
    return { get: async (key: unknown) => cache.get(key), set: async (key: unknown, value: unknown) => { cache.set(key, value); }, delete: async (key: unknown) => { cache.delete(key); }, clear: async () => { cache.clear(); } };
  } };
  return { service: new SocialService(api as never, batcher as never, factory as never), api, batcher, caches, switchAccount: () => { session = 'two'; userId = 2; } };
}

function privateFixture() {
  let sessionId = 'first-session'; let userId = 1;
  const getContext = () => ({ sessionId, userId });
  const api = { getContext, ensureContext: async () => getContext(), isAuthenticated: () => true, getCurrentUserId: async () => userId, query: vi.fn() };
  const batcher = { query: vi.fn() };
  const storage = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true) };
  const bus = new EventBus();
  const factory = new CacheFactory(storage as never, logger, bus);
  const caches = new Map<string, ICacheService<unknown, unknown>>();
  const create = factory.create.bind(factory);
  vi.spyOn(factory, 'create').mockImplementation(options => {
    const cache = create(options);
    caches.set(options.namespace ?? '', cache);
    return cache as never;
  });
  return { service: new SocialService(api as never, batcher as never, factory), api, batcher, caches, storage,
    switchSession: (nextUserId = 1, notify = false) => {
      sessionId = 'second-session'; userId = nextUserId;
      if (notify) bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
    } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}

describe('social private cache session isolation with the production cache', () => {
  const reads = (f: ReturnType<typeof privateFixture>, kind: 'friends' | 'following') => kind === 'friends'
    ? f.service.getFriendActivityBatch([10]).then(result => result.get(10)?.map(entry => entry.user.name))
    : f.service.getAllFollowings().then(result => result.map(entry => entry.name));
  const response = (f: ReturnType<typeof privateFixture>, kind: 'friends' | 'following', name: string) => {
    if (kind === 'friends') f.batcher.query.mockResolvedValue({ mediaList: [{ ...activity, user: { ...activity.user, name } }] });
    else f.api.query.mockResolvedValue({ Page: { following: [{ ...user, name }], pageInfo: { hasNextPage: false } } });
  };
  const cacheFor = (f: ReturnType<typeof privateFixture>, kind: 'friends' | 'following') => f.caches.get(kind === 'friends' ? 'social_friends' : 'social_followings')!;
  const queryFor = (f: ReturnType<typeof privateFixture>, kind: 'friends' | 'following') => kind === 'friends' ? f.batcher.query : f.api.query;

  it.each(['friends', 'following'] as const)('does not reuse %s after a same-owner relogin without an auth event', async kind => {
    const f = privateFixture(); response(f, kind, 'Session A');
    expect(await reads(f, kind)).toEqual(['Session A']);
    f.switchSession(); response(f, kind, 'Session B');
    expect(await reads(f, kind)).toEqual(['Session B']);
    expect(queryFor(f, kind)).toHaveBeenCalledTimes(2);
    expect(f.storage.get).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled();
  });

  it('does not reuse friend progress after a silent account change', async () => {
    const f = privateFixture(); response(f, 'friends', 'Session A'); await reads(f, 'friends');
    f.switchSession(2); response(f, 'friends', 'Session B');
    expect(await reads(f, 'friends')).toEqual(['Session B']);
  });

  it.each(['friends', 'following'] as const)('keeps delayed %s writes from repopulating a cleared auth cache or deleting the replacement session', async kind => {
    const f = privateFixture(); const cache = cacheFor(f, kind); const entered = deferred(); const release = deferred();
    const set = cache.set.bind(cache);
    vi.spyOn(cache, 'set').mockImplementationOnce(async (key, value) => { entered.resolve(); await release.promise; await set(key, value); });
    response(f, kind, 'Session A'); const oldRead = reads(f, kind);
    const rejected = expect(oldRead).rejects.toThrow('account changed');
    await entered.promise; f.switchSession(1, true);
    expect(cache.size()).toBe(0);
    response(f, kind, 'Session B'); const newRead = reads(f, kind);
    release.resolve(); await rejected;
    expect(await newRead).toEqual(['Session B']);
    expect(await reads(f, kind)).toEqual(['Session B']);
    expect(queryFor(f, kind)).toHaveBeenCalledTimes(2);
  });

  it.each(['friends', 'following'] as const)('drains delayed %s writes before a manual reset completes', async kind => {
    const f = privateFixture(); const cache = cacheFor(f, kind); const entered = deferred(); const release = deferred();
    const set = cache.set.bind(cache);
    vi.spyOn(cache, 'set').mockImplementationOnce(async (key, value) => { entered.resolve(); await release.promise; await set(key, value); });
    response(f, kind, 'Session A'); const oldRead = reads(f, kind);
    const rejected = expect(oldRead).rejects.toThrow('context changed');
    await entered.promise; const cleared = f.service.clearAllCaches(); release.resolve();
    await rejected; await cleared;
    expect(cache.size()).toBe(0);
    response(f, kind, 'Fresh'); expect(await reads(f, kind)).toEqual(['Fresh']);
  });

  it('does not expose caller mutations of friend activity as a later cached result', async () => {
    const f = privateFixture(); response(f, 'friends', 'Original');
    const first = await f.service.getFriendActivityBatch([10]); first.get(10)![0].user.avatar.medium = 'Changed';
    expect((await f.service.getFriendActivityBatch([10])).get(10)![0].user.avatar.medium).toBe('');
    expect(f.batcher.query).toHaveBeenCalledOnce();
  });

  it.each(['friends', 'following'] as const)('rejects malformed %s cache bodies and refetches instead of publishing them', async kind => {
    const f = privateFixture(); const cache = cacheFor(f, kind);
    await cache.set(kind === 'friends' ? 10 : '1', { sessionId: 'first-session', userId: 1, value: [{ ...user, id: 0 }] });
    response(f, kind, 'Valid'); expect(await reads(f, kind)).toEqual(['Valid']);
    expect(queryFor(f, kind)).toHaveBeenCalledOnce();
  });

  it.each([
    { id: 7, user, status: 'CURRENT', progress: -1, score: 68 },
    { id: 7, user, status: 'CURRENT', progress: 1.5, score: 68 },
    { id: 7, user, status: 'CURRENT', progress: 3, score: 101 },
    { id: 7, user, status: 'CURRENT', progress: 3, score: NaN },
    { id: 7, user, status: 'WATCHING', progress: 3, score: 68 },
    { id: 8, user, status: 'CURRENT', progress: 3, score: 68 },
    { id: 7, user: { ...user, avatar: {} }, status: 'CURRENT', progress: 3, score: 68 },
  ])('validates normalized cached friend fields: %j', async cached => {
    const f = privateFixture();
    await cacheFor(f, 'friends').set(10, { sessionId: 'first-session', userId: 1, value: [cached] });
    response(f, 'friends', 'Valid'); expect(await reads(f, 'friends')).toEqual(['Valid']);
    expect(f.batcher.query).toHaveBeenCalledOnce();
  });

  it.each(['friends', 'following'] as const)('checks both owner and session in a cached %s envelope', async kind => {
    const f = privateFixture(); const cache = cacheFor(f, kind); const key = kind === 'friends' ? 10 : '1';
    const value = kind === 'friends' ? [{ id: 7, user, status: 'CURRENT', progress: 3, score: 68 }] : [user];
    for (const identity of [{ sessionId: 'first-session', userId: 2 }, { sessionId: 'old-session', userId: 1 }, { userId: 1 }]) {
      await cache.set(key, { ...identity, value });
      response(f, kind, 'Valid'); expect(await reads(f, kind)).toEqual(['Valid']);
    }
    expect(queryFor(f, kind)).toHaveBeenCalledTimes(3);
  });

  it('rejects an older pending Following response when refreshing the list', async () => {
    const f = privateFixture(); const entered = deferred(); let finish!: (value: unknown) => void;
    f.api.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; entered.resolve(); }));
    const oldRead = f.service.getAllFollowings(); const rejected = expect(oldRead).rejects.toThrow('context changed');
    await entered.promise; response(f, 'following', 'Refreshed'); const refreshed = f.service.refreshFollowings();
    expect((await refreshed).map(entry => entry.name)).toEqual(['Refreshed']);
    finish({ Page: { following: [{ ...user, name: 'Old' }], pageInfo: { hasNextPage: false } } }); await rejected;
    expect(await reads(f, 'following')).toEqual(['Refreshed']); expect(f.api.query).toHaveBeenCalledTimes(2);
  });
});
describe('social API scores and account context', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('validates and caches a full profile, preserving zero counts', async () => {
    const f = fixture();
    f.api.query.mockResolvedValueOnce({ User: { id: 7, name: 'Friend', avatar: null } }).mockResolvedValueOnce({ following: { pageInfo: { total: 0 } }, followers: { pageInfo: { total: 12 } } });
    expect(await f.service.getFullUser('Friend')).toEqual({ id: 7, name: 'Friend', avatar: { medium: '' }, following: 0, followers: 12 });
    await f.service.getFullUser('Friend'); expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('does not store missing profile fields as a confirmed missing user', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(); f.api.query.mockResolvedValueOnce({});
    expect(await f.service.getFullUser('Friend')).toBeNull(); expect(f.caches.get('social_users')?.size).toBe(0);
    await f.service.getFullUser('Friend'); expect(f.api.query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000);
    f.api.query.mockResolvedValueOnce({ User: { id: 7, name: 'Friend', avatar: { medium: '' } } }).mockResolvedValueOnce({ following: { pageInfo: { total: 1 } }, followers: { pageInfo: { total: 2 } } });
    expect((await f.service.getFullUser('Friend'))?.id).toBe(7);
  });
  it('does not cache malformed counts and clears the retry suppression on cache reset', async () => {
    const f = fixture(); f.api.query.mockResolvedValueOnce({ User: { id: 7, name: 'Friend', avatar: { medium: '' } } }).mockResolvedValueOnce({ following: { pageInfo: { total: -1 } }, followers: { pageInfo: { total: 1 } } });
    expect(await f.service.getFullUser('Friend')).toBeNull(); expect(f.caches.get('social_users')?.size).toBe(0);
    await f.service.clearAllCaches(); f.api.query.mockResolvedValueOnce({ User: null }); await f.service.getFullUser('Friend'); expect(f.api.query).toHaveBeenCalledTimes(3);
  });
  it('does not reuse a profile fetched under a previous session', async () => {
    const f = fixture(); f.api.query.mockImplementationOnce(async () => { f.switchAccount(); return { User: { id: 7, name: 'Friend' } }; });
    await expect(f.service.getFullUser('Friend')).rejects.toThrow('account changed'); expect(f.caches.get('social_users')?.size).toBe(0);
  });
  it('bounds negative profile lookups and gives confirmed null users a one-day cooldown', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0); const f = fixture(); f.api.query.mockResolvedValue({ User: null });
    for (let index = 0; index < 210; index++) await f.service.getFullUser(`User${index}`);
    expect((f.service as unknown as { failedFetches: Map<string, number> }).failedFetches.size).toBe(200);
    await vi.advanceTimersByTimeAsync(120000); await f.service.getFullUser('User209'); expect(f.api.query).toHaveBeenCalledTimes(210);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); await f.service.getFullUser('User209'); expect(f.api.query).toHaveBeenCalledTimes(211);
  });
  it('requests normalized scores with correct media/user filtering in friend and detailed queries', async () => {
    const { service, api, batcher } = fixture();
    batcher.query.mockResolvedValue({ mediaList: [activity] });
    expect((await service.getFriendActivityBatch([10])).get(10)?.[0].score).toBe(68);
    expect(batcher.query.mock.calls[0][0]).toContain('score(format: POINT_100)'); expect(batcher.query.mock.calls[0][1]).toEqual({ mediaId: 10 });
    api.query.mockResolvedValue({ Page: { mediaList: [], pageInfo: { hasNextPage: false } } });
    await service.getDetailedActivity(10, 'self');
    expect(api.query.mock.calls[0][0]).toContain('score(format: POINT_100)'); expect(api.query.mock.calls[0][1]).toMatchObject({ mediaId: 10, userId: 1 });
  });
  it('does not reuse following lists after changing account', async () => {
    const { service, api, switchAccount } = fixture();
    api.query.mockResolvedValue({ Page: { following: [{ id: 7, name: 'A friend', avatar: { medium: '' } }], pageInfo: { hasNextPage: false } } });
    await service.getAllFollowings(); switchAccount();
    api.query.mockResolvedValue({ Page: { following: [], pageInfo: { hasNextPage: false } } });
    expect(await service.getAllFollowings()).toEqual([]);
    expect(api.query.mock.calls[1][1]).toMatchObject({ userId: 2 });
  });
  it('loads and caches followers separately from followings and scopes them to the account', async () => {
    const { service, api, switchAccount, caches } = fixture();
    api.query.mockResolvedValue({ Page: { followers: [user, user], pageInfo: { hasNextPage: false } } });
    expect(await service.getAllFollowers()).toEqual([user]);
    expect(api.query.mock.calls[0][0]).toContain('followers(userId: $userId)');
    expect(caches.get('social_followers')?.size).toBe(1);
    switchAccount();
    api.query.mockResolvedValue({ Page: { followers: [], pageInfo: { hasNextPage: false } } });
    expect(await service.getAllFollowers()).toEqual([]);
    expect(api.query.mock.calls[1][1]).toMatchObject({ userId: 2 });
    expect(caches.get('social_followers')?.size).toBe(2);
  });
  it('reads beyond the old four-page limit and does not cache partial failures', async () => {
    const { service, api, caches } = fixture();
    api.query.mockImplementation(async (_query: string, vars: { page: number }) => ({ Page: { following: [{ ...user, id: vars.page }], pageInfo: { hasNextPage: vars.page < 6 } } }));
    expect(await service.getAllFollowings()).toHaveLength(6);
    await service.clearAllCaches();
    api.query.mockRejectedValueOnce(new Error('Offline'));
    await expect(service.getAllFollowings()).rejects.toThrow('Offline');
    expect(caches.get('social_followings')?.size).toBe(0);
  });
  it('never caches another account response or failed friend lookups as an empty list', async () => {
    const { service, batcher, caches, switchAccount } = fixture();
    batcher.query.mockRejectedValueOnce(new Error('Offline'));
    await service.getFriendActivityBatch([10]); expect(caches.get('social_friends')?.size).toBe(0);
    batcher.query.mockImplementationOnce(async () => { switchAccount(); return { mediaList: [] }; });
    await expect(service.getFriendActivityBatch([10])).rejects.toThrow('account changed');
    expect(caches.get('social_friends')?.size).toBe(0);
  });

  it('filters custom users at the API before pagination and captures a deduplicated snapshot', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(page()); const ids = [7, 7, 8];
    const waiting = f.service.getDetailedActivity(10, 'following', 2, MediaListStatus.COMPLETED, ids);
    ids[0] = 99; await waiting;
    const [query, variables] = f.api.query.mock.calls[0];
    expect(query).toContain('userId_in: $userIds');
    expect(variables).toEqual({ mediaId: 10, page: 2, perPage: 30, status: 'COMPLETED', userIds: [7, 8] });
    expect(validateApiRequest({ method: 'query', query, variables }).variables).toEqual(variables);
  });

  it('scopes custom-list snapshots by userId_in alone, while the plain Following feed keeps isFollowing', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(page());
    await f.service.getDetailedActivity(10, 'following', 1, 'all', [7]);
    expect(f.api.query.mock.calls[0][1]).toEqual({ mediaId: 10, page: 1, perPage: 30, userIds: [7] });
    await f.service.getDetailedActivity(10, 'following', 1);
    expect(f.api.query.mock.calls[1][1]).toEqual({ mediaId: 10, page: 1, perPage: 30, isFollowing: true });
  });

  it('returns an empty selection without issuing an unfiltered API request', async () => {
    const f = fixture(); expect(await f.service.getDetailedActivity(10, 'following', 1, 'all', [])).toEqual({ nodes: [], hasNextPage: false });
    expect(f.api.query).not.toHaveBeenCalled();
  });

  it.each([0, -1, 2147483648, 1.5, NaN])('rejects invalid media ID %s before sending', async id => {
    const f = fixture(); await expect(f.service.getDetailedActivity(id, 'global')).rejects.toThrow('Invalid'); expect(f.api.query).not.toHaveBeenCalled();
    await expect(f.service.getFriendActivityBatch([id])).rejects.toThrow('Invalid'); expect(f.batcher.query).not.toHaveBeenCalled();
  });

  it('rejects invalid pages/statuses/list members before querying', async () => {
    const f = fixture();
    await expect(f.service.getDetailedActivity(10, 'following', 0)).rejects.toThrow('Invalid');
    await expect(f.service.getDetailedActivity(10, 'following', 1, MediaListStatus.WATCHING)).rejects.toThrow('Invalid');
    await expect(f.service.getDetailedActivity(10, 'following', 1, 'all', [7, 0])).rejects.toThrow('Invalid');
    await expect(f.service.getDetailedActivity(10, 'following', 1, 'all', Array(10001).fill(7))).rejects.toThrow('Invalid');
    expect(f.api.query).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { Page: null }, page([], 'false'), page([{ ...activity, user: null }]), page([{ ...activity, notes: {} }]),
    page([{ ...activity, progress: -1 }]), page([{ ...activity, score: 101 }]), page([{ ...activity, status: 'WATCHING' }]),
    page([{ ...activity, user: { ...activity.user, mediaListOptions: { scoreFormat: 'UNKNOWN' } } }])])('rejects malformed detailed responses rather than exposing them as valid rows: %j', async response => {
    const f = fixture(); f.api.query.mockResolvedValue(response); await expect(f.service.getDetailedActivity(10, 'global')).rejects.toThrow('Invalid');
  });

  it('normalizes nullable optional display fields without confusing zero with missing', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(page([{ ...activity, score: null, progress: null, notes: null, updatedAt: null,
      user: { ...user, avatar: null, mediaListOptions: null } }]));
    const result = await f.service.getDetailedActivity(10, 'global');
    expect(result.nodes[0]).toMatchObject({ score: 0, progress: 0, notes: null, updatedAt: 0, user: { avatar: { medium: '' }, mediaListOptions: { scoreFormat: 'POINT_100' } } });
    expect(result.hasNextPage).toBe(false);
  });

  it('rejects rows for the wrong media, selected user or self account', async () => {
    const f = fixture(); f.api.query.mockResolvedValueOnce(page([{ ...activity, mediaId: 11 }])).mockResolvedValue(page());
    await expect(f.service.getDetailedActivity(10, 'global')).rejects.toThrow('Invalid');
    await expect(f.service.getDetailedActivity(10, 'following', 1, 'all', [8])).rejects.toThrow('Invalid');
    await expect(f.service.getDetailedActivity(10, 'self')).rejects.toThrow('Invalid');
  });

  it('never caches malformed or wrongly attributed friend responses and retries immediately', async () => {
    const f = fixture(); f.batcher.query.mockResolvedValueOnce({}).mockResolvedValueOnce({ mediaList: [{ ...activity, mediaId: 11 }] })
      .mockResolvedValueOnce({ mediaList: [{ ...activity, userId: 8 }] }).mockResolvedValueOnce({ mediaList: [activity] });
    for (let i = 0; i < 3; i++) {
      expect((await f.service.getFriendActivityBatch([10])).has(10)).toBe(false); expect(f.caches.get('social_friends')?.size).toBe(0);
    }
    expect((await f.service.getFriendActivityBatch([10, 10])).get(10)?.[0].user.id).toBe(7);
    expect(f.batcher.query).toHaveBeenCalledTimes(4);
  });

  it('rejects a partial malformed Following page without caching it as complete', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ Page: { following: [{ id: 7 }], pageInfo: { hasNextPage: false } } });
    await expect(f.service.getAllFollowings()).rejects.toThrow('Invalid'); expect(f.caches.get('social_followings')?.size).toBe(0);
  });

  it('does not repopulate a cleared friend cache from a pending request', async () => {
    const f = fixture(); let finish!: (value: unknown) => void; const entered = deferred();
    f.batcher.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; entered.resolve(); }));
    const waiting = f.service.getFriendActivityBatch([10]); const rejected = expect(waiting).rejects.toThrow('context changed');
    await entered.promise;
    await f.service.clearAllCaches(); finish({ mediaList: [activity] });
    await rejected; expect(f.caches.get('social_friends')?.size).toBe(0);
  });

  it('keeps the last 20 entries reachable within the documented 5,000-entry provider limit', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(page());
    await f.service.getDetailedActivity(10, 'global', 166); await f.service.getDetailedActivity(10, 'global', 167);
    expect(f.api.query.mock.calls[0][1]).toMatchObject({ page: 166, perPage: 30 });
    expect(f.api.query.mock.calls[1][1]).toMatchObject({ page: 250, perPage: 20 });
    await expect(f.service.getDetailedActivity(10, 'global', 168)).rejects.toThrow('pagination limit');
    f.api.query.mockResolvedValue(page([], true)); await expect(f.service.getDetailedActivity(10, 'global', 167)).rejects.toThrow('pagination limit');
  });

  it('never queries Following beyond the provider depth cap or returns a capped list as complete', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ Page: { following: [user], pageInfo: { hasNextPage: true } } });
    await expect(f.service.getAllFollowings()).rejects.toThrow('pagination limit');
    expect(f.api.query).toHaveBeenCalledTimes(100); expect(f.caches.get('social_followings')?.size).toBe(0);
    expect(f.api.query.mock.calls.at(-1)?.[1]).toEqual({ userId: 1, page: 100 });
  });

  it('rejects a final page larger than its requested size', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(page(Array.from({ length: 21 }, (_, i) => ({ ...activity, id: i + 1 }))));
    await expect(f.service.getDetailedActivity(10, 'global', 167)).rejects.toThrow('Invalid');
  });

  it('deduplicates Following users and protects the cache from consumer mutations', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ Page: { following: [user, user], pageInfo: { hasNextPage: false } } });
    const result = await f.service.getAllFollowings(); expect(result).toHaveLength(1); result[0].name = 'Changed';
    expect((await f.service.getAllFollowings())[0].name).toBe('Friend');
  });
});
