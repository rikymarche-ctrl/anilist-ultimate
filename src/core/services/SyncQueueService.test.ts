import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncQueueService } from './SyncQueueService';

/** In-memory IStorageService whose get/set yield a microtask to expose RMW races. */
function makeStorage() {
  const data = new Map<string, any>();
  return {
    data,
    get: vi.fn(async (k: string) => {
      await Promise.resolve();
      return data.has(k) ? data.get(k) : null;
    }),
    set: vi.fn(async (k: string, v: any) => {
      await Promise.resolve();
      data.set(k, v);
      return true;
    }),
    remove: vi.fn(async (k: string) => {
      data.delete(k);
      return true;
    }),
  } as any;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() } as any;
}

describe('SyncQueueService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues a mutation and persists it', async () => {
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn() } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 80 });

    const queue = await service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.mediaId).toBe(1);
  });

  it('rejects an invalid ASTRA_SAVE payload without mediaId', async () => {
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn() } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { score: 80 });

    expect(await service.getQueue()).toHaveLength(0);
  });

  it('deduplicates by mediaId, replacing the pending mutation', async () => {
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn() } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 10 });
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 99 });

    const queue = await service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.score).toBe(99);
  });

  it('does NOT lose concurrent enqueues (mutex serializes read-modify-write)', async () => {
    // Regression guard for the queue race: 10 concurrent enqueues with distinct
    // mediaIds must all survive despite the async (yielding) storage.
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn() } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await Promise.all(
      // mediaId starts at 1: enqueue() correctly rejects falsy mediaIds (0).
      Array.from({ length: 10 }, (_, i) =>
        service.enqueue('ASTRA_SAVE', { mediaId: i + 1, score: i })
      )
    );

    const queue = await service.getQueue();
    expect(queue).toHaveLength(10);
    expect(new Set(queue.map((m) => m.payload.mediaId)).size).toBe(10);
  });

  it('drains the queue when mutations sync successfully', async () => {
    const storage = makeStorage();
    const mutate = vi.fn(async () => ({ id: 1 }));
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(await service.getQueue()).toHaveLength(0);
  });

  it('keeps the mutation and suspends the queue on a 401 auth error', async () => {
    const storage = makeStorage();
    const mutate = vi.fn(async () => {
      const err: any = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    });
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    const queue = await service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].retries).toBe(1);
  });

  it('skips processing while the API is rate limited', async () => {
    const storage = makeStorage();
    const mutate = vi.fn();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate } as any;
    const service = new SyncQueueService(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    expect(mutate).not.toHaveBeenCalled();
    expect(await service.getQueue()).toHaveLength(1);
  });
});
