import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncAcknowledgement } from '@/test/sync-fixtures';
import { SyncQueueService } from './SyncQueueService';
import { parse, type OperationDefinitionNode } from 'graphql';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import { isRecord } from '@/api/GraphQLResponse';

interface SyncApiFake {
  getQueueStatus?: () => { isRateLimited: boolean };
  query?: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  queryRaw?: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  mutate?: (query: string, payload: Record<string, unknown>) => Promise<unknown>;
}
type SyncAuthFake = Pick<AuthTokenService, 'ensureInitialized' | 'hasToken' | 'getSessionId'> & {
  getUserCache: () => { userId: number };
};
function serviceWithFakes(storage: ReturnType<typeof makeStorage>, logger: ReturnType<typeof makeLogger>, api: SyncApiFake, auth?: SyncAuthFake) {
  // These fakes expose only the methods exercised by this suite. Preserve their
  // mock and wire-value types outside the single constructor adapter.
  return new SyncQueueService(storage as unknown as IStorageService, logger as unknown as ILogger,
    api as unknown as IApiClient, auth as unknown as AuthTokenService | undefined);
}

/** In-memory IStorageService whose get/set yield a microtask to expose RMW races. */
function makeStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (k: string) => {
      await Promise.resolve();
      return data.has(k) ? data.get(k) : null;
    }),
    set: vi.fn(async (k: string, v: unknown) => {
      await Promise.resolve();
      data.set(k, v);
      return true;
    }),
    remove: vi.fn(async (k: string) => {
      data.delete(k);
      return true;
    }),
  };
}

