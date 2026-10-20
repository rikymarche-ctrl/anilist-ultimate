import { describe, expect, it, vi } from 'vitest';
import { CalendarDataService } from './CalendarDataService';
import { CalendarStore } from '../CalendarStore';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { calendarEntry } from '@/test/calendar-fixtures';
import type { AnimeEntry } from '@core/types';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function fixture() {
  const values = new Map<string, unknown>(); const cache = {
    get: vi.fn(async (key: string) => values.get(key)), set: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }), clear: vi.fn(async () => { values.clear(); }),
  };
  const api = { ensureContext: vi.fn(async () => ({ userId: 1, sessionId: 'one' })), getContext: () => ({ userId: 1, sessionId: 'one' }) };
  const store = new CalendarStore({} as never, { create: () => cache } as never, api as never);
  const bus = new EventBus(); const loaded = vi.fn(); bus.on(EVENT_TYPES.CALENDAR_LOADED, loaded);
  const calendar = { fetchAiringSchedule: vi.fn(async (): Promise<AnimeEntry[]> => [calendarEntry()]),
    incrementProgress: vi.fn(async () => ({ progress: 11, previousProgress: 10, userId: 1 })) };
  const toast = { success: vi.fn(), error: vi.fn() };
  const service = new CalendarDataService(bus, calendar as never, toast as never, store, api as never);
  return { cache, api, store, bus, loaded, calendar, toast, service };
}

