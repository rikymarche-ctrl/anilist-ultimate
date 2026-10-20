import { describe, expect, it, vi } from 'vitest';
import { CalendarStore } from './CalendarStore';
import { calendarEntry } from '@/test/calendar-fixtures';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AnimeEntry } from '@core/types';

function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise };
}
function fixture() {
  const values = new Map<string, unknown>(); let context = { userId: 1, sessionId: 'one' };
  const cache = { get: vi.fn(async (key: string) => values.get(key)), set: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }), clear: vi.fn(async () => { values.clear(); }) };
  const api = { ensureContext: vi.fn(async () => ({ ...context })), getContext: () => context };
  const store = new CalendarStore({} as never, { create: () => cache } as never, api as never);
  return { store, cache, values, api, switchSession: (userId = 1) => { context = { userId, sessionId: `new-${userId}` }; } };
}

describe('calendar schedule cache domain and copies', () => {
  it('snapshots entries, dates and nested friends before waiting for context', async () => {
    const f = fixture(); const gate = deferred<{ userId: number; sessionId: string }>(); f.api.ensureContext.mockReturnValueOnce(gate.promise);
    const input = [calendarEntry(1, { friendActivity: [{ id: 3, status: MediaListStatus.CURRENT, progress: 4, score: 80,
      user: { id: 7, name: 'Friend', avatar: { medium: 'https://example.com/avatar.jpg' } } }] })];
    const saved = f.store.saveEntriesToCache(input, 1); input[0].progress = 99; input[0].airingAt.setFullYear(1999);
    input[0].friendActivity![0].user.name = 'Changed'; gate.resolve({ userId: 1, sessionId: 'one' }); await saved;
    const first = (await f.store.loadEntriesFromCache(1))!;
    expect(first[0].progress).toBe(10); expect(first[0].airingAt.getFullYear()).toBe(2026); expect(first[0].friendActivity![0].user.name).toBe('Friend');
    first[0].progress = 5; first[0].airingAt.setFullYear(2000); first[0].friendActivity![0].user.avatar.medium = 'changed';
    const second = (await f.store.loadEntriesFromCache(1))!;
    expect(second[0].progress).toBe(10); expect(second[0].airingAt.getFullYear()).toBe(2026); expect(second[0].friendActivity![0].user.avatar.medium).toBe('https://example.com/avatar.jpg');
  });

  it.each([
    { mediaId: 0 }, { mediaId: 2147483648 }, { episode: 0 }, { progress: -1 }, { progress: '2' },
    { airingAt: new Date(NaN) }, { title: {} }, { totalEpisodes: -1 }, { timeUntilAiring: NaN },
    { dayOfWeek: 'invalid' }, { friendActivity: {} },
  ])('rejects malformed schedule data before context/cache writes: %j', async patch => {
    const f = fixture(); await expect(f.store.saveEntriesToCache([calendarEntry(1, patch as Partial<AnimeEntry>)], 1)).rejects.toThrow('Invalid calendar entries');
    expect(f.cache.set).not.toHaveBeenCalled(); expect(f.api.ensureContext).not.toHaveBeenCalled();
  });

  it('rejects duplicate media and invalid cache owners', async () => {
    const f = fixture();
    await expect(f.store.saveEntriesToCache([calendarEntry(), calendarEntry()], 1)).rejects.toThrow();
    await expect(f.store.saveEntriesToCache([], 0)).rejects.toThrow();
    await expect(f.store.loadEntriesFromCache(1.5)).rejects.toThrow(); expect(f.cache.get).not.toHaveBeenCalled();
  });

  it('restores JSON dates and accepts an explicit empty schedule', async () => {
    const f = fixture(); await f.store.saveEntriesToCache([calendarEntry()], 1);
    const key = [...f.values.keys()][0]; f.values.set(key, JSON.parse(JSON.stringify(f.values.get(key))));
    expect((await f.store.loadEntriesFromCache(1))![0].airingAt).toBeInstanceOf(Date);
    await f.store.saveEntriesToCache([], 1); expect(await f.store.loadEntriesFromCache(1)).toEqual([]);
  });

  it('discards malformed cache values and fingerprint mismatches without throwing', async () => {
    const f = fixture(); await f.store.saveEntriesToCache([calendarEntry()], 1); const key = [...f.values.keys()][0];
    const valid = f.values.get(key) as { entries: AnimeEntry[]; fingerprint: string };
    for (const bad of [{}, { entries: {} }, { ...valid, fingerprint: 'wrong' }, { ...valid, entries: [{ ...valid.entries[0], progress: -1 }] }]) {
      f.values.set(key, bad); expect(await f.store.loadEntriesFromCache(1)).toBeNull();
    }
    expect(f.cache.delete).toHaveBeenCalledTimes(4);
  });

  it('detects changes beyond IDs and timestamps in cached payloads', async () => {
    const f = fixture(); await f.store.saveEntriesToCache([calendarEntry()], 1);
    const value = [...f.values.values()][0] as { entries: AnimeEntry[] }; value.entries[0].progress = 99;
    expect(await f.store.loadEntriesFromCache(1)).toBeNull();
  });
});

