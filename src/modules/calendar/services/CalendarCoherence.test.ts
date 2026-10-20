import { describe, expect, it, vi } from 'vitest';
import { CalendarDataService } from './CalendarDataService';
import { CalendarStore } from '../CalendarStore';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { calendarEntry } from '@/test/calendar-fixtures';
import type { AnimeEntry } from '@core/types';

function fixture() {
  let revision = 'first'; let progress = 10;
  const values = new Map<string, unknown>();
  const cache = { get: vi.fn(async (key: string) => values.get(key)), set: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }), clear: vi.fn(async () => { values.clear(); }) };
  const api = { getContext: () => ({ userId: 1, sessionId: 'one' }), ensureContext: async () => ({ userId: 1, sessionId: 'one' }) };
  const queue = { getSnapshot: vi.fn(async () => ({ revision, entries: [] })) };
  const calendar = { fetchAiringSchedule: vi.fn(async (): Promise<AnimeEntry[]> => [calendarEntry(1, { progress })]) };
  const store = new CalendarStore({} as never, { create: () => cache } as never, api as never);
  const bus = new EventBus(); const loaded = vi.fn(); bus.on(EVENT_TYPES.CALENDAR_LOADED, loaded);
  const data = new CalendarDataService(bus, calendar as never, {} as never, store, api as never, queue as never);
  return { cache, queue, calendar, store, bus, loaded, data, change: () => { revision = 'second'; progress = 0; } };
}

describe('calendar durable revision and publication coherence', () => {
  it('uses cache only while the durable queue revision is unchanged', async () => {
    const f = fixture(); await f.data.loadSchedule(1); await f.data.loadSchedule(1);
    expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(1);
    expect(f.loaded).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: true }));
  });
  it('invalidates a cached progress after a completed edit even when a broadcast was missed', async () => {
    const f = fixture(); await f.data.loadSchedule(1); f.change(); await f.data.loadSchedule(1);
    expect(f.store.getState().entries[0].progress).toBe(0); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(2);
    expect(f.loaded).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: false }));
  });
  it('revalidates a cache hit when another context edits during its asynchronous read', async () => {
    const f = fixture(); await f.data.loadSchedule(1); const get = f.cache.get.getMockImplementation()!;
    f.cache.get.mockImplementationOnce(async key => { const value = await get(key); f.change(); return value; });
    await f.data.loadSchedule(1); expect(f.store.getState().entries[0].progress).toBe(0);
    expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(2);
  });
  it('does not publish a fresh response made obsolete during asynchronous cache persistence', async () => {
    const f = fixture(); const set = f.cache.set.getMockImplementation()!;
    f.cache.set.mockImplementationOnce(async (key, value) => { await set(key, value); f.change(); });
    await f.data.loadSchedule(1); expect(f.store.getState().entries[0].progress).toBe(0);
    expect(f.loaded).toHaveBeenCalledTimes(1); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(2);
    await f.data.loadSchedule(1); expect(f.store.getState().entries[0].progress).toBe(0);
  });
  it('bounds continuous revision changes and never reports a stale result as success', async () => {
    const f = fixture(); let version = 0; f.queue.getSnapshot.mockImplementation(async () => ({ revision: `version-${version++}`, entries: [] }));
    await expect(f.data.loadSchedule(1)).rejects.toThrow('changed during loading');
    expect(f.loaded).not.toHaveBeenCalled(); expect(f.store.getState().entries).toEqual([]);
    expect(f.store.getState().loading).toBe(false); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(3);
  });
  it('does not use cached data when the revision protocol is unavailable', async () => {
    const f = fixture(); await f.data.loadSchedule(1); f.store.setEntries([]); f.queue.getSnapshot.mockRejectedValueOnce(new Error('revision unavailable'));
    await expect(f.data.loadSchedule(1)).rejects.toThrow('revision unavailable');
    expect(f.store.getState().entries).toEqual([]); expect(f.store.getState().error?.message).toBe('revision unavailable');
    expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(1);
  });
  it('discards an in-flight provider result and clears cache on a sanitized queue signal', async () => {
    const f = fixture(); await f.data.loadSchedule(1); let finish!: (entries: AnimeEntry[]) => void;
    f.calendar.fetchAiringSchedule.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = f.data.loadSchedule(1, true); const rejected = expect(pending).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(2));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined); finish([calendarEntry(1, { progress: 99 })]); await rejected;
    expect(f.store.getState().entries[0].progress).toBe(10); expect(f.store.getState().loading).toBe(false);
    f.change(); await f.data.loadSchedule(1); expect(f.store.getState().entries[0].progress).toBe(0);
  });
  it('preserves the provider error when revision validation also fails during cache fallback', async () => {
    const f = fixture(); f.calendar.fetchAiringSchedule.mockRejectedValue(new Error('provider offline'));
    f.queue.getSnapshot.mockResolvedValueOnce({ revision: 'first', entries: [] }).mockRejectedValue(new Error('revision unavailable'));
    await expect(f.data.loadSchedule(1)).rejects.toThrow('provider offline');
    expect(f.store.getState().error?.message).toBe('provider offline'); expect(f.store.getState().loading).toBe(false);
  });
});
