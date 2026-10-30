import { describe, expect, it, vi } from 'vitest';
import { ActivityService } from './ActivityService';
import { feedActivity } from '@/test/activity-fixtures';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { CacheFactory } from '@core/cache/CacheFactory';
import { PERFORMANCE } from '@core/constants';

function setup() {
  const values = new Map<string, unknown>();
  const cache = {
    get: vi.fn(async (key: string) => values.get(key)),
    has: vi.fn(async (key: string) => values.has(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(async () => {
      values.clear();
    }),
  };
  const api = { query: vi.fn(), queryRaw: vi.fn() };
  // Score batches read queryRaw; the adapter wraps the same payload mocks as its data envelope.
  api.queryRaw.mockImplementation(async (query: string, variables?: Record<string, unknown>) => ({
    data: await api.query(query, variables),
  }));
  const service = new ActivityService(
    api as unknown as IApiClient,
    { create: () => cache } as unknown as CacheFactory
  );
  return { service, cache, api, values };
}
const pairs = [{ userName: 'Friend', mediaId: 10 }];
function rating(score = 85, mediaId = 10, name = 'Friend', format: unknown = 'POINT_100') {
  return {
    mediaId,
    userId: 7,
    score,
    user: { id: 7, name, mediaListOptions: { scoreFormat: format } },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ActivityService score recovery', () => {
  it('does not cache network failures as absent ratings for five minutes', async () => {
    const { service, cache, api } = setup();
    api.query
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ s0: rating(85, 10, 'Friend', 'POINT_10_DECIMAL') });
    const failed = await service.getScoresBatch(pairs);
    expect(cache.set).not.toHaveBeenCalled();
    expect(failed.has('Friend-10')).toBe(false);
    expect((await service.getScoresBatch(pairs)).get('Friend-10')).toEqual({
      score: 85,
      format: 'POINT_10_DECIMAL',
    });
    expect(api.query).toHaveBeenCalledTimes(2);
  });

  it('caches a confirmed missing list entry', async () => {
    const { service, api } = setup();
    api.query.mockResolvedValue({ s0: null });
    expect((await service.getScoresBatch(pairs)).get('Friend-10')).toBeNull();
    await service.getScoresBatch(pairs);
    expect(api.query).toHaveBeenCalledTimes(1);
  });

  it('does not cache an alias missing from the response', async () => {
    const { service, cache, api } = setup();
    api.query.mockResolvedValue({});
    expect((await service.getScoresBatch(pairs)).has('Friend-10')).toBe(false);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('caches a hidden or deleted entry as absent without rejecting its neighbours', async () => {
    const { service, api } = setup();
    const batch = [
      { userName: 'Friend', mediaId: 10 },
      { userName: 'Friend', mediaId: 11 },
    ];
    api.queryRaw.mockResolvedValueOnce({
      data: { s0: null, s1: rating(70, 11) },
      errors: [{ message: 'Not Found.', status: 404, path: ['s0'] }],
    });
    const first = await service.getScoresBatch(batch);
    expect(first.get('Friend-10')).toBeNull();
    expect(first.get('Friend-11')?.score).toBe(70);
    await service.getScoresBatch(batch);
    expect(api.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('keeps a transient per-alias failure out of the cache so it is retried', async () => {
    const { service, api, cache } = setup();
    api.queryRaw.mockResolvedValueOnce({
      data: { s0: null },
      errors: [{ message: 'Server error', status: 500, path: ['s0'] }],
    });
    expect((await service.getScoresBatch(pairs)).has('Friend-10')).toBe(false);
    expect(cache.set).not.toHaveBeenCalled();
    api.queryRaw.mockResolvedValueOnce({ data: { s0: rating() } });
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(85);
  });

  it('distrusts a whole response carrying an error that is not scoped to an alias', async () => {
    const { service, api, cache } = setup();
    api.queryRaw.mockResolvedValueOnce({
      data: { s0: rating() },
      errors: [{ message: 'Rate limited', status: 429 }],
    });
    expect((await service.getScoresBatch(pairs)).has('Friend-10')).toBe(false);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('keeps scores when optional format preferences are absent', async () => {
    const { service, api } = setup();
    api.query.mockResolvedValue({ s0: { ...rating(80), user: null } });
    expect((await service.getScoresBatch(pairs)).get('Friend-10')).toEqual({
      score: 80,
      format: 'POINT_100',
    });
  });
});

describe('ActivityService score boundaries and cache isolation', () => {
  it.each([
    { userName: '', mediaId: 10 },
    { userName: '  ', mediaId: 10 },
    { userName: '\uD800', mediaId: 10 },
    { userName: 'Friend', mediaId: 0 },
    { userName: 'Friend', mediaId: 1.5 },
    { userName: 'Friend', mediaId: 2147483648 },
  ])('rejects invalid pairs before cache or network access: %j', async (pair) => {
    const { service, cache, api } = setup();
    await expect(service.getScoresBatch([pair])).rejects.toThrow('Invalid activity score request');
    expect(cache.get).not.toHaveBeenCalled();
    expect(api.query).not.toHaveBeenCalled();
  });

  it.each([
    rating(101),
    rating(NaN),
    rating(85, 11),
    rating(85, 10, 'Other'),
    rating(85, 10, 'Friend', 'POINT_999'),
    rating(85, 10, 'Friend', {}),
    { ...rating(), score: '85' },
    { ...rating(), userId: 8 },
    { ...rating(), user: { ...rating().user, id: -1 } },
    { ...rating(), user: undefined },
    { ...rating(), user: { ...rating().user, mediaListOptions: [] } },
  ])('omits malformed or unrelated scores without caching them: %j', async (row) => {
    const { service, cache, api } = setup();
    api.query.mockResolvedValue({ s0: row });
    expect((await service.getScoresBatch(pairs)).has('Friend-10')).toBe(false);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('retains valid aliases beside malformed rows and preserves all five formats', async () => {
    const { service, api } = setup();
    const formats = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'];
    const batch = formats.map((_, i) => ({ userName: 'Friend', mediaId: i + 1 }));
    api.query.mockResolvedValue(
      Object.fromEntries(formats.map((format, i) => [`s${i}`, rating(80, i + 1, 'friend', format)]))
    );
    const result = await service.getScoresBatch(batch);
    for (let i = 0; i < formats.length; i++)
      expect(result.get(`Friend-${i + 1}`)).toEqual({ score: 80, format: formats[i] });
    await service.clearCache();
    api.query.mockResolvedValue({ s0: rating(80, 1), s1: rating(85, 999) });
    expect([...(await service.getScoresBatch(batch.slice(0, 2)))]).toEqual([
      ['Friend-1', { score: 80, format: 'POINT_100' }],
    ]);
    expect(api.query.mock.calls[0][0]).toContain('mediaId userId');
  });

  it('distinguishes explicit zero, nullable preferences, missing aliases and malformed envelopes', async () => {
    const { service, api } = setup();
    api.query.mockResolvedValueOnce({
      s0: { ...rating(0), user: { ...rating().user, mediaListOptions: null } },
    });
    expect((await service.getScoresBatch(pairs)).get('Friend-10')).toEqual({
      score: 0,
      format: 'POINT_100',
    });
    await service.clearCache();
    for (const value of [null, [], 'wrong', Object.create({ s0: null })]) {
      api.query.mockResolvedValueOnce(value);
      expect((await service.getScoresBatch(pairs)).has('Friend-10')).toBe(false);
    }
  });

  it('captures and deduplicates the requested pairs before asynchronous work', async () => {
    const { service, api } = setup();
    const gate = deferred<{ userId: number; sessionId: string }>();
    Object.assign(api, {
      ensureContext: () => gate.promise,
      getContext: () => ({ userId: 1, sessionId: 'one' }),
    });
    const input = [
      { userName: 'Friend', mediaId: 10 },
      { userName: 'Friend', mediaId: 10 },
    ];
    const pending = service.getScoresBatch(input);
    input[0].userName = 'Other';
    input[1].mediaId = 99;
    api.query.mockResolvedValue({ s0: rating() });
    gate.resolve({ userId: 1, sessionId: 'one' });
    expect([...(await pending)]).toEqual([['Friend-10', { score: 85, format: 'POINT_100' }]]);
    expect(api.query.mock.calls[0][1]).toEqual({ u0: 'Friend', m0: 10 });
  });

  it('separates scores and confirmed absences between sessions, including the same account', async () => {
    const { service, api } = setup();
    let context = { userId: 1, sessionId: 'one' };
    Object.assign(api, { ensureContext: async () => ({ ...context }), getContext: () => context });
    api.query
      .mockResolvedValueOnce({ s0: null })
      .mockResolvedValueOnce({ s0: rating(80) })
      .mockResolvedValueOnce({ s0: rating(90) });
    expect((await service.getScoresBatch(pairs)).get('Friend-10')).toBeNull();
    context = { userId: 2, sessionId: 'two' };
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(80);
    context = { userId: 2, sessionId: 'three' };
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(90);
    expect(api.query).toHaveBeenCalledTimes(3);
  });

  it('shares an overlapping in-flight lookup and returns independent score objects', async () => {
    const { service, api } = setup();
    const gate = deferred<unknown>();
    api.query.mockReturnValue(gate.promise);
    const first = service.getScoresBatch(pairs);
    const second = service.getScoresBatch(pairs);
    await vi.waitFor(() => expect(api.query).toHaveBeenCalled());
    gate.resolve({ s0: rating() });
    const [a, b] = await Promise.all([first, second]);
    expect(api.query).toHaveBeenCalledTimes(1);
    a.get('Friend-10')!.score = 1;
    expect(b.get('Friend-10')?.score).toBe(85);
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(85);
  });

  it('rejects account changes during cache reads before sending a query', async () => {
    const { service, cache, api } = setup();
    let context = { userId: 1, sessionId: 'one' };
    Object.assign(api, { ensureContext: async () => ({ ...context }), getContext: () => context });
    cache.get.mockImplementationOnce(async () => {
      context = { userId: 2, sessionId: 'two' };
      return undefined;
    });
    await expect(service.getScoresBatch(pairs)).rejects.toThrow('account changed');
    expect(api.query).not.toHaveBeenCalled();
  });

  it('invalidates pending requests on clear so late replies cannot restore the old cache', async () => {
    const { service, api, values } = setup();
    const gate = deferred<unknown>();
    api.query.mockReturnValueOnce(gate.promise).mockResolvedValueOnce({ s0: rating(80) });
    const pending = service.getScoresBatch(pairs);
    const rejection = expect(pending).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(api.query).toHaveBeenCalled());
    await service.clearCache();
    gate.resolve({ s0: rating(90) });
    await rejection;
    expect(values.size).toBe(0);
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(80);
  });

  it('removes an obsolete write that completes after a clear', async () => {
    const { service, cache, api, values } = setup();
    const gate = deferred<void>();
    cache.set.mockImplementationOnce(async (key, value) => {
      await gate.promise;
      values.set(key, value);
    });
    api.query.mockResolvedValue({ s0: rating() });
    const pending = service.getScoresBatch(pairs);
    const rejection = expect(pending).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalled());
    await service.clearCache();
    gate.resolve();
    await rejection;
    expect(values.size).toBe(0);
  });

  it('stops later chunks after the account changes during a reply', async () => {
    const { service, api } = setup();
    let context = { userId: 1, sessionId: 'one' };
    Object.assign(api, { ensureContext: async () => ({ ...context }), getContext: () => context });
    api.query.mockImplementation(async () => {
      context = { userId: 2, sessionId: 'two' };
      return {};
    });
    const batch = Array.from({ length: PERFORMANCE.GRAPHQL_CHUNK_SIZE_ACTIVITY + 1 }, (_, i) => ({
      userName: 'Friend',
      mediaId: i + 1,
    }));
    await expect(service.getScoresBatch(batch)).rejects.toThrow('account changed');
    expect(api.query).toHaveBeenCalledTimes(1);
  });

  it('bounds aliases to 25, preserves their associations and waits between chunks', async () => {
    vi.useFakeTimers();
    try {
      const { service, api } = setup();
      api.query.mockImplementation(async (_query, variables: Record<string, unknown>) => {
        return Object.fromEntries(
          Object.keys(variables)
            .filter((key) => key.startsWith('m'))
            .map((key) => [`s${key.slice(1)}`, rating(80, variables[key] as number)])
        );
      });
      const batch = Array.from({ length: PERFORMANCE.GRAPHQL_CHUNK_SIZE_ACTIVITY + 1 }, (_, i) => ({
        userName: 'Friend',
        mediaId: i + 1,
      }));
      const pending = service.getScoresBatch(batch);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.query).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(api.query).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const results = await pending;
      expect(results.size).toBe(26);
      expect(results.get('Friend-26')?.score).toBe(80);
      expect(Object.keys(api.query.mock.calls[0][1])).toHaveLength(50);
      expect(api.query.mock.calls[1][1]).toEqual({ u0: 'Friend', m0: 26 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows overlapping callers to retry after their shared network failure', async () => {
    const { service, api } = setup();
    api.query.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ s0: rating() });
    const [a, b] = await Promise.all([
      service.getScoresBatch(pairs),
      service.getScoresBatch(pairs),
    ]);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
    expect(api.query).toHaveBeenCalledTimes(1);
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(85);
  });

  it('returns a validated score even when its disposable cache write fails', async () => {
    const { service, api, cache } = setup();
    api.query.mockResolvedValue({ s0: rating() });
    cache.set.mockRejectedValueOnce(new Error('cache unavailable'));
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(85);
    expect((await service.getScoresBatch(pairs)).get('Friend-10')?.score).toBe(85);
    expect(api.query).toHaveBeenCalledTimes(2);
  });
});

describe('ActivityService media activity', () => {
  it('uses AniList hasNextPage and preserves pagination', async () => {
    const { service, api } = setup();
    api.query.mockResolvedValue({
      Page: { activities: [feedActivity(2)], pageInfo: { hasNextPage: true } },
    });
    expect(await service.getMediaActivity(10, 2)).toEqual({
      activities: [{ ...feedActivity(2), isLiked: false }],
      hasNextPage: true,
    });
    expect(api.query.mock.calls[0][0]).toContain('hasNextPage');
    expect(api.query.mock.calls[0][0]).not.toContain('hasMorePages');
    expect(api.query.mock.calls[0][1]).toEqual({ mediaId: 10, page: 2 });
  });

  it('propagates failures and malformed responses instead of declaring an empty feed', async () => {
    const { service, api } = setup();
    api.query
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ Page: { activities: [] } });
    await expect(service.getMediaActivity(10)).rejects.toThrow('offline');
    await expect(service.getMediaActivity(10)).rejects.toThrow('Invalid activity response');
  });

  it('rejects invalid arguments before querying', async () => {
    const { service, api } = setup();
    await expect(service.getMediaActivity(1.5)).rejects.toThrow();
    await expect(service.getMediaActivity(1, 0)).rejects.toThrow();
    expect(api.query).not.toHaveBeenCalled();
  });

  it('rejects a result fetched under an earlier account session', async () => {
    const { service, api } = setup();
    Object.assign(api, {
      ensureContext: async () => ({ userId: 1, sessionId: 'old' }),
      getContext: () => ({ userId: 2, sessionId: 'new' }),
    });
    api.query.mockResolvedValue({ Page: { activities: [], pageInfo: { hasNextPage: false } } });
    await expect(service.getMediaActivity(10)).rejects.toThrow('account changed');
  });

  it.each([
    { ...feedActivity(), likeCount: '4' },
    { ...feedActivity(), user: { ...feedActivity().user, id: -1 } },
    feedActivity(1, 7, 11),
    { ...feedActivity(), media: { ...feedActivity().media, type: 'MANGA' } },
    { ...feedActivity(), status: {} },
    { ...feedActivity(), user: { ...feedActivity().user, name: '\uD800' } },
  ])('rejects malformed or mismatched activity rows: %j', async (row) => {
    const { service, api } = setup();
    api.query.mockResolvedValue({ Page: { activities: [row], pageInfo: { hasNextPage: false } } });
    await expect(service.getMediaActivity(10)).rejects.toThrow('Invalid activity response');
  });

  it('enforces provider depth before a media activity request', async () => {
    const { service, api } = setup();
    await expect(service.getMediaActivity(10, 201)).rejects.toThrow();
    await expect(service.getMediaActivity(2147483648)).rejects.toThrow();
    expect(api.query).not.toHaveBeenCalled();
  });
});