describe('calendar schedule cache concurrency and account scope', () => {
  it('isolates repeated sessions of one account and refuses another owner', async () => {
    const f = fixture(); await f.store.saveEntriesToCache([calendarEntry()], 1); f.switchSession();
    expect(await f.store.loadEntriesFromCache(1)).toBeNull(); f.switchSession(2);
    await expect(f.store.loadEntriesFromCache(1)).rejects.toThrow('account changed');
  });

  it('rejects a cache read that finishes after clear', async () => {
    const f = fixture(); await f.store.saveEntriesToCache([calendarEntry()], 1); const gate = deferred<unknown>();
    f.cache.get.mockReturnValueOnce(gate.promise); const pending = f.store.loadEntriesFromCache(1); const rejected = expect(pending).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(f.cache.get).toHaveBeenCalled()); const value = [...f.values.values()][0];
    await f.store.invalidateCache(); gate.resolve(value); await rejected;
  });

  it('removes a late write after clear and does not block later valid writes', async () => {
    const f = fixture(); const gate = deferred<void>();
    f.cache.set.mockImplementationOnce(async (key, value) => { await gate.promise; f.values.set(key, value); });
    const pending = f.store.saveEntriesToCache([calendarEntry()], 1); const rejected = expect(pending).rejects.toThrow('cache changed');
    await vi.waitFor(() => expect(f.cache.set).toHaveBeenCalled()); await f.store.invalidateCache(); gate.resolve(); await rejected;
    expect(f.values.size).toBe(0); await f.store.saveEntriesToCache([calendarEntry(2)], 1);
    expect((await f.store.loadEntriesFromCache(1))![0].mediaId).toBe(2);
  });

  it('serializes writes and recovers after a failed write', async () => {
    const f = fixture(); const gate = deferred<void>();
    f.cache.set.mockImplementationOnce(async (key, value) => { await gate.promise; f.values.set(key, value); });
    const first = f.store.saveEntriesToCache([calendarEntry(1)], 1); const second = f.store.saveEntriesToCache([calendarEntry(2)], 1);
    await vi.waitFor(() => expect(f.cache.set).toHaveBeenCalledTimes(1)); gate.resolve(); await Promise.all([first, second]);
    expect((await f.store.loadEntriesFromCache(1))![0].mediaId).toBe(2);
    f.cache.set.mockRejectedValueOnce(new Error('failed')); await expect(f.store.saveEntriesToCache([], 1)).rejects.toThrow('failed');
    await f.store.saveEntriesToCache([calendarEntry(3)], 1); expect((await f.store.loadEntriesFromCache(1))![0].mediaId).toBe(3);
  });

  it('preserves accepted write order when context initialization resolves in reverse', async () => {
    const f = fixture(); const gate = deferred<{ userId: number; sessionId: string }>();
    f.api.ensureContext.mockReturnValueOnce(gate.promise);
    const first = f.store.saveEntriesToCache([calendarEntry(1)], 1); const second = f.store.saveEntriesToCache([calendarEntry(2)], 1);
    await Promise.resolve(); await Promise.resolve(); expect(f.cache.set).not.toHaveBeenCalled();
    gate.resolve({ userId: 1, sessionId: 'one' }); await Promise.all([first, second]);
    expect((await f.store.loadEntriesFromCache(1))![0].mediaId).toBe(2);
  });

  it('does not write a superseded request waiting in the writer queue', async () => {
    const f = fixture(); let current = true; const gate = deferred<void>();
    f.cache.set.mockImplementationOnce(async (key, value) => { await gate.promise; f.values.set(key, value); });
    const first = f.store.saveEntriesToCache([calendarEntry()], 1); await vi.waitFor(() => expect(f.cache.set).toHaveBeenCalled());
    const obsolete = f.store.saveEntriesToCache([calendarEntry(2)], 1, () => { if (!current) throw new Error('superseded'); });
    const rejected = expect(obsolete).rejects.toThrow('superseded'); current = false; gate.resolve(); await first; await rejected;
    expect(f.cache.set).toHaveBeenCalledTimes(1);
  });
});