describe('calendar loading boundaries and disposable cache', () => {
  it('caches a confirmed empty refresh and removes previously cached titles', async () => {
    const f = fixture(); await f.service.loadSchedule(1); f.calendar.fetchAiringSchedule.mockResolvedValueOnce([]);
    await f.service.loadSchedule(1, true); expect(f.store.getState().entries).toEqual([]);
    await f.service.loadSchedule(1); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(2);
    expect(f.loaded).toHaveBeenLastCalledWith(expect.objectContaining({ fromCache: true, scheduleCount: 0 }));
  });

  it('loads fresh data even when the cache read fails', async () => {
    const f = fixture(); f.cache.get.mockRejectedValueOnce(new Error('cache read failed'));
    await f.service.loadSchedule(1); expect(f.store.getState().entries[0].mediaId).toBe(1);
    expect(f.store.getState().error).toBeNull(); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful result successful if its disposable cache write fails', async () => {
    const f = fixture(); f.cache.set.mockRejectedValueOnce(new Error('cache write failed'));
    await f.service.loadSchedule(1); expect(f.store.getState().entries[0].mediaId).toBe(1);
    expect(f.store.getState().error).toBeNull(); expect(f.loaded).toHaveBeenCalledWith(expect.objectContaining({ fromCache: false }));
  });

  it('does not publish or cache malformed fresh data as an empty or successful schedule', async () => {
    const f = fixture(); f.calendar.fetchAiringSchedule.mockResolvedValueOnce([{ ...calendarEntry(), progress: -1 }]);
    await expect(f.service.loadSchedule(1)).rejects.toThrow('Invalid calendar entries');
    expect(f.store.getState().entries).toEqual([]); expect(f.cache.set).not.toHaveBeenCalled(); expect(f.loaded).not.toHaveBeenCalled();
  });

  it('copies fresh data before exposing it to store listeners and caching it', async () => {
    const f = fixture(); const source = [calendarEntry()]; f.calendar.fetchAiringSchedule.mockResolvedValue(source);
    const unsubscribe = f.store.subscribe(state => { if (state.entries.length) state.entries[0].progress = 7; });
    await f.service.loadSchedule(1); unsubscribe(); source[0].progress = 99;
    expect((await f.store.loadEntriesFromCache(1))![0].progress).toBe(10);
  });

  it('does not mask the provider failure if cache fallback also fails', async () => {
    const f = fixture(); f.calendar.fetchAiringSchedule.mockRejectedValueOnce(new Error('provider offline'));
    f.cache.get.mockRejectedValue(new Error('cache unavailable'));
    await expect(f.service.loadSchedule(1)).rejects.toThrow('provider offline');
    expect(f.store.getState().error?.message).toBe('provider offline'); expect(f.store.getState().loading).toBe(false);
  });

  it('clears loading if context initialization fails during a newer request', async () => {
    const f = fixture(); const gate = deferred<AnimeEntry[]>(); f.calendar.fetchAiringSchedule.mockReturnValueOnce(gate.promise);
    const old = f.service.loadSchedule(1); const oldRejection = expect(old).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.calendar.fetchAiringSchedule).toHaveBeenCalled());
    f.api.ensureContext.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(f.service.loadSchedule(1)).rejects.toThrow('auth unavailable'); expect(f.store.getState().loading).toBe(false);
    gate.resolve([calendarEntry()]); await oldRejection;
  });

  it('does not let an older load overwrite a newer load or its cache', async () => {
    const f = fixture(); const gate = deferred<AnimeEntry[]>(); f.calendar.fetchAiringSchedule.mockReturnValueOnce(gate.promise).mockResolvedValueOnce([calendarEntry(2)]);
    const old = f.service.loadSchedule(1, true); const oldRejection = expect(old).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.calendar.fetchAiringSchedule).toHaveBeenCalled()); await f.service.loadSchedule(1, true);
    gate.resolve([calendarEntry()]); await oldRejection;
    expect(f.store.getState().entries[0].mediaId).toBe(2); expect((await f.store.loadEntriesFromCache(1))![0].mediaId).toBe(2);
  });

  it('invalidates earlier schedule reads when a progress increment succeeds', async () => {
    const f = fixture(); f.store.setEntries([calendarEntry()]); const gate = deferred<AnimeEntry[]>();
    f.calendar.fetchAiringSchedule.mockReturnValueOnce(gate.promise);
    const old = f.service.loadSchedule(1, true); const oldRejection = expect(old).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.calendar.fetchAiringSchedule).toHaveBeenCalled()); await f.service.updateProgress(1);
    gate.resolve([calendarEntry()]); await oldRejection;
    expect(f.store.getState().entries[0].progress).toBe(11);
  });

  it('does not report an accepted increment as failed because cache clear fails', async () => {
    const f = fixture(); f.store.setEntries([calendarEntry()]); f.cache.clear.mockRejectedValueOnce(new Error('cache clear failed'));
    expect(await f.service.updateProgress(1)).toBe(11); expect(f.toast.success).toHaveBeenCalled();
  });

  it('stops an increment before sending it when context changes during initialization', async () => {
    const f = fixture(); f.store.setEntries([calendarEntry()]);
    f.api.getContext = () => ({ userId: 2, sessionId: 'two' });
    await expect(f.service.updateProgress(1)).rejects.toThrow('account changed'); expect(f.calendar.incrementProgress).not.toHaveBeenCalled();
  });
  it('invalidates a pending load and its cache after accepted progress from another view', async () => {
    const f = fixture(); f.store.setEntries([calendarEntry()]); await f.store.saveEntriesToCache([calendarEntry()], 1);
    const gate = deferred<AnimeEntry[]>(); f.calendar.fetchAiringSchedule.mockReturnValueOnce(gate.promise);
    const old = f.service.loadSchedule(1, true); const rejected = expect(old).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(f.calendar.fetchAiringSchedule).toHaveBeenCalled());
    f.bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { userId: 1, mediaId: 1, progress: 0, previousProgress: 10 });
    // CalendarModule already applies accepted progress events to the current UI.
    f.store.updateEntry(1, { progress: 0 }); gate.resolve([calendarEntry()]); await rejected;
    expect(f.store.getState().entries[0].progress).toBe(0); expect(f.store.getState().loading).toBe(false);
    expect(await f.store.loadEntriesFromCache(1)).toBeNull();
  });
  it('does not invalidate a load or cache for a progress event from another owner', async () => {
    const f = fixture(); await f.service.loadSchedule(1);
    f.bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { userId: 2, mediaId: 1, progress: 0, previousProgress: 10 });
    expect((await f.store.loadEntriesFromCache(1))![0].progress).toBe(10);
    await f.service.loadSchedule(1); expect(f.calendar.fetchAiringSchedule).toHaveBeenCalledTimes(1);
  });
});
