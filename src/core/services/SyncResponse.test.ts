import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncQueueClient } from './SyncQueueClient';
import { SyncQueueService } from './SyncQueueService';
import { syncListEntry, syncAcknowledgement } from '@/test/sync-fixtures';

function fixture() {
  const records = new Map<string, unknown>(); const storage = { get: vi.fn(async (key: string) => structuredClone(records.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { records.set(key, structuredClone(value)); return true; }) };
  let owner = 1; let session = 'one';
  const auth = { ensureInitialized: async () => {}, getUserCache: () => ({ userId: owner }), getSessionId: () => session, hasToken: () => true };
  const query = vi.fn(async (_query: string, _variables?: Record<string, unknown>): Promise<unknown> => ({ MediaList: syncListEntry() }));
  // Notes baselines read the raw envelope; delegating keeps one call log for both read paths.
  const api = { query, queryRaw: vi.fn(async (text: string, variables?: Record<string, unknown>) => ({ data: await query(text, variables) })),
    mutate: vi.fn(async (_query: string, _variables: Record<string, unknown>): Promise<unknown> => syncAcknowledgement()), getQueueStatus: () => ({ isRateLimited: false }) };
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() };
  const queue = new SyncQueueService(storage as never, logger as never, api as never, auth as never);
  return { queue, api, storage, logger, switchAccount: () => { owner = 2; session = 'two'; } };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('progress command response boundary', () => {
  it.each([{ userId: 2 }, { mediaId: 8 }, { id: 0 }, { progress: -1 }, { progress: 2147483648 },
    { progress: '3' }, { status: 'WATCHING' }, { media: { id: 8, title: { userPreferred: 'Other' } } },
    { media: { id: 7, title: { userPreferred: {} } } }])('rejects unrelated or malformed progress before enqueue: %j', async patch => {
    const f = fixture(); f.api.query.mockResolvedValue({ MediaList: { ...syncListEntry(), ...patch } });
    await expect(f.queue.updateProgress(7, 4, 'one')).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled(); expect(f.api.mutate).not.toHaveBeenCalled(); expect(await f.queue.getQueue()).toEqual([]);
  });
  it.each([{}, { MediaList: null }, { MediaList: [] }])('rejects unavailable progress envelopes %j', async value => {
    const f = fixture(); f.api.query.mockResolvedValue(value); await expect(f.queue.updateProgress(7, 4, 'one')).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled();
  });
  it('normalizes nullable progress to zero and tolerates nullable display metadata', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ MediaList: { ...syncListEntry(7, 1, null), media: null } });
    expect(await f.queue.updateProgress(7, undefined, 'one')).toMatchObject({ previousProgress: 0, progress: 1, title: 'Media 7', userId: 1, syncState: 'synced' });
  });
  it('does not coerce an invalid owner ID into an authenticated command', async () => {
    const f = fixture(); f.switchAccount(); await expect(f.queue.updateProgress(7, 4, 'one')).rejects.toThrow('account changed');
    expect(f.api.query).not.toHaveBeenCalled();
  });
});

