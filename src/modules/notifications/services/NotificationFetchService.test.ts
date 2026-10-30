import { describe, expect, it, vi } from 'vitest';
import { NotificationFetchService } from './NotificationFetchService';
import {
  GraphQLBatcher,
  GraphQLBatchGlobalError,
  GraphQLResourceNotFoundError,
} from '@core/api/GraphQLBatcher';
import type { ApiContext } from '@core/interfaces/IApiClient';
import { CacheFactory } from '@core/cache/CacheFactory';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

const textActivity = (text: unknown = 'private', id = 7) => ({
  __typename: 'TextActivity',
  id,
  type: 'TEXT',
  text,
});
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function fixture() {
  const entries = new Map<number, unknown>();
  const cache = {
    get: vi.fn(async (id: number) => entries.get(id)),
    set: vi.fn(async (id: number, value: unknown) => {
      entries.set(id, value);
    }),
    delete: vi.fn(async (id: number) => {
      entries.delete(id);
    }),
    clear: vi.fn(async () => {
      entries.clear();
    }),
  };
  const batcher = {
    query: vi.fn(async (_query: string, _variables: Record<string, unknown>) => textActivity()),
  };
  let context: ApiContext = { sessionId: 'session-a', userId: 1 };
  const api = {
    ensureContext: async () => ({ ...context }),
    getContext: () => ({ ...context }),
    queryRaw: vi.fn(),
  };
  const service = new NotificationFetchService(
    batcher as never,
    { create: () => cache } as never,
    api as never
  );
  const switchAccount = (userId = 2) => {
    context = { sessionId: 'session-b', userId };
    entries.clear();
  };
  return { service, entries, cache, batcher, api, switchAccount };
}

