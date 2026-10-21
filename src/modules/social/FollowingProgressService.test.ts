import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowingProgressService, FOLLOWING_PROGRESS_TTL, parseFollowingProgress } from './FollowingProgressService';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';

const entry = (progress: unknown = 8) => ({ id: 90, mediaId: 1, userId: 2, progress, user: { id: 2, name: 'Friend' } });
function fixture() {
  let sessionId = 'A'; let userId: number | null = 1; let authenticated = true;
  const query = vi.fn(async (): Promise<unknown> => entry());
  const api = { isAuthenticated: () => authenticated, getContext: () => ({ sessionId, userId }) };
  const service = new FollowingProgressService({ query } as never, api as never);
  return { service, query, change: (id = 1) => { sessionId += 'B'; userId = id; }, logout: () => { authenticated = false; userId = null; } };
}
afterEach(() => vi.useRealTimers());

describe('Following progress response', () => {
  it.each([1, 8, 2147483647])('accepts positive integer %s with matching identities', progress => {
    expect(parseFollowingProgress(entry(progress), 'friend', 1)).toBe(progress);
    expect(parseFollowingProgress({ MediaList: entry(progress) }, 'Friend', 1)).toBe(progress);
  });
  it.each([null, { MediaList: null }, entry(null), entry(0)])('projects confirmed empty progress %j to zero', value => {
    expect(parseFollowingProgress(value, 'Friend', 1)).toBe(0);
  });
  it.each([undefined, {}, { ...entry(), progress: undefined }, entry(-1), entry(1.5), entry('8'), entry(NaN), entry(Infinity), entry(2147483648),
    { ...entry(), mediaId: 3 }, { ...entry(), userId: 3 }, { ...entry(), user: { id: 2, name: 'Other' } }, { ...entry(), id: 0 }])(
    'rejects malformed values and another user/media: %j', value => {
      expect(() => parseFollowingProgress(value, 'Friend', 1)).toThrow();
    });
});

describe('Following progress cache', () => {
  it('invalidates one cached user without dropping the other cached users', async () => {
    const f = fixture();
    await f.service.getProgress('Friend', 1);
    f.query.mockResolvedValueOnce({ ...entry(2), mediaId: 2 });
    await f.service.getProgress('Friend', 2);
    f.service.invalidate('friend', 1);
    f.query.mockResolvedValueOnce(entry(0));
    expect(await f.service.getProgress('Friend', 1)).toBe(0);
    expect(await f.service.getProgress('Friend', 2)).toBe(2);
    expect(f.query).toHaveBeenCalledTimes(3);
  });
  it('does not let a superseded request refill the cache with an outdated episode count', async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    f.query.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = f.service.getProgress('Friend', 1);
    f.service.invalidate('Friend', 1);
    f.query.mockResolvedValueOnce(entry(0));
    expect(await f.service.getProgress('Friend', 1)).toBe(0);
    finish(entry(1)); expect(await old).toBeUndefined();
    expect(await f.service.getProgress('Friend', 1)).toBe(0);
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('uses the real alias batcher for multiple visible users with no six-user or viewer filter', async () => {
    vi.useFakeTimers();
    const context = { sessionId: 'A', userId: 1 };
    const queryRaw = vi.fn(async () => ({ data: { a0: entry(), a1: { ...entry(3), userId: 1, user: { id: 1, name: 'Viewer' } } } }));
    const api = { isAuthenticated: () => true, getContext: () => context, ensureContext: async () => context, queryRaw };
    const batcher = new GraphQLBatcher(api as never);
    try {
      const service = new FollowingProgressService(batcher, api as never);
      const waiting = Promise.all([service.getProgress('Friend', 1), service.getProgress('Viewer', 1)]);
      await vi.advanceTimersByTimeAsync(50);
      expect(await waiting).toEqual([8, 3]); expect(queryRaw).toHaveBeenCalledOnce();
      expect(queryRaw).toHaveBeenCalledWith(expect.stringMatching(/a0: MediaList[\s\S]*a1: MediaList/),
        { a0_userName: 'Friend', a0_mediaId: 1, a1_userName: 'Viewer', a1_mediaId: 1 });
    } finally { batcher.destroy(); }
  });
  it('shares concurrent/case-insensitive reads and caches zero independently of notes', async () => {
    const f = fixture(); f.query.mockResolvedValue(entry(0));
    expect(await Promise.all([f.service.getProgress('Friend', 1), f.service.getProgress('friend', 1)])).toEqual([0, 0]);
    await f.service.getProgress('Friend', 1);
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0]).toEqual([expect.stringContaining('progress'), { userName: 'Friend', mediaId: 1 }]);
  });
  it('expires after five minutes and on clock rollback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000); const f = fixture();
    await f.service.getProgress('Friend', 1); vi.setSystemTime(1000000 + FOLLOWING_PROGRESS_TTL);
    await f.service.getProgress('Friend', 1); vi.setSystemTime(0); await f.service.getProgress('Friend', 1);
    expect(f.query).toHaveBeenCalledTimes(3);
  });
  it.each(['error', 'invalid'] as const)('retries %s instead of caching it as zero', async kind => {
    const f = fixture();
    if (kind === 'error') f.query.mockRejectedValueOnce(new Error('offline')); else f.query.mockResolvedValueOnce(entry(-1));
    expect(await f.service.getProgress('Friend', 1)).toBeUndefined();
    expect(await f.service.getProgress('Friend', 1)).toBe(8); expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each(['clear', 'account', 'relogin', 'logout'] as const)('rejects late results after %s', async kind => {
    const f = fixture(); let resolve!: (value: unknown) => void;
    f.query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const waiting = f.service.getProgress('Friend', 1);
    if (kind === 'clear') f.service.clear();
    else if (kind === 'account') f.change(3);
    else if (kind === 'relogin') f.change();
    else f.logout();
    resolve(entry(99)); expect(await waiting).toBeUndefined();
    if (kind !== 'logout') expect(await f.service.getProgress('Friend', 1)).toBe(8);
    else { expect(await f.service.getProgress('Friend', 1)).toBeUndefined(); expect(f.query).toHaveBeenCalledTimes(1); }
  });
  it('bounds cache size at 500 entries', async () => {
    const f = fixture(); f.query.mockImplementation(async (_query?: string, vars?: Record<string, unknown>) => ({ ...entry(), mediaId: vars?.mediaId }));
    for (let mediaId = 1; mediaId <= 501; mediaId++) await f.service.getProgress('Friend', mediaId);
    await f.service.getProgress('Friend', 1); expect(f.query).toHaveBeenCalledTimes(502);
  });
});
