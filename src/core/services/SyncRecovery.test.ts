import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncListEntry, syncAcknowledgement } from '@/test/sync-fixtures';
import { SyncQueueService } from './SyncQueueService';
import { SyncQueueClient } from './SyncQueueClient';
import { createBackgroundMessageHandler } from './BackgroundRouter';
import { MSG } from '@shared/messages';

function fixture() {
  const data = new Map<string, unknown>(); let session = 'one'; let userId = 1; let progress = 3; let notes = 'Original';
  const storage = { get: vi.fn(async (key: string) => structuredClone(data.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }) };
  const auth = { ensureInitialized: async () => {}, hasToken: () => true, getSessionId: () => session, getUserCache: () => ({ userId }) };
  const query = vi.fn(async () => ({ MediaList: { ...syncListEntry(7, userId, progress), notes } }));
  const api = { getQueueStatus: () => ({ isRateLimited: false }), query, queryRaw: vi.fn(async () => ({ data: await query() })),
    mutate: vi.fn(async (_query: string, payload: { progress?: number; notes?: string }) => { if (payload.progress !== undefined) progress = payload.progress; if (payload.notes !== undefined) notes = payload.notes; return syncAcknowledgement(7, userId); }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  const policy = vi.fn(async (_mediaId: number, _updatedAt: number, _session: string) => true);
  const queue = new SyncQueueService(storage as never, logger as never, api as never, auth as never, undefined, policy);
  return { queue, api, storage, data, auth, policy, renewSession: () => { session = 'two'; }, remoteNotes: (value: string) => { notes = value; }, switchAccount: () => { session = 'two'; userId = 2; } };
}
describe('background progress, notes and recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); chrome.runtime.id = 'extension-test'; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('serializes increments from two tab clients without losing either increment', async () => {
    const { queue, api } = fixture();
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ authenticated: true, userId: 1, sessionId: 'one' }) }) as never, () => queue);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => new Promise(resolve => handler(message, { id: 'extension-test', url: 'https://anilist.co/home' }, resolve))) as never);
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 'one' };
    const clients = [new SyncQueueClient(metadata as never), new SyncQueueClient(metadata as never)];
    const results = await Promise.all(clients.map(client => client.updateProgress(7)));
    expect(results.map(result => result.progress)).toEqual([4, 5]);
    expect(api.mutate.mock.calls.map(call => call[1].progress)).toEqual([4, 5]);
  });
  it('uses durable pending progress when simultaneous increments are offline', async () => {
    const { queue, api } = fixture(); api.mutate.mockRejectedValue(new Error('Offline'));
    const results = await Promise.all([queue.updateProgress(7, undefined, 'one'), queue.updateProgress(7, undefined, 'one')]);
    expect(results.map(result => result.progress)).toEqual([4, 5]);
    expect((await queue.getQueue())[0].payload.progress).toBe(5);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('preserves both offline note additions and the surrounding remote text', async () => {
    const { queue, api } = fixture(); api.mutate.mockRejectedValue(new Error('Offline'));
    await Promise.all([queue.appendNote(7, 1, 'First', 'one'), queue.appendNote(7, 2, 'Second', 'one')]);
    expect((await queue.getQueue())[0]).toMatchObject({ baseNotes: 'Original', payload: { notes: 'Original\n\n[Ep 1] First\n\n[Ep 2] Second' } });
  });
  it('holds a report derived from stale notes even if remote text changes before enqueue', async () => {
    const { queue, api, remoteNotes } = fixture();
    remoteNotes('New personal note');
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Original + report', expectedNotes: 'Original', astraNotesUpdatedAt: 1 }, 'one');
    // Enqueue must not silently rebase this replacement on a more recent remote value.
    expect(api.query).not.toHaveBeenCalled();
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0]).toMatchObject({ blocked: true, baseNotes: 'Original' });
  });

  it('checks both preconditions when a new report replaces an older pending version', async () => {
    const { queue, api, remoteNotes } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'First report', expectedNotes: 'Original' }, 'one');
    remoteNotes('Edited externally');
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Second report based on external edit', expectedNotes: 'Edited externally' }, 'one');
    remoteNotes('Original'); // An external revert must not make the older baseline authorize a newer report.
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0].blocked).toBe(true);
  });

  it('persists an exact, exportable backup before writing and never sends internal metadata to AniList', async () => {
    const { queue, api, data } = fixture();
    api.mutate.mockImplementationOnce(async (_query, payload) => {
      expect(data.get('sync_recovery_notes_1')).toMatchObject({ entries: [{ userId: 1, payload: { mediaId: 7, notes: 'Original' } }] });
      expect(payload).toEqual({ mediaId: 7, notes: 'Original + report' });
      return syncAcknowledgement(7, 1);
    });
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Original + report', expectedNotes: 'Original', astraNotesUpdatedAt: 1 }, 'one');
    await queue.process();
    expect(await queue.getQueue()).toEqual([]);
    expect(await queue.recovery('notes', [], 'one')).toEqual([expect.objectContaining({ payload: { mediaId: 7, notes: 'Original' } })]);
  });

  it('holds the remote write when the backup cannot be persisted', async () => {
    const { queue, api, storage } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original' }, 'one');
    const persist = storage.set.getMockImplementation()!;
    storage.set.mockImplementation((key, value) => key.startsWith('sync_recovery_notes_') ? Promise.resolve(false) : persist(key, value));
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0].payload.notes).toBe('Report');
  });

  it('cancels a pending automatic report when the option is disabled but still syncs list progress', async () => {
    const { queue, api, policy } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original', astraNotesUpdatedAt: 1, progress: 8 }, 'one');
    policy.mockResolvedValue(false);
    await queue.process();
    expect(api.mutate.mock.calls[0][1]).toEqual({ mediaId: 7, progress: 8 });
    expect(api.query).not.toHaveBeenCalled();
    expect(await queue.getQueue()).toEqual([]);
  });

  it('cancels a notes-only report when a newer local save arrives during the remote read', async () => {
    const { queue, api, policy } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Old report', expectedNotes: 'Original', astraNotesUpdatedAt: 1 }, 'one');
    policy.mockResolvedValueOnce(true).mockResolvedValue(false);
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect(await queue.getQueue()).toEqual([]);
  });

  it('does not let an older automatic policy swallow an explicit editor change', async () => {
    const { queue, api, policy } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original', astraNotesUpdatedAt: 1 }, 'one');
    policy.mockResolvedValue(false);
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Explicit edit' }, 'one');
    await queue.process();
    expect(api.mutate.mock.calls[0][1]).toEqual({ mediaId: 7, notes: 'Explicit edit' });
    expect(policy).not.toHaveBeenCalled();
  });

  it('does not repeat a notes mutation after a lost acknowledgement if the desired text is already present', async () => {
    const { queue, api, remoteNotes } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Desired', expectedNotes: 'Original' }, 'one');
    remoteNotes('Desired');
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect(await queue.getQueue()).toEqual([]);
  });

  it('keeps conflicts protected after an explicit retry when another edit arrives later', async () => {
    const { queue, api, remoteNotes } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Local', expectedNotes: 'Original' }, 'one');
    remoteNotes('External'); await queue.process();
    const [held] = await queue.getQueue();
    await queue.recovery('retry', [held.id], 'one');
    remoteNotes('Even newer external'); await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0]).toMatchObject({ blocked: true, baseNotes: 'External' });
  });

  it('never exposes one account’s Notes backups to another account', async () => {
    const { queue, switchAccount } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original' }, 'one');
    await queue.process(); switchAccount();
    expect(await queue.recovery('notes', [], 'two')).toEqual([]);
  });

  it('bounds backup history and does not duplicate backups on offline retries', async () => {
    const { queue, api, remoteNotes } = fixture();
    api.mutate.mockRejectedValueOnce(new Error('Offline'));
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original' }, 'one');
    await queue.process(); await vi.advanceTimersByTimeAsync(125000); await queue.process();
    expect(await queue.recovery('notes', [], 'one')).toHaveLength(1);
    for (let i = 0; i < 23; i++) {
      remoteNotes(`Personal ${i}`);
      await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: `Report ${i}`, expectedNotes: `Personal ${i}` }, 'one');
      await queue.process();
    }
    const backups = await queue.recovery('notes', [], 'one');
    expect(backups).toHaveLength(20);
    expect(backups[0].payload.notes).toBe('Personal 3');
    expect(backups[19].payload.notes).toBe('Personal 22');
  });

  it('rejects oversized notes before reading, persisting or mutating anything', async () => {
    const { queue, api, storage } = fixture();
    await expect(queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'x'.repeat(6001) }, 'one')).rejects.toThrow('6000');
    expect(api.query).not.toHaveBeenCalled(); expect(api.mutate).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  });

  it('holds a persisted legacy Notes replacement with no original baseline', async () => {
    const { queue, api, data } = fixture();
    data.set('sync_queue_v1', { schemaVersion: 2, revision: 'legacy', entries: [{ id: 'legacy', type: 'ASTRA_SAVE', userId: 1, retries: 0, payload: { mediaId: 7, notes: 'Old replacement' } }] });
    await queue.process();
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0]).toMatchObject({ blocked: true, payload: { notes: 'Old replacement' } });
  });

  it('uses one transport attempt so every later retry must reread the original Notes precondition', async () => {
    const { queue, api, remoteNotes } = fixture();
    const mutateOnce = vi.fn(async () => { throw new Error('Offline'); });
    Object.assign(api, { mutateOnce });
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Report', expectedNotes: 'Original' }, 'one');
    await queue.process();
    remoteNotes('External edit'); await vi.advanceTimersByTimeAsync(125000); await queue.process();
    expect(mutateOnce).toHaveBeenCalledTimes(1);
    expect(api.mutate).not.toHaveBeenCalled();
    expect((await queue.getQueue())[0].blocked).toBe(true);
  });
  it('holds an offline mutation after notes are externally edited and preserves both versions', async () => {
    const { queue, api, remoteNotes } = fixture(); api.mutate.mockRejectedValueOnce(new Error('Offline'));
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Local' }, 'one'); await queue.process();
    remoteNotes('External'); await vi.advanceTimersByTimeAsync(125000); await queue.process();
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect((await queue.getQueue())[0]).toMatchObject({ blocked: true, retries: 10, baseNotes: 'Original', payload: { notes: 'Local' } });
  });
  it('does not expose unknown-owner recovery records to content scripts', async () => {
    const { queue, data } = fixture(); data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [{ id: 'unknown', type: 'ASTRA_SAVE', payload: { mediaId: 7, notes: 'Legacy' }, retries: 0 }] });
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ authenticated: true, userId: 1, sessionId: 'one' }) }) as never, () => queue);
    const request = (url: string) => new Promise<{ success: boolean; data?: unknown }>(resolve => handler({ type: MSG.SYNC_RECOVERY, operation: 'export', sessionId: 'one' }, { id: 'extension-test', url }, resolve as never));
    expect((await request('https://anilist.co/home')).success).toBe(false);
    expect((await request('chrome-extension://extension-test/settings.html')).data).toEqual([]);
  });
  it('never exports or retries records without an account owner', async () => {
    const { queue, data } = fixture(); const original = { schemaVersion: 2, revision: 'unknown', entries: [{ id: 'unknown', type: 'ASTRA_SAVE', payload: { mediaId: 7 }, retries: 10 }] }; data.set('sync_queue_v1', original);
    expect(await queue.recovery('export', [], 'one')).toEqual([]);
    await expect(queue.recovery('retry', ['unknown'], 'one')).rejects.toThrow('selection');
    expect(data.get('sync_queue_v1')).toEqual(original);
  });
  it('preserves the queue when recovery backup persistence fails', async () => {
    const { queue, data, storage } = fixture(); const original = [{ id: 'terminal', userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 7 }, retries: 10 }]; data.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: original });
    storage.set.mockResolvedValueOnce(false);
    await expect(queue.recovery('retry', ['terminal'], 'one')).rejects.toThrow('backup');
    expect(data.get('sync_queue_v1')).toMatchObject({ entries: original });
  });
  it('rejects recovery and a queued media command after account change', async () => {
    const { queue, switchAccount } = fixture(); switchAccount();
    await expect(queue.updateProgress(7, undefined, 'one')).rejects.toThrow('account changed');
    await expect(queue.recovery('export', [], 'one')).rejects.toThrow('account changed');
  });
  it('merges successive saves without losing pending progress', async () => {
    const { queue } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, score: 40, progress: 5 }, 'one');
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, score: 90 }, 'one');
    expect(await queue.getQueue()).toEqual([expect.objectContaining({ type: 'ASTRA_SAVE', payload: { mediaId: 7, score: 90, progress: 5 } })]);
  });
  it('does not send notes under a renewed same-owner session after the baseline request starts', async () => {
    const { queue, api, renewSession } = fixture();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 7, notes: 'Local' }, 'one');
    let resolve!: (value: { MediaList: ReturnType<typeof syncListEntry> }) => void;
    api.query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = queue.process(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    renewSession(); resolve({ MediaList: { ...syncListEntry(), notes: 'Original' } }); await pending;
    expect(api.mutate).not.toHaveBeenCalled(); expect((await queue.getQueue())[0].payload.notes).toBe('Local');
  });

});
