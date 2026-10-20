import { describe, expect, it, vi } from 'vitest';
import { ReviewService } from './ReviewService';
import type { ApiContext } from '@core/interfaces/IApiClient';
import { CacheFactory } from '@core/cache/CacheFactory';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

const review = (id = 7) => ({ id, score: 80, summary: 'Summary', body: 'Body', rating: 3, ratingAmount: 4,
  user: { id: 1, name: 'Reviewer' }, media: { id: 9, title: { romaji: 'Title', english: null } } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish; }); return { resolve, promise }; }
function fixture() {
  const entries = new Map<number, unknown>();
  const cache = { get: vi.fn(async (id: number) => entries.get(id)), set: vi.fn(async (id: number, value: unknown) => { entries.set(id, value); }),
    delete: vi.fn(async (id: number) => { entries.delete(id); }), clear: vi.fn(async () => { entries.clear(); }) };
  let context: ApiContext = { sessionId: 'session-a', userId: 1 };
  const api = { ensureContext: async () => ({ ...context }), getContext: () => ({ ...context }),
    query: vi.fn(async () => ({ r7: review() } as unknown)), queryRaw: vi.fn(async () => ({ data: { r7: review() } } as unknown)) };
  const factory = { create: vi.fn((_options: unknown) => cache) };
  const service = new ReviewService(api as never, factory as never);
  const respond = (value: unknown) => { api.query.mockResolvedValue(value); api.queryRaw.mockResolvedValue({ data: value }); };
  const switchAccount = (userId = 2) => { context = { sessionId: 'session-b', userId }; entries.clear(); };
  return { service, api, cache, entries, factory, respond, switchAccount };
}