function makeLogger() {
  return {
    info: vi.fn<ILogger['info']>(), warn: vi.fn<ILogger['warn']>(),
    error: vi.fn<ILogger['error']>(), success: vi.fn<ILogger['success']>(),
    debug: vi.fn<ILogger['debug']>(),
  } satisfies Pick<ILogger, 'info' | 'warn' | 'error' | 'success' | 'debug'>;
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
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn<NonNullable<SyncApiFake['mutate']>>() };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 80 });

    const queue = await service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.mediaId).toBe(1);
  });
  it('does not change the shared revision or notify other tabs during an unchanged backoff pass', async () => {
    const storage = makeStorage();
    const snapshot = { schemaVersion: 2, revision: 'stable', entries: [{ id: 'held', type: 'ASTRA_SAVE',
      payload: { mediaId: 1, progress: 3 }, retries: 1, lastAttempt: Date.now() }] };
    storage.data.set('sync_queue_v1', snapshot);
    const mutate = vi.fn();
    const service = serviceWithFakes(storage, makeLogger(), { getQueueStatus: () => ({ isRateLimited: false }), mutate });
    await service.process();
    expect(mutate).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
    expect((await service.getSnapshot()).revision).toBe('stable');
    vi.clearAllTimers();
  });

  it('rejects an invalid ASTRA_SAVE payload without mediaId', async () => {
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn<NonNullable<SyncApiFake['mutate']>>() };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await expect(service.enqueue('ASTRA_SAVE', { score: 80 })).rejects.toThrow(/payload/i);

    expect(await service.getQueue()).toHaveLength(0);
  });

  it('deduplicates by mediaId, replacing the pending mutation', async () => {
    const storage = makeStorage();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn<NonNullable<SyncApiFake['mutate']>>() };
    const service = serviceWithFakes(storage, makeLogger(), api);

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
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn<NonNullable<SyncApiFake['mutate']>>() };
    const service = serviceWithFakes(storage, makeLogger(), api);

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
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId ?? payload.id), 1));
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(await service.getQueue()).toHaveLength(0);
  });

  it('syncs status-only changes without a preliminary AniList notes read', async () => {
    const storage = makeStorage();
    const query = vi.fn(async () => ({ MediaList: null }));
    const queryRaw = vi.fn(async () => ({ data: await query() }));
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId), 1));
    const api = { getQueueStatus: () => ({ isRateLimited: false }), query, queryRaw, mutate };
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true,
      getUserCache: () => ({ userId: 1 }), getSessionId: () => 'session-1' };
    const service = serviceWithFakes(storage, makeLogger(), api, auth);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, status: 'PLANNING' }, 'session-1');
    await service.process();

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][1]).toMatchObject({ mediaId: 7, status: 'PLANNING' });
    expect(query).not.toHaveBeenCalled();
    expect(await service.getQueue()).toHaveLength(0);
  });

  it('keeps the mutation and suspends the queue on a 401 auth error', async () => {
    const storage = makeStorage();
    const mutate = vi.fn(async () => {
      const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      throw err;
    });
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    const queue = await service.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].retries).toBe(1);
  });

  it('skips processing while the API is rate limited', async () => {
    const storage = makeStorage();
    const mutate = vi.fn<NonNullable<SyncApiFake['mutate']>>();
    const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    expect(mutate).not.toHaveBeenCalled();
    expect(await service.getQueue()).toHaveLength(1);
  });

  it('preserves an item written concurrently by another context (reconcile, not overwrite)', async () => {
    const storage = makeStorage();
    // Simulate a second context (e.g. content script) enqueuing into the shared
    // storage key WHILE the service worker is processing the current item.
    const mutate = vi.fn(async () => {
      const stored = storage.data.get('sync_queue_v1');
      const current: unknown[] = Array.isArray(stored) ? stored : isRecord(stored) && Array.isArray(stored.entries) ? stored.entries : [];
      storage.data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [
        ...current,
        { id: 'concurrent', type: 'ASTRA_SAVE', payload: { mediaId: 999 }, retries: 0 },
      ] });
      return syncAcknowledgement(7, 1);
    });
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate };
    const service = serviceWithFakes(storage, makeLogger(), api);

    await service.enqueue('ASTRA_SAVE', { mediaId: 7, score: 50 });
    await service.process();

    const queue = await service.getQueue();
    // The processed item (7) is removed; the concurrently-added item (999) survives.
    expect(queue.map((m) => m.payload.mediaId)).toEqual([999]);
  });

  it('rejects a failed queue write and never schedules an undurable save', async () => {
    const storage = makeStorage();
    storage.set.mockResolvedValue(false);
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate: vi.fn<NonNullable<SyncApiFake['mutate']>>() };
    const service = serviceWithFakes(storage, makeLogger(), api);
    await expect(service.enqueue('ASTRA_SAVE', { mediaId: 1 })).rejects.toThrow(/storage/i);
    expect(api.mutate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overwrite the pending queue after a read error', async () => {
    const storage = makeStorage();
    storage.get.mockRejectedValue(new Error('Read failed'));
    const service = serviceWithFakes(storage, makeLogger(), {});
    await expect(service.enqueue('ASTRA_SAVE', { mediaId: 1 })).rejects.toThrow('Read failed');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('sends start and completion dates in the queued GraphQL mutation', async () => {
    const storage = makeStorage();
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId ?? payload.id), 1));
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate };
    const service = serviceWithFakes(storage, makeLogger(), api);
    const payload = { mediaId: 1, startedAt: { year: 2026 }, completedAt: null };
    await service.enqueue('ASTRA_SAVE', payload);
    await service.process();
    expect(mutate.mock.calls[0][1]).toEqual(payload);
    const operation = parse(mutate.mock.calls[0][0]).definitions[0] as OperationDefinitionNode;
    const save = operation.selectionSet.selections[0];
    expect(save.kind).toBe('Field');
    if (save.kind !== 'Field') throw new Error('Expected mutation field');
    const args = Object.fromEntries(save.arguments!.map(arg => [arg.name.value, arg.value]));
    expect(args.startedAt).toMatchObject({ kind: 'Variable', name: { value: 'startedAt' } });
    expect(args.completedAt).toMatchObject({ kind: 'Variable', name: { value: 'completedAt' } });
    // Only enqueue's 500ms wakeup remains, not a leaked mutation timeout.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps account A and unowned legacy mutations suspended while syncing account B', async () => {
    const storage = makeStorage();
    storage.data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [
      { id: 'account-a', userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, score: 20 }, retries: 0 },
      { id: 'legacy', type: 'ASTRA_SAVE', payload: { mediaId: 2 }, retries: 0 },
    ] });
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate: vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId ?? payload.id), 2)) };
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true, getUserCache: () => ({ userId: 2 }), getSessionId: () => 'two' };
    const service = serviceWithFakes(storage, makeLogger(), api, auth);
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 90 });
    await service.process();
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ score: 90 });
    expect((await service.getQueue()).map(m => m.id)).toEqual(['account-a', 'legacy']);
  });

  it('preserves concurrent saves for 100 media per account across service recreation and drains only the current owner', async () => {
    const storage = makeStorage(); let userId = 1;
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true,
      getUserCache: () => ({ userId }), getSessionId: () => `session-${userId}` };
    const offline = { getQueueStatus: () => ({ isRateLimited: true }) };
    const first = serviceWithFakes(storage, makeLogger(), offline, auth);
    await Promise.all(Array.from({ length: 100 }, (_, index) => first.enqueue('ASTRA_SAVE', { mediaId: index + 1, score: 80 })));
    await Promise.all(Array.from({ length: 100 }, (_, index) => first.enqueue('ASTRA_SAVE', { mediaId: index + 1, progress: index % 12 })));
    userId = 2;
    await Promise.all(Array.from({ length: 100 }, (_, index) => first.enqueue('ASTRA_SAVE', { mediaId: index + 1, score: 60 })));
    expect(await first.getQueue()).toHaveLength(200);
    vi.clearAllTimers(); // Recreate the service over durable storage with no old scheduled wakeup.
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId), 2));
    const restarted = serviceWithFakes(storage, makeLogger(), { getQueueStatus: () => ({ isRateLimited: false }), mutate }, auth);
    expect(await restarted.getQueue()).toHaveLength(200);
    await restarted.process(); expect(mutate).toHaveBeenCalledTimes(100);
    const remaining = await restarted.getQueue(); expect(remaining).toHaveLength(100);
    expect(remaining.every(item => item.userId === 1 && item.payload.score === 80
      && item.payload.progress === (Number(item.payload.mediaId) - 1) % 12)).toBe(true);
    expect(mutate.mock.calls.every(([, payload]) => payload.score === 60 && payload.progress === undefined)).toBe(true);
  });

  it('preserves terminal failures instead of silently deleting the pending data', async () => {
    const storage = makeStorage();
    storage.data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [{ id: 'failed', type: 'ASTRA_SAVE', payload: { mediaId: 1 }, retries: 9 }] });
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate: vi.fn(async () => { throw new Error('Offline'); }) };
    const service = serviceWithFakes(storage, makeLogger(), api);
    await service.process();
    expect((await service.getQueue())[0]).toMatchObject({ id: 'failed', retries: 10, error: 'Offline' });
    await service.process();
    expect(api.mutate).toHaveBeenCalledTimes(1);
  });

  it('lets a new save become durable while an older request is in flight', async () => {
    const storage = makeStorage();
    let finish!: () => void;
    const api = { getQueueStatus: () => ({ isRateLimited: false }), mutate: vi.fn(() => new Promise<unknown>(resolve => { finish = () => resolve(syncAcknowledgement(1, 1)); })) };
    const service = serviceWithFakes(storage, makeLogger(), api);
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 10 });
    const processing = service.process();
    await vi.advanceTimersByTimeAsync(0);
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 99 });
    expect((await service.getQueue())[0].payload.score).toBe(99);
    finish();
    await processing;
    expect((await service.getQueue())[0].payload.score).toBe(99);
  });

  it('rejects corrupt queue snapshots without overwriting them', async () => {
    const storage = makeStorage();
    storage.data.set('sync_queue_v1', { broken: true });
    const service = serviceWithFakes(storage, makeLogger(), {});
    await expect(service.enqueue('ASTRA_SAVE', { mediaId: 1 })).rejects.toThrow('Invalid persisted sync queue');
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('merges a notes-only update without losing an offline score or progress', async () => {
    const service = serviceWithFakes(makeStorage(), makeLogger(), { getQueueStatus: () => ({ isRateLimited: true }) });
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, score: 90, progress: 4 });
    await service.enqueue('ASTRA_SAVE', { mediaId: 1, notes: 'Latest' });
    expect((await service.getQueue())[0].payload).toEqual({ mediaId: 1, score: 90, progress: 4, notes: 'Latest' });
  });
  it('rejects an enqueue from an earlier session and clears only the selected owner', async () => {
    const storage = makeStorage();
    storage.data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [
      { id: 'one', type: 'ASTRA_SAVE', payload: { mediaId: 1 }, retries: 0, userId: 1 },
      { id: 'two', type: 'ASTRA_SAVE', payload: { mediaId: 2 }, retries: 0, userId: 2 },
      { id: 'legacy', type: 'ASTRA_SAVE', payload: { mediaId: 3 }, retries: 0 },
    ] });
    const auth = { ensureInitialized: async () => {}, hasToken: () => true, getUserCache: () => ({ userId: 2 }), getSessionId: () => 'two' };
    const service = serviceWithFakes(storage, makeLogger(), {}, auth);
    await expect(service.enqueue('ASTRA_SAVE', { mediaId: 1 }, 'one')).rejects.toThrow('account changed');
    expect(storage.set).not.toHaveBeenCalled();
    await service.clear(2);
    expect((await service.getQueue()).map(item => item.id)).toEqual(['one', 'legacy']);
  });
  it('saves notes for a title with no list entry yet, using a confirmed empty baseline', async () => {
    const storage = makeStorage();
    const queryRaw = vi.fn(async () => ({ data: { MediaList: null }, errors: [{ message: 'Not Found.', status: 404 }] }));
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => syncAcknowledgement(Number(payload.mediaId), 1));
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true, getUserCache: () => ({ userId: 1 }), getSessionId: () => 'one' };
    const service = serviceWithFakes(storage, makeLogger(), { getQueueStatus: () => ({ isRateLimited: false }), queryRaw, mutate }, auth);
    await service.enqueue('ASTRA_SAVE', { mediaId: 9, notes: 'First note' }, 'one');
    expect(await service.getQueue()).toEqual([expect.objectContaining({ baseNotes: null })]);
    await service.process();
    expect(mutate.mock.calls[0][1]).toMatchObject({ mediaId: 9, notes: 'First note' });
    expect(await service.getQueue()).toEqual([]);
  });

  it('accepts the landed write of an in-flight save when a newer save replaces it', async () => {
    const storage = makeStorage();
    let remote = 'Original'; let writes = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queryRaw = vi.fn(async () => ({ data: { MediaList: { id: 1007, mediaId: 7, userId: 1, notes: remote } } }));
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => {
      writes += 1;
      if (writes === 1) await gate; // the first save is still in flight when the replacement arrives
      remote = String(payload.notes); // and it lands on AniList before the replacement is sent
      return syncAcknowledgement(7, 1);
    });
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true, getUserCache: () => ({ userId: 1 }), getSessionId: () => 'one' };
    const service = serviceWithFakes(storage, makeLogger(), { getQueueStatus: () => ({ isRateLimited: false }), queryRaw, mutate }, auth);
    await service.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Local 1' }, 'one');
    const processing = service.process();
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    await service.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Local 2' }, 'one');
    release();
    await processing;
    expect(await service.getQueue()).toEqual([expect.objectContaining({ baseNotes: 'Original', supersededNotes: ['Local 1'],
      payload: expect.objectContaining({ notes: 'Local 2' }) })]);
    await service.process();
    expect(mutate.mock.calls.map(([, payload]) => payload.notes)).toEqual(['Local 1', 'Local 2']);
    expect(await service.getQueue()).toEqual([]);
  });

  it('keeps an append chain writable after its earlier pending append already landed', async () => {
    const storage = makeStorage();
    let remote = 'Original'; let online = false;
    const queryRaw = vi.fn(async () => ({ data: { MediaList: { id: 1007, mediaId: 7, userId: 1, notes: remote } } }));
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown>) => {
      if (!online) throw new Error('Offline');
      remote = String(payload.notes);
      return syncAcknowledgement(7, 1);
    });
    const auth = { ensureInitialized: vi.fn(async () => {}), hasToken: () => true, getUserCache: () => ({ userId: 1 }), getSessionId: () => 'one' };
    const service = serviceWithFakes(storage, makeLogger(), { getQueueStatus: () => ({ isRateLimited: false }), queryRaw, mutate }, auth);
    await service.appendNote(7, 1, 'A', 'one');
    expect(await service.getQueue()).toHaveLength(1);
    remote = 'Original\n\n[Ep 1] A'; // the offline request reached AniList although its response was lost
    online = true;
    await service.appendNote(7, 2, 'B', 'one');
    expect(mutate).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ notes: 'Original\n\n[Ep 1] A\n\n[Ep 2] B' }));
    expect(await service.getQueue()).toEqual([]);
  });
});
