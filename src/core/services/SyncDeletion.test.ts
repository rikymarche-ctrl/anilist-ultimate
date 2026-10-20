import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncQueueService } from './SyncQueueService';
import { SyncQueueClient } from './SyncQueueClient';
import { createBackgroundMessageHandler } from './BackgroundRouter';
import { syncAcknowledgement } from '@/test/sync-fixtures';

function fixture() {
  const stored = new Map<string, unknown>();
  const storage = { get: async (key: string) => structuredClone(stored.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); return true; }) };
  let userId = 42; let sessionId = 'one'; let exists = true;
  const auth = { ensureInitialized: async () => {}, hasToken: () => true,
    getUserCache: () => ({ userId }), getSessionId: () => sessionId };
  const api = { getQueueStatus: () => ({ isRateLimited: false }),
    query: vi.fn(async (): Promise<unknown> => ({ Media: { id: 7,
      mediaListEntry: exists ? { id: 1007, mediaId: 7, userId } : null } })),
    mutate: vi.fn(async (query: string): Promise<unknown> => {
      if (query.includes('DeleteMediaListEntry')) { exists = false; return { DeleteMediaListEntry: { deleted: true } }; }
      return syncAcknowledgement(7, userId);
    }) };
  const cleanup = vi.fn(async (_mediaId: number, _sessionId: string) => {});
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  const worker = () => new SyncQueueService(storage as never, logger as never, api as never, auth as never, cleanup);
  return { queue: worker(), worker, api, auth, storage, stored, cleanup,
    switchAccount: () => { userId = 99; sessionId = 'two'; } };
}

describe('account-scoped entry deletion and pending saves', () => {
  beforeEach(() => { vi.useFakeTimers(); chrome.runtime.id = 'extension-test'; });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('replaces every old save for the selected account/media without retaining conflicting notes', async () => {
    const f = fixture();
    f.stored.set('sync_queue_v1', { schemaVersion: 2, revision: 'seed', entries: [
      { id: 'old', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 7, status: 'PLANNING', notes: 'Old' }, retries: 10, blocked: true },
      { id: 'duplicate', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 7, score: 50 }, retries: 0 },
      { id: 'foreign', type: 'ASTRA_SAVE', userId: 99, payload: { mediaId: 7, status: 'CURRENT' }, retries: 0 },
    ] });
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one');
    expect(await f.queue.getQueue()).toEqual([expect.objectContaining({ id: 'foreign' }),
      expect.objectContaining({ type: 'ASTRA_DELETE', userId: 42, payload: { mediaId: 7 }, retries: 0 })]);
    await f.queue.process();
    expect(f.api.mutate).toHaveBeenCalledOnce();
    expect(f.api.mutate.mock.calls[0][0]).toContain('DeleteMediaListEntry');
    expect(f.cleanup).toHaveBeenCalledWith(7, 'one');
    expect((await f.queue.getQueue()).map(item => item.id)).toEqual(['foreign']);
  });

  it('keeps an offline deletion durable across worker restart and prevents a save from replacing it', async () => {
    const f = fixture(); f.api.query.mockRejectedValueOnce(new Error('Offline'));
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(f.cleanup).not.toHaveBeenCalled();
    await expect(f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, status: 'CURRENT' }, 'one')).rejects.toThrow('deletion is pending');
    vi.clearAllTimers(); vi.setSystemTime(Date.now() + 180000);
    const restarted = f.worker(); await restarted.process();
    expect(f.cleanup).toHaveBeenCalledOnce(); expect(await restarted.getQueue()).toEqual([]);
  });

  it('never persists an ownerless deletion', async () => {
    const stored = new Map<string, unknown>();
    const storage = { get: async (key: string) => stored.get(key) ?? null,
      set: vi.fn(async () => true) };
    const queue = new SyncQueueService(storage as never, {} as never, {} as never);
    await expect(queue.enqueue('ASTRA_DELETE', { mediaId: 7 })).rejects.toThrow('Authenticated deletion owner');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('deletes after an older in-flight save finishes, so that save cannot resurrect the entry', async () => {
    const f = fixture();
    let finish!: (result: unknown) => void;
    f.api.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, status: 'CURRENT' }, 'one');
    const oldSave = f.queue.process();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one');
    finish(syncAcknowledgement(7, 42)); await oldSave; await f.queue.process();
    expect(f.api.mutate.mock.calls.map(call => call[0].includes('DeleteMediaListEntry'))).toEqual([false, true]);
    expect(await f.queue.getQueue()).toEqual([]); expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    { Media: { id: 7, mediaListEntry: { id: 1007, mediaId: 7, userId: 99 } } },
    { Media: { id: 8, mediaListEntry: null } },
    { Media: { id: 7 } },
  ])('does not delete or clean up an unconfirmed or foreign entry', async response => {
    const f = fixture(); f.api.query.mockResolvedValue(response);
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(f.api.mutate).not.toHaveBeenCalled(); expect(f.cleanup).not.toHaveBeenCalled();
    expect((await f.queue.getQueue())[0].type).toBe('ASTRA_DELETE');
  });

  it('retains both local data and the delete intent when AniList does not acknowledge deletion', async () => {
    const f = fixture(); f.api.mutate.mockResolvedValueOnce({ DeleteMediaListEntry: { deleted: false } });
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(f.cleanup).not.toHaveBeenCalled(); expect(await f.queue.getQueue()).toHaveLength(1);
  });

  it('retries local cleanup after remote deletion without requiring the remote entry to exist again', async () => {
    const f = fixture(); f.cleanup.mockRejectedValueOnce(new Error('Storage failed'));
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(await f.queue.getQueue()).toHaveLength(1);
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(f.api.mutate).toHaveBeenCalledOnce(); expect(f.cleanup).toHaveBeenCalledTimes(2);
    expect(await f.queue.getQueue()).toEqual([]);
  });

  it('stops before mutation if the account changes during the identity lookup', async () => {
    const f = fixture();
    f.api.query.mockImplementationOnce(async () => {
      f.switchAccount(); return { Media: { id: 7, mediaListEntry: { id: 1007, mediaId: 7, userId: 42 } } };
    });
    await f.queue.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await f.queue.process();
    expect(f.api.mutate).not.toHaveBeenCalled(); expect(f.cleanup).not.toHaveBeenCalled();
    expect((await f.queue.getQueue())[0].userId).toBe(42);
  });

  it('routes deletion through the background boundary without accepting arbitrary list entry IDs', async () => {
    const f = fixture();
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({
      authenticated: true, userId: 42, sessionId: 'one' }) }) as never, () => f.queue);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => new Promise(resolve =>
      handler(message, { id: 'extension-test', url: 'https://anilist.co/anime/7' }, resolve))) as never);
    const client = new SyncQueueClient(f.auth as never);
    await expect(client.enqueue('ASTRA_DELETE', { mediaId: 7, id: 123 }, 'one')).rejects.toThrow();
    await client.enqueue('ASTRA_DELETE', { mediaId: 7 }, 'one'); await client.process();
    expect(f.cleanup).toHaveBeenCalledWith(7, 'one'); expect(await client.getQueue()).toEqual([]);
  });
});