describe('review identity, projection, and cache', () => {
  it.each([{ r7: review(8) }, { r8: review(8) }, { r7: review(), r8: review(8) }, { r7: { ...review(), score: 101 } },
    { r7: { ...review(), id: '7' } }, { r7: { id: 7 } },
  ])('never returns/caches mismatched or malformed review aliases: %j', async raw => {
    const { service, cache, respond } = fixture(); respond(raw);
    expect(await service.getReview(7)).toBeNull(); expect(cache.set).not.toHaveBeenCalled();
  });
  it('rejects an incomplete batch before publishing a valid sibling', async () => {
    const { service, cache } = fixture(); expect(await service.getReviewBatch([7, 8])).toEqual([]); expect(cache.set).not.toHaveBeenCalled();
  });
  it('evicts malformed/wrong-ID cached values and refetches', async () => {
    const { service, entries, cache } = fixture(); entries.set(7, review(8));
    expect((await service.getReview(7))?.id).toBe(7); expect(cache.delete).toHaveBeenCalledWith(7);
  });
  it('returns detached snapshots from remote and cache', async () => {
    const { service, respond } = fixture(); const raw = review(); respond({ r7: raw });
    const first = await service.getReview(7); first!.score = 0; raw.score = 1;
    const cached = await service.getReview(7); expect(cached?.score).toBe(80);
  });
  it('keeps private/unscored reviews out of persistent storage and cached results', async () => {
    const { service, factory, respond, cache } = fixture(); respond({ r7: { ...review(), score: null } });
    expect(await service.getReview(7)).toBeNull(); expect(cache.set).not.toHaveBeenCalled();
    expect(factory.create.mock.calls[0][0]).toMatchObject({ persistent: false });
  });
  it('skips errored aliases even if partial data contains a plausible score', async () => {
    const { service, api, cache } = fixture();
    api.queryRaw.mockResolvedValue({ data: { r7: review() }, errors: [{ message: 'private', path: ['r7', 'score'] }] });
    api.query.mockRejectedValue(new Error('provider'));
    expect(await service.getReview(7)).toBeNull(); expect(cache.set).not.toHaveBeenCalled();
  });
  it('deduplicates valid IDs and skips invalid identities before cache access', async () => {
    const { service, cache } = fixture(); await service.getReviewBatch([7, 7, 0, -1, NaN, 1.5, 2147483648]);
    expect(cache.get).toHaveBeenCalledTimes(1); expect(cache.set).toHaveBeenCalledTimes(1);
  });
  it.each([NaN, Infinity, -1, 0, 1.5])('rejects a nonadvancing chunk size before touching cache: %j', async size => {
    const { service, cache } = fixture(); await expect(service.getReviewBatch([7], size)).rejects.toThrow('chunk size'); expect(cache.get).not.toHaveBeenCalled();
  });
  it('rejects deferred cache reads after account change without querying', async () => {
    const { service, cache, api, switchAccount } = fixture(); const read = deferred<unknown>(); cache.get.mockImplementationOnce(() => read.promise);
    const request = service.getReview(7); const rejected = expect(request).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.get).toHaveBeenCalledOnce()); switchAccount(); read.resolve(undefined); await rejected;
    expect(api.query).not.toHaveBeenCalled(); expect(api.queryRaw).not.toHaveBeenCalled();
  });
  it.each([1, 2])('removes late cache writes after transition to user %i', async userId => {
    const { service, cache, entries, switchAccount } = fixture(); const write = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => { await write.promise; entries.set(id, value); });
    const request = service.getReview(7); const rejected = expect(request).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce()); switchAccount(userId); write.resolve(); await rejected; expect(entries.size).toBe(0);
  });
  it('preserves the new snapshot while cleaning up a late old-session write', async () => {
    const { service, api, cache, entries, respond, switchAccount } = fixture(); const write = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => { await write.promise; entries.set(id, value); });
    const oldRequest = service.getReview(7); const rejected = expect(oldRequest).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce()); switchAccount(); respond({ r7: { ...review(), score: 90 } });
    const newRequest = service.getReview(7); await vi.waitFor(() => expect(api.query.mock.calls.length + api.queryRaw.mock.calls.length).toBe(2));
    write.resolve(); await rejected; expect((await newRequest)?.score).toBe(90); expect((await service.getReview(7))?.score).toBe(90);
  });
  it('invalidates in-flight cache publication when clearCache is requested', async () => {
    const { service, entries, cache } = fixture(); const write = deferred<void>();
    cache.set.mockImplementationOnce(async (id, value) => { await write.promise; entries.set(id, value); });
    const request = service.getReview(7); const rejected = expect(request).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(cache.set).toHaveBeenCalledOnce()); const cleared = service.clearCache(); write.resolve();
    await rejected; await cleared; expect(entries.size).toBe(0);
  });
  it('evicts corrupted cloned cache envelopes and refetches', async () => {
    const { service, cache, entries, api } = fixture(); await service.getReview(7);
    (entries.get(7) as { review: unknown }).review = { ...review(), score: '80' };
    cache.get.mockImplementation(async id => structuredClone(entries.get(id)));
    expect((await service.getReview(7))?.score).toBe(80); expect(cache.delete).toHaveBeenCalledWith(7); expect(api.queryRaw).toHaveBeenCalledTimes(2);
  });
  it('does not reuse an envelope from another session even if account invalidation was missed', async () => {
    const { service, entries, respond, switchAccount } = fixture(); await service.getReview(7); const old = entries.get(7);
    switchAccount(1); entries.set(7, old); respond({ r7: { ...review(), score: 90 } });
    expect((await service.getReview(7))?.score).toBe(90);
  });
  it('uses the private namespace and auth invalidation without restoring legacy storage', async () => {
    const { api } = fixture(); const bus = new EventBus(); const storage = { get: vi.fn(async () => ({ r7: review() })), set: vi.fn(), remove: vi.fn() };
    const service = new ReviewService(api as never, new CacheFactory(storage as never, logger, bus));
    await service.getReview(7); bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await service.getReview(7); expect(api.queryRaw).toHaveBeenCalledTimes(2);
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  });
  it('logs batch metadata without including a provider private body', async () => {
    const { service, api } = fixture(); const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      api.queryRaw.mockRejectedValueOnce({ response: { data: { r7: { ...review(), body: 'PRIVATE REVIEW BODY' } } } });
      expect(await service.getReview(7)).toBeNull(); expect(warning.mock.calls).toEqual([['[ReviewService] Review batch 1 failed']]);
    } finally { warning.mockRestore(); }
  });
  it('keeps valid siblings from partial provider errors and retries errored slots', async () => {
    const { service, api, cache } = fixture();
    api.queryRaw.mockResolvedValueOnce({ data: { r7: review(), r8: review(8) }, errors: [{ message: 'private', path: ['r8'] }] });
    expect((await service.getReviewBatch([7, 8])).map(item => item.id)).toEqual([7]);
    expect(cache.set.mock.calls.map(call => call[0])).toEqual([7]);
    api.queryRaw.mockResolvedValueOnce({ data: { r8: review(8) } }); expect((await service.getReview(8))?.id).toBe(8);
    expect(api.queryRaw).toHaveBeenCalledTimes(2);
  });
  it('preserves chunk throttling and fetches each requested alias in its own chunk', async () => {
    vi.useFakeTimers();
    try {
      const { service, api } = fixture(); api.queryRaw.mockResolvedValueOnce({ data: { r7: review() } }).mockResolvedValueOnce({ data: { r8: review(8) } });
      const request = service.getReviewBatch([7, 8], 1); await vi.advanceTimersByTimeAsync(0);
      expect(api.queryRaw).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(899); expect(api.queryRaw).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect((await request).map(item => item.id)).toEqual([7, 8]); expect(api.queryRaw).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('checks the account again after throttle instead of dispatching the next old-session chunk', async () => {
    vi.useFakeTimers();
    try {
      const { service, api, switchAccount } = fixture();
      const request = service.getReviewBatch([7, 8], 1); const rejected = expect(request).rejects.toThrow('account changed');
      await vi.advanceTimersByTimeAsync(0); expect(api.queryRaw).toHaveBeenCalledTimes(1); switchAccount();
      await vi.advanceTimersByTimeAsync(900); await rejected; expect(api.queryRaw).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