describe('notification activity boundary and cache', () => {
  it('captures requested IDs before awaiting context initialization', async () => {
    const f = fixture();
    const ids = [7];
    const gate = deferred<{ sessionId: string; userId: number }>();
    f.api.ensureContext = () => gate.promise;
    const waiting = f.service.fetchActivityDetails(ids);
    ids[0] = 8;
    gate.resolve({ sessionId: 'session-a', userId: 1 });
    expect((await waiting).get(7)?.text).toBe('private');
    expect(f.batcher.query.mock.calls[0][1]).toEqual({ id: 7 });
  });
  it('deduplicates 150 activities across two overlapping 100-ID loads and isolates returned copies', async () => {
    const f = fixture();
    f.batcher.query.mockImplementation(async (_query, variables) =>
      textActivity(`Activity ${variables.id}`, Number(variables.id))
    );
    const [a, b] = await Promise.all([
      f.service.fetchActivityDetails(Array.from({ length: 100 }, (_, i) => i + 1)),
      f.service.fetchActivityDetails(Array.from({ length: 100 }, (_, i) => i + 51)),
    ]);
    expect(a.size).toBe(100);
    expect(b.size).toBe(100);
    expect(f.batcher.query).toHaveBeenCalledTimes(150);
    a.get(75)!.text = 'Changed';
    expect(b.get(75)?.text).toBe('Activity 75');
  });
  it('shares overlapping requests from concurrent notification rescans', async () => {
    const f = fixture();
    const gate = deferred<ReturnType<typeof textActivity>>();
    f.batcher.query.mockReturnValue(gate.promise);
    const first = f.service.fetchActivityDetails([7]);
    const second = f.service.fetchActivityDetails([7, 7]);
    await vi.waitFor(() => expect(f.batcher.query).toHaveBeenCalled());
    gate.resolve(textActivity());
    const results = await Promise.all([first, second]);
    expect(f.batcher.query).toHaveBeenCalledTimes(1);
    results[0].get(7)!.text = 'Changed';
    expect(results[1].get(7)?.text).toBe('private');
  });
  it.each(['read', 'write'] as const)(
    'keeps valid provider data when disposable cache %s fails',
    async (stage) => {
      const f = fixture();
      if (stage === 'read') f.cache.get.mockRejectedValueOnce(new Error('Cache unavailable'));
      else f.cache.set.mockRejectedValueOnce(new Error('Cache unavailable'));
      expect((await f.service.fetchActivityDetails([7])).get(7)?.text).toBe('private');
    }
  );
  it.each([
    textActivity(42),
    textActivity('wrong', 8),
    { ...textActivity(), type: 'MESSAGE' },
    { __typename: 'ListActivity', id: 7, type: 'ANIME_LIST', status: 42, media: null },
    {
      __typename: 'ListActivity',
      id: 7,
      type: 'ANIME_LIST',
      status: 'watched',
      media: {
        id: 9,
        type: 'MANGA',
        title: { userPreferred: null, romaji: 'Title', english: null },
      },
    },
  ])('rejects malformed or mismatched activity without caching it: %j', async (raw) => {
    const { service, batcher, cache } = fixture();
    batcher.query.mockResolvedValue(raw as never);
    expect(await service.fetchActivityDetails([7])).toEqual(new Map());
    expect(cache.set).not.toHaveBeenCalled();
  });
  it('evicts corrupt cache entries and refetches instead of passing unsafe text to grouping', async () => {
    const { service, entries, cache, batcher } = fixture();
    entries.set(7, { text: 42 });
    expect((await service.fetchActivityDetails([7])).get(7)).toEqual({ text: 'private' });
    expect(cache.delete).toHaveBeenCalledWith(7);
    expect(batcher.query).toHaveBeenCalledOnce();
  });
  it('evicts empty legacy details instead of treating them as completed enrichment', async () => {
    const f = fixture();
    f.entries.set(7, {
      schemaVersion: 1,
      activityId: 7,
      sessionId: 'session-a',
      userId: 1,
      details: { text: '' },
    });
    f.batcher.query.mockResolvedValue(textActivity('Recovered activity', 7) as never);
    expect((await f.service.fetchActivityDetails([7])).get(7)).toEqual({
      text: 'Recovered activity',
    });
    expect(f.cache.delete).toHaveBeenCalledWith(7);
    expect(f.batcher.query).toHaveBeenCalledOnce();
  });
  it('refetches legacy message caches and preserves the provider privacy flag on cache hits', async () => {
    const f = fixture();
    f.entries.set(7, {
      activityId: 7,
      sessionId: 'session-a',
      userId: 1,
      details: { text: 'Old message' },
    });
    f.batcher.query.mockResolvedValue({
      __typename: 'MessageActivity',
      id: 7,
      type: 'MESSAGE',
      isPrivate: true,
      message: '',
    } as never);
    expect((await f.service.fetchActivityDetails([7])).get(7)).toEqual({
      text: '',
      isPrivate: true,
    });
    expect((await f.service.fetchActivityDetails([7])).get(7)).toEqual({
      text: '',
      isPrivate: true,
    });
    expect(f.batcher.query).toHaveBeenCalledOnce();
    expect(f.cache.delete).toHaveBeenCalledWith(7);
  });
  it('returns detached snapshots from both response and cache', async () => {
    const { service, batcher } = fixture();
    const raw = textActivity();
    batcher.query.mockResolvedValue(raw);
    const first = await service.fetchActivityDetails([7]);
    first.get(7)!.text = 'edited';
    raw.text = 'mutated';
    const cached = await service.fetchActivityDetails([7]);
    expect(cached.get(7)).toEqual({ text: 'private' });
    cached.get(7)!.text = 'edited again';
    expect((await service.fetchActivityDetails([7])).get(7)?.text).toBe('private');
    expect(batcher.query).toHaveBeenCalledOnce();
  });
  it('also evicts corrupted snapshots when the cache adapter clones its reads', async () => {
    const { service, entries, cache, batcher } = fixture();
    await service.fetchActivityDetails([7]);
    const saved = entries.get(7) as { details: unknown };
    saved.details = { text: 42 };
    cache.get.mockImplementation(async (id) => structuredClone(entries.get(id)));
    expect((await service.fetchActivityDetails([7])).get(7)).toEqual({ text: 'private' });
    expect(cache.delete).toHaveBeenCalledWith(7);
    expect(batcher.query).toHaveBeenCalledTimes(2);
  });
  it('rejects a response completed after same-account relogin without caching old data', async () => {
    const { service, cache, batcher, switchAccount } = fixture();
    const response = deferred<ReturnType<typeof textActivity>>();
    const delivered = vi.fn();
    batcher.query.mockImplementationOnce(() => response.promise);
    const request = service.fetchActivityDetails([7], delivered);
    const rejected = expect(request).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(batcher.query).toHaveBeenCalledOnce());
    switchAccount(1);
    response.resolve(textActivity());
    await rejected;
    expect(cache.set).not.toHaveBeenCalled();
    expect(delivered).not.toHaveBeenCalled();
  });
  it('settles all shared jobs after an account change without duplicate dispatch', async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.batcher.query.mockImplementation(async (_query, variables) => {
      await gate.promise;
      return textActivity('Body', Number(variables.id));
    });
    const first = f.service.fetchActivityDetails(
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
    const firstRejected = expect(first).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(f.batcher.query).toHaveBeenCalledTimes(12));
    const shared = f.service.fetchActivityDetails([12]);
    const sharedRejected = expect(shared).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(f.cache.get).toHaveBeenCalledTimes(13));
    f.switchAccount();
    gate.resolve();
    await Promise.all([firstRejected, sharedRejected]);
    expect(f.batcher.query).toHaveBeenCalledTimes(12);
    expect(f.cache.set).not.toHaveBeenCalled();
  });
  it('uses variable IDs, deduplicates valid IDs, and skips invalid IDs before cache access', async () => {
    const { service, cache, batcher } = fixture();
    await service.fetchActivityDetails([7, 7, 0, -1, NaN, 1.5, 2147483648]);
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(batcher.query).toHaveBeenCalledOnce();
    expect(batcher.query.mock.calls[0]).toEqual([
      expect.stringContaining('Activity(id: $id)'),
      { id: 7 },
    ]);
    expect(batcher.query.mock.calls[0][0]).toContain('__typename');
  });
  it('remembers confirmed missing IDs across routes, but retries transient failures', async () => {
    const { service, cache, batcher } = fixture();
    batcher.query.mockResolvedValueOnce(null as never).mockRejectedValue(new Error('provider'));
    expect(await service.fetchActivityDetails([7])).toEqual(new Map());
    expect(await service.fetchActivityDetails([7])).toEqual(new Map());
    expect(batcher.query).toHaveBeenCalledOnce();
    service.beginPage();
    expect(await service.fetchActivityDetails([7])).toEqual(new Map());
    expect(await service.fetchActivityDetails([7])).toEqual(new Map());
    expect(cache.set).not.toHaveBeenCalled();
    expect(batcher.query).toHaveBeenCalledOnce();
    expect(service.isActivityUnavailable(7)).toBe(true);
    await service.fetchActivityDetails([8]);
    await service.fetchActivityDetails([8]);
    expect(service.isActivityUnavailable(8)).toBe(false);
    expect(batcher.query).toHaveBeenCalledTimes(3);
  });
  it('remembers only the provider-confirmed missing root without individual API retries', async () => {
    const f = fixture();
    f.batcher.query.mockImplementation(async (_query, variables) => {
      if (variables.id === 7) throw new GraphQLResourceNotFoundError('Not Found.');
      return textActivity(`Activity ${variables.id}`, Number(variables.id));
    });
    const result = await f.service.fetchActivityDetails([7, 8]);
    expect(result.has(7)).toBe(false);
    expect(result.get(8)?.text).toBe('Activity 8');
    expect(f.service.isActivityUnavailable(7)).toBe(true);
    expect(f.api.queryRaw).not.toHaveBeenCalled();
  });
  it('does not retry confirmed null activities when the batch contains no GraphQL errors', async () => {
    const f = fixture();
    f.batcher.query.mockResolvedValue(null as never);
    expect(await f.service.fetchActivityDetails([7, 8, 9])).toEqual(new Map());
    expect(f.api.queryRaw).not.toHaveBeenCalled();
  });
  it('treats a list activity whose media is withheld as resolved instead of re-requesting it', async () => {
    const f = fixture();
    f.batcher.query.mockResolvedValue({
      __typename: 'ListActivity',
      id: 7,
      type: 'ANIME_LIST',
      status: 'watched episode',
      progress: '3',
      media: null,
    } as never);
    expect((await f.service.fetchActivityDetails([7])).has(7)).toBe(false);
    expect(f.service.isActivityUnavailable(7)).toBe(true);
    expect(await f.service.fetchActivityDetails([7])).toEqual(new Map());
    expect(f.batcher.query).toHaveBeenCalledTimes(1);
  });
  it('leaves a generic batch failure retryable without treating every ID as deleted', async () => {
    const f = fixture();
    f.batcher.query.mockRejectedValue(new GraphQLBatchGlobalError('Provider failure'));
    expect(await f.service.fetchActivityDetails([7, 8])).toEqual(new Map());
    expect(f.service.isActivityUnavailable(7)).toBe(false);
    expect(f.service.isActivityUnavailable(8)).toBe(false);
    expect(f.api.queryRaw).not.toHaveBeenCalled();
  });
  it('publishes cache hits and fast IDs while an unrelated request is still pending, using detached snapshots', async () => {
    const f = fixture();
    const gate = deferred<ReturnType<typeof textActivity>>();
    f.entries.set(7, {
      schemaVersion: 1,
      activityId: 7,
      sessionId: 'session-a',
      userId: 1,
      details: { text: 'Cached' },
    });
    f.batcher.query.mockImplementation(async (_query, variables) =>
      Number(variables.id) === 9 ? gate.promise : textActivity('Fast', Number(variables.id))
    );
    const delivered: Array<{ id: number; text: string }> = [];
    const waiting = f.service.fetchActivityDetails([7, 8, 9], (id, details) => {
      delivered.push({ id, text: details.text });
      details.text = 'Edited by subscriber';
    });
    await vi.waitFor(() =>
      expect(delivered).toEqual([
        { id: 7, text: 'Cached' },
        { id: 8, text: 'Fast' },
      ])
    );
    gate.resolve(textActivity('Slow', 9));
    const result = await waiting;
    expect(result.get(7)?.text).toBe('Cached');
    expect(result.get(8)?.text).toBe('Fast');
    expect(result.get(9)?.text).toBe('Slow');
    expect((await f.service.fetchActivityDetails([8])).get(8)?.text).toBe('Fast');
  });
  it('uses four shared HTTP batches for 100 uncached activities instead of sequential eight-ID chunks', async () => {
    const f = fixture();
    f.api.queryRaw.mockImplementation(async (_query, variables) => ({
      data: Object.fromEntries(
        Object.entries(variables).map(([key, value]) => [
          key.slice(0, -3),
          textActivity('Body', Number(value)),
        ])
      ),
    }));
    const batcher = new GraphQLBatcher(f.api as never);
    const service = new NotificationFetchService(
      batcher,
      { create: () => f.cache } as never,
      f.api as never
    );
    try {
      const result = await service.fetchActivityDetails(
        Array.from({ length: 100 }, (_, i) => i + 1)
      );
      expect(result.size).toBe(100);
      expect(f.api.queryRaw).toHaveBeenCalledTimes(4);
      expect(
        f.api.queryRaw.mock.calls.every(([, variables]) => Object.keys(variables).length === 25)
      ).toBe(true);
    } finally {
      batcher.destroy();
    }
  });
  it('discards cached message details after AniList confirms deletion', async () => {
    const f = fixture();
    f.batcher.query.mockResolvedValue({
      __typename: 'MessageActivity',
      id: 7,
      type: 'MESSAGE',
      isPrivate: true,
      message: 'Removed body',
    } as never);
    expect((await f.service.fetchActivityDetails([7])).get(7)).toEqual({
      text: 'Removed body',
      isPrivate: true,
    });
    f.service.beginPage();
    f.batcher.query.mockResolvedValueOnce(null as never);
    expect((await f.service.fetchActivityDetails([7])).has(7)).toBe(false);
    expect((await f.service.fetchActivityDetails([7])).has(7)).toBe(false);
    expect(f.service.isActivityUnavailable(7)).toBe(true);
    expect(f.entries.has(7)).toBe(false);
    expect(f.batcher.query).toHaveBeenCalledTimes(2);
  });
  it('rejects a deferred cache read after an account change before dispatching a request', async () => {
    const { service, cache, batcher, switchAccount } = fixture();
    const read = deferred<unknown>();
    cache.get.mockImplementationOnce(() => read.promise);
    const request = service.fetchActivityDetails([7]);
    const rejected = expect(request).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.get).toHaveBeenCalledOnce());
    switchAccount();
    read.resolve(undefined);
    await rejected;
    expect(batcher.query).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
  it.each([2, 1])(
    'removes a delayed old write after account transition to user %i',
    async (userId) => {
      const { service, entries, cache, switchAccount } = fixture();
      const write = deferred<void>();
      cache.set.mockImplementationOnce(async (id, value) => {
        await write.promise;
        entries.set(id, value);
      });
      const request = service.fetchActivityDetails([7]);
      const rejected = expect(request).rejects.toThrow('account changed');
      await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
      switchAccount(userId);
      write.resolve();
      await rejected;
      expect(entries.size).toBe(0);
    }
  );
  it('keeps the new session snapshot when a stale write completes after a new fetch', async () => {
    const { service, entries, cache, batcher, switchAccount } = fixture();
    const write = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => {
      await write.promise;
      entries.set(id, value);
    });
    const oldRequest = service.fetchActivityDetails([7]);
    const rejected = expect(oldRequest).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    switchAccount();
    batcher.query.mockResolvedValue(textActivity('new session'));
    const newRequest = service.fetchActivityDetails([7]);
    await vi.waitFor(() => expect(batcher.query).toHaveBeenCalledTimes(2));
    write.resolve();
    await rejected;
    expect((await newRequest).get(7)?.text).toBe('new session');
    expect((await service.fetchActivityDetails([7])).get(7)?.text).toBe('new session');
    expect(entries.size).toBe(1);
  });
  it('never consumes an old session envelope while its deferred write is still finishing', async () => {
    const { service, entries, cache, batcher, switchAccount } = fixture();
    const publish = deferred<void>();
    const finish = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => {
      await publish.promise;
      entries.set(id, value);
      await finish.promise;
    });
    const oldRequest = service.fetchActivityDetails([7]);
    const rejected = expect(oldRequest).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    switchAccount();
    publish.resolve();
    await vi.waitFor(() => expect(entries.size).toBe(1));
    batcher.query.mockResolvedValue(textActivity('current session'));
    const newRequest = service.fetchActivityDetails([7]);
    await vi.waitFor(() => expect(cache.get).toHaveBeenCalledTimes(2));
    finish.resolve();
    await rejected;
    expect((await newRequest).get(7)?.text).toBe('current session');
    expect((await service.fetchActivityDetails([7])).get(7)?.text).toBe('current session');
  });
  it.each([
    ['7junk', null],
    ['0', null],
    ['2147483648', null],
    ['7', 7],
    ['2147483647', 2147483647],
  ])('extracts only complete positive GraphQL Int attributes: %s', (attribute, expected) => {
    const { service } = fixture();
    const notification = document.createElement('div');
    notification.setAttribute('data-activity-id', attribute);
    expect(service.extractActivityId(notification)).toBe(expected);
  });
  it('skips malformed activity links and keeps trailing slash/query/hash support', () => {
    const { service } = fixture();
    const notification = document.createElement('div');
    notification.innerHTML =
      '<a href="/activity/7junk">bad</a><a href="/activity/2147483648">bad</a><a href="/activity/9/?x=1#reply">valid</a>';
    expect(service.extractActivityId(notification)).toBe(9);
  });
  it('invalidates an in-flight write when explicitly clearing the cache', async () => {
    const { service, entries, cache } = fixture();
    const write = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => {
      await write.promise;
      entries.set(id, value);
    });
    const request = service.fetchActivityDetails([7]);
    const rejected = expect(request).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce());
    const cleared = service.clearCache();
    write.resolve();
    await rejected;
    await cleared;
    expect(entries.size).toBe(0);
  });
  it('still lets CacheFactory clear notification data on auth events without persistence', async () => {
    const bus = new EventBus();
    const storage = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const factory = new CacheFactory(storage as never, logger, bus);
    const batcher = { query: vi.fn(async () => textActivity()) };
    const service = new NotificationFetchService(batcher as never, factory);
    await service.fetchActivityDetails([7]);
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await service.fetchActivityDetails([7]);
    expect(batcher.query).toHaveBeenCalledTimes(2);
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
