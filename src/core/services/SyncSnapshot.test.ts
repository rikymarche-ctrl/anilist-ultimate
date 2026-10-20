import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncListEntry, syncAcknowledgement } from '@/test/sync-fixtures';
import { SyncQueueService } from './SyncQueueService';
import { SyncQueueClient } from './SyncQueueClient';
import { createBackgroundMessageHandler } from './BackgroundRouter';
import { CalendarService } from '@modules/calendar/CalendarService';
import { MSG } from '@shared/messages';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { calendarCollection, calendarListEntry } from '@/test/calendar-fixtures';

function fixture() {
  const values = new Map<string, unknown>();
  const storage = { get: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); return true; }), remove: vi.fn(async () => true) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  let remoteProgress = 10;
  const api = { query: vi.fn(async () => ({ MediaList: syncListEntry(1, 1, remoteProgress) })),
    mutate: vi.fn(async (_query: string, variables: Record<string, unknown>) => { if (typeof variables.progress === 'number') remoteProgress = variables.progress; return syncAcknowledgement(1, 1); }),
    getQueueStatus: () => ({ isRateLimited: false }) };
  const auth = { ensureInitialized: async () => {}, getUserCache: () => ({ userId: 1 }), hasToken: () => true, getSessionId: () => 'one' };
  const queue = new SyncQueueService(storage as never, logger as never, api as never, auth as never);
  return { values, storage, api, queue, remote: () => remoteProgress };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('durable queue revisions', () => {
  it('detects enqueue and completed sync even when both queue snapshots are empty', async () => {
    vi.useFakeTimers(); const f = fixture(); const before = await f.queue.getSnapshot();
    await f.queue.updateProgress(1, 0, 'one'); const after = await f.queue.getSnapshot();
    expect(before.entries).toEqual([]); expect(after.entries).toEqual([]); expect(after.revision).not.toBe(before.revision);
    expect(f.remote()).toBe(0);
    const reopened = new SyncQueueService(f.storage as never, {} as never, {} as never);
    expect(await reopened.getSnapshot()).toEqual(after);
  });
  it('rejects an unversioned queue without importing, sending or replacing records', async () => {
    const f = fixture(); const original = [{ id: 'old', userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 3 }, retries: 0 }];
    f.values.set('sync_queue_v1', original);
    await expect(f.queue.getSnapshot()).rejects.toThrow('Invalid persisted');
    await expect(f.queue.enqueue('ASTRA_SAVE', { mediaId: 1, score: 60 }, 'one')).rejects.toThrow('Invalid persisted');
    await expect(f.queue.process()).rejects.toThrow('Invalid persisted');
    expect(f.values.get('sync_queue_v1')).toEqual(original); expect(f.storage.set).not.toHaveBeenCalled(); expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('preserves revision and records when a durable write fails', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.queue.enqueue('ASTRA_SAVE', { mediaId: 1, progress: 3 }, 'one');
    const before = await f.queue.getSnapshot(); f.storage.set.mockResolvedValueOnce(false);
    await expect(f.queue.enqueue('ASTRA_SAVE', { mediaId: 1, progress: 0 }, 'one')).rejects.toThrow('write failed');
    expect(await f.queue.getSnapshot()).toEqual(before);
  });
  it('advances revision when clearing all entries instead of restoring the original missing-key revision', async () => {
    vi.useFakeTimers(); const f = fixture(); const before = await f.queue.getSnapshot();
    await f.queue.enqueue('ASTRA_SAVE', { mediaId: 1, progress: 3 }, 'one'); await f.queue.clear();
    const cleared = await f.queue.getSnapshot(); expect(cleared.entries).toEqual([]); expect(cleared.revision).not.toBe(before.revision);
  });
  it('rejects a corrupted envelope without replacing original data', async () => {
    const f = fixture(); const broken = { schemaVersion: 2, revision: '', entries: [] }; f.values.set('sync_queue_v1', broken);
    await expect(f.queue.getSnapshot()).rejects.toThrow(); expect(f.values.get('sync_queue_v1')).toEqual(broken); expect(f.storage.set).not.toHaveBeenCalled();
  });
});