describe('note baseline response boundary', () => {
  it.each([{ userId: 2 }, { mediaId: 8 }, { id: 0 }, { notes: {} }, { notes: undefined }])('does not enqueue notes from an unrelated or malformed baseline %j', async patch => {
    const f = fixture(); f.api.query.mockResolvedValue({ MediaList: { ...syncListEntry(), ...patch }, Media: { mediaListEntry: { notes: 'Unverified' } } });
    await expect(f.queue.appendNote(7, 1, 'Local', 'one')).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled(); expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it.each([
    ['AniList 404 Not Found envelope', { data: { MediaList: null }, errors: [{ message: 'Not Found.', status: 404 }] }],
    ['MediaList null without errors', { data: { MediaList: null } }],
  ])('treats a confirmed missing list entry (%s) as an empty baseline for a new note', async (_label, response) => {
    const f = fixture(); f.api.queryRaw.mockResolvedValue(response);
    await f.queue.appendNote(7, 1, 'Local', 'one');
    expect(f.api.mutate).toHaveBeenCalledTimes(1);
    expect(f.api.mutate.mock.calls[0]?.[1]).toMatchObject({ mediaId: 7, notes: '[Ep 1] Local' });
    expect(await f.queue.getQueue()).toEqual([]);
  });
  it('treats a bare HTTP 404 for the notes lookup as a missing list entry', async () => {
    const f = fixture(); f.api.queryRaw.mockRejectedValue(Object.assign(new Error('Not Found.'), { statusCode: 404 }));
    await f.queue.appendNote(7, 1, 'Local', 'one');
    expect(f.api.mutate).toHaveBeenCalledTimes(1);
    expect(await f.queue.getQueue()).toEqual([]);
  });
  it.each([
    ['a non-404 GraphQL error', { data: { MediaList: null }, errors: [{ message: 'Internal', status: 500 }] }],
    ['a 404 that carries an unrelated entry', { data: { MediaList: { ...syncListEntry(), mediaId: 8 } }, errors: [{ message: 'Not Found.', status: 404 }] }],
  ])('does not treat %s as an empty baseline', async (_label, response) => {
    const f = fixture(); f.api.queryRaw.mockResolvedValue(response);
    await expect(f.queue.appendNote(7, 1, 'Local', 'one')).rejects.toThrow();
    expect(f.api.mutate).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled();
  });
  it('still fails closed on a transport error other than the missing-entry 404', async () => {
    const f = fixture(); f.api.queryRaw.mockRejectedValue(Object.assign(new Error('Server'), { statusCode: 500 }));
    await expect(f.queue.appendNote(7, 1, 'Local', 'one')).rejects.toThrow('Server');
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('accepts confirmed null notes as an empty baseline without inventing remote text', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ MediaList: { ...syncListEntry(), notes: null } });
    await f.queue.appendNote(7, 1, 'Local', 'one'); expect(f.api.mutate).toHaveBeenCalledTimes(1);
    expect(f.api.mutate.mock.calls[0]?.[1]).toMatchObject({ notes: '[Ep 1] Local' });
    expect(await f.queue.getQueue()).toEqual([]);
  });
});

describe('durable mutation acknowledgements', () => {
  it.each([undefined, {}, { SaveMediaListEntry: null }, { SaveMediaListEntry: { ...syncAcknowledgement().SaveMediaListEntry, userId: 2 } },
    { SaveMediaListEntry: { ...syncAcknowledgement().SaveMediaListEntry, mediaId: 8 } }, { SaveMediaListEntry: { ...syncAcknowledgement().SaveMediaListEntry, id: 0 } }])('preserves an unconfirmed mutation for retry: %j', async response => {
    const f = fixture(); f.api.mutate.mockResolvedValue(response);
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 0 }, 'one'); await f.queue.process();
    expect(await f.queue.getQueue()).toEqual([expect.objectContaining({ userId: 1, retries: 1, payload: { mediaId: 7, progress: 0 } })]);
    expect(f.logger.success).not.toHaveBeenCalled();
  });
  it('keeps a mutation when the session changes after the remote reply', async () => {
    const f = fixture(); f.api.mutate.mockImplementation(async () => { f.switchAccount(); return syncAcknowledgement(); });
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, score: 60 }, 'one'); await f.queue.process();
    expect((await f.queue.getQueue())[0]).toMatchObject({ userId: 1, payload: { mediaId: 7, score: 60 } });
    expect(f.logger.success).not.toHaveBeenCalled();
  });
  it('does not log notes or raw malformed acknowledgement payloads', async () => {
    const f = fixture(); f.api.mutate.mockResolvedValue({ private: 'secret diagnostic', notes: 'Private note' });
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 0 }, 'one'); await f.queue.process();
    const diagnostics = [...f.logger.error.mock.calls, ...f.logger.warn.mock.calls].flat()
      .map(value => value instanceof Error ? value.message : JSON.stringify(value)).join(' ');
    expect(diagnostics).not.toContain('Private note');
    expect(diagnostics).not.toContain('secret diagnostic');
  });
});


describe('public worker progress result boundary', () => {
  const result = { mediaId: 7, userId: 1, progress: 0, previousProgress: 3, status: 'CURRENT', title: 'Title', syncState: 'queued' };
  it.each([{ mediaId: 8 }, { userId: 2 }, { progress: -1 }, { progress: '0' }, { previousProgress: 2147483648 },
    { status: 'WATCHING' }, { title: {} }, { syncState: 'unknown' }])('rejects a malformed worker result %j', async patch => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: { ...result, ...patch } });
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 'one', getUserCache: () => ({ userId: 1 }) };
    await expect(new SyncQueueClient(metadata as never).updateProgress(7, 0, 'one')).rejects.toThrow('progress result');
  });
  it('projects a copied public result and omits unexpected private fields', async () => {
    const raw = { ...result, notes: 'Private note', token: 'Secret' };
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: raw });
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 'one', getUserCache: () => ({ userId: 1 }) };
    const output = await new SyncQueueClient(metadata as never).updateProgress(7, 0, 'one');
    expect(output).toEqual(result); output.progress = 99; expect(raw.progress).toBe(0);
  });
});


describe('durable progress baselines and concurrent saves', () => {
  it.each(['3', -1])('rejects a corrupt pending baseline before replacing it: %s', async progress => {
    const f = fixture();
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 3 }, 'one');
    const snapshot = await f.queue.getSnapshot(); snapshot.entries[0].payload.progress = progress as never;
    await f.storage.set('sync_queue_v1', { schemaVersion: 2, ...snapshot }); f.storage.set.mockClear();
    await expect(f.queue.updateProgress(7, 4, 'one')).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled(); expect((await f.queue.getQueue())[0].payload.progress).toBe(progress);
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('returns the latest durable progress/status when a newer save supersedes an in-flight increment', async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    f.api.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.queue.updateProgress(7, undefined, 'one');
    await vi.waitFor(() => expect(f.api.mutate).toHaveBeenCalledTimes(1));
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 0, status: 'COMPLETED' }, 'one');
    finish(syncAcknowledgement());
    expect(await pending).toMatchObject({ progress: 0, previousProgress: 3, status: 'COMPLETED', syncState: 'queued' });
    expect((await f.queue.getQueue())[0].payload).toMatchObject({ progress: 0, status: 'COMPLETED' });
  });
});