describe('two clients sharing the background writer', () => {
  it('restarts a calendar read after an edit and completed sync in another client', async () => {
    vi.useFakeTimers(); const f = fixture();
    const auth = { getStatus: async () => ({ authenticated: true, userId: 1, sessionId: 'one' }) };
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => auth as never, () => f.queue);
    const sender = { id: chrome.runtime.id, url: 'https://anilist.co/home' };
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(message => new Promise(resolve => { handler(message, sender, resolve); }) as never);
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 'one' };
    const first = new SyncQueueClient(metadata as never); const second = new SyncQueueClient(metadata as never);
    let finish!: (value: unknown) => void;
    const query = vi.fn(async (): Promise<unknown> => calendarCollection([{ ...calendarListEntry(), progress: f.remote() }]));
    query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const calendarApi = { ensureContext: async () => ({ userId: 1, sessionId: 'one' }), getContext: () => ({ userId: 1, sessionId: 'one' }), query };
    const calendar = new CalendarService(calendarApi as never, {} as never, {} as never, first);
    const pending = calendar.fetchAiringSchedule(1); await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await second.updateProgress(1, 0, 'one'); expect(await first.getQueue()).toEqual([]);
    finish(calendarCollection([{ ...calendarListEntry(), progress: 10 }]));
    expect((await pending)[0].progress).toBe(0); expect(query).toHaveBeenCalledTimes(2);
  });
});


describe('snapshot and signal privilege boundary', () => {
  it('returns only the current owner records with the opaque durable revision', async () => {
    const f = fixture(); f.values.set('sync_queue_v1', { schemaVersion: 2, revision: 'durable', entries: [
      { id: 'mine', userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 0 }, retries: 0 },
      { id: 'foreign', userId: 2, type: 'ASTRA_SAVE', payload: { mediaId: 2, notes: 'foreign secret' }, retries: 0 },
      { id: 'legacy', type: 'ASTRA_SAVE', payload: { mediaId: 3, notes: 'unknown secret' }, retries: 0 } ] });
    const auth = { getStatus: async () => ({ authenticated: true, userId: 1, sessionId: 'one' }) };
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => auth as never, () => f.queue);
    const response = await new Promise(resolve => handler({ type: MSG.SYNC_SNAPSHOT, sessionId: 'one' }, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve));
    expect(response).toEqual({ success: true, data: { revision: 'durable', entries: [expect.objectContaining({ id: 'mine' })] } });
    expect(JSON.stringify(response)).not.toContain('secret');
  });
  it('rejects a snapshot if the account changes while its durable read is pending', async () => {
    const f = fixture(); let sessionId = 'one'; const get = f.storage.get.getMockImplementation()!;
    f.storage.get.mockImplementationOnce(async key => { const value = await get(key); sessionId = 'two'; return value; });
    const auth = { getStatus: async () => ({ authenticated: true, userId: 1, sessionId }) };
    const handler = createBackgroundMessageHandler(Promise.resolve(), () => auth as never, () => f.queue);
    const response = await new Promise(resolve => handler({ type: MSG.SYNC_SNAPSHOT, sessionId: 'one' }, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve));
    expect(response).toEqual(expect.objectContaining({ success: false, code: 'ACCOUNT_CHANGED' }));
  });
  it.each([null, {}, { revision: '', entries: [] }, { revision: 'valid', entries: null }, { revision: 'bad secret', entries: [] }])('rejects malformed snapshot response %j', async value => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: value });
    await expect(new SyncQueueClient().getSnapshot()).rejects.toThrow(/Invalid.*(snapshot|queue)/);
  });
  it('accepts only trusted queue signals and releases its listeners at disposal', () => {
    const bus = new EventBus(); const changed = vi.fn(); bus.on(EVENT_TYPES.SYNC_QUEUE_CHANGED, changed);
    const client = new SyncQueueClient(undefined, bus);
    const message = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
    message({ type: MSG.LOCAL_CHANGED, syncQueueChanged: true }, { id: 'foreign-extension' }, () => {});
    message({ type: MSG.LOCAL_CHANGED, syncQueueChanged: 'true' }, { id: chrome.runtime.id }, () => {});
    message({ type: 'other', syncQueueChanged: true }, { id: chrome.runtime.id }, () => {});
    expect(changed).not.toHaveBeenCalled();
    message({ type: MSG.LOCAL_CHANGED, syncQueueChanged: true }, { id: chrome.runtime.id }, () => {});
    expect(changed).toHaveBeenCalledTimes(1); client.dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(message);
    message({ type: MSG.LOCAL_CHANGED, syncQueueChanged: true }, { id: chrome.runtime.id }, () => {});
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('copies snapshot entries so callers cannot mutate the background response graph', async () => {
    const input = { revision: 'valid', entries: [{ id: 'mine', userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 3 }, retries: 0 }] };
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: input });
    const output = await new SyncQueueClient().getSnapshot(); output.entries[0].payload.progress = 99;
    expect(input.entries[0].payload.progress).toBe(3);
  });
});
