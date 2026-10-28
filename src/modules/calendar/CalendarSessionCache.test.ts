import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarStore } from './CalendarStore';
import { CALENDAR_SESSION_TTL_MS, dispatchCalendarSessionCache } from './CalendarSessionCache';
import type { CalendarSessionCacheClient, CalendarSessionPayload } from './CalendarSessionCache';
import { calendarEntries, calendarFingerprint } from './CalendarEntries';
import { calendarEntry } from '@/test/calendar-fixtures';

const owner = { authenticated: true, userId: 1, sessionId: 'one' };
function storedPayload(queueRevision = 'r1'): CalendarSessionPayload {
  const entries = calendarEntries([calendarEntry(1)]);
  return {
    queueRevision,
    fingerprint: calendarFingerprint(entries),
    entries: JSON.parse(JSON.stringify(entries)),
  };
}

describe('calendar session cache worker protocol', () => {
  let area: Map<string, unknown>;
  beforeEach(() => {
    area = new Map();
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async (key: string) => (area.has(key) ? { [key]: area.get(key) } : {})),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.entries(items).forEach(([k, v]) => area.set(k, v));
          }),
          remove: vi.fn(async (key: string) => {
            area.delete(key);
          }),
        },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a record only to the session and viewer that wrote it', async () => {
    await dispatchCalendarSessionCache('set', storedPayload(), owner, 1000);
    expect(await dispatchCalendarSessionCache('get', null, owner, 2000)).toEqual(storedPayload());
    expect(
      await dispatchCalendarSessionCache('get', null, { ...owner, sessionId: 'two' }, 2000)
    ).toBeNull();
    expect(
      await dispatchCalendarSessionCache('get', null, { ...owner, userId: 2 }, 2000)
    ).toBeNull();
  });

  it('expires records after the TTL', async () => {
    await dispatchCalendarSessionCache('set', storedPayload(), owner, 1000);
    expect(
      await dispatchCalendarSessionCache('get', null, owner, 1000 + CALENDAR_SESSION_TTL_MS)
    ).toBeNull();
  });

  it('rejects anonymous owners and malformed payloads', async () => {
    await expect(
      dispatchCalendarSessionCache('set', storedPayload(), {
        authenticated: false,
        sessionId: 'one',
      })
    ).rejects.toThrow('owner');
    await expect(
      dispatchCalendarSessionCache(
        'set',
        { ...storedPayload(), queueRevision: 'bad revision!' },
        owner
      )
    ).rejects.toThrow('Invalid');
    await expect(dispatchCalendarSessionCache('drop', null, owner)).rejects.toThrow('Unknown');
  });

  it('clears the record', async () => {
    await dispatchCalendarSessionCache('set', storedPayload(), owner);
    await dispatchCalendarSessionCache('clear', null, owner);
    expect(area.size).toBe(0);
  });
});

describe('calendar store session fallback', () => {
  function fixture(stored: CalendarSessionPayload | null) {
    const values = new Map<string, unknown>();
    const cache = {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        values.delete(key);
      }),
      clear: vi.fn(async () => {
        values.clear();
      }),
    };
    const context = { userId: 1, sessionId: 'one' };
    const api = { ensureContext: vi.fn(async () => ({ ...context })), getContext: () => context };
    const session = {
      read: vi.fn(async () => stored),
      write: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const store = new CalendarStore(
      {} as never,
      { create: () => cache } as never,
      api as never,
      session as unknown as CalendarSessionCacheClient
    );
    return { store, session, values };
  }

  it('restores entries on a memory miss when the queue revision matches', async () => {
    const f = fixture(storedPayload('r1'));
    const entries = await f.store.loadEntriesFromCache(1, () => {}, 'r1');
    expect(entries?.map((entry) => entry.mediaId)).toEqual([1]);
    expect(entries?.[0].airingAt).toBeInstanceOf(Date);
    expect(f.values.size).toBe(1);
  });

  it('ignores a copy written at another queue revision or without one', async () => {
    const f = fixture(storedPayload('r1'));
    expect(await f.store.loadEntriesFromCache(1, () => {}, 'r2')).toBeNull();
    expect(await f.store.loadEntriesFromCache(1)).toBeNull();
  });

  it('drops a copy whose fingerprint does not match', async () => {
    const f = fixture({ ...storedPayload('r1'), fingerprint: 'tampered' });
    expect(await f.store.loadEntriesFromCache(1, () => {}, 'r1')).toBeNull();
    expect(f.session.clear).toHaveBeenCalledWith('one');
  });

  it('writes JSON entries with their revision, and full invalidation clears them', async () => {
    const f = fixture(null);
    await f.store.saveEntriesToCache([calendarEntry(1)], 1, () => {}, 'r1');
    expect(f.session.write).toHaveBeenCalledWith('one', storedPayload('r1'));
    await f.store.invalidateCache('memory');
    expect(f.session.clear).not.toHaveBeenCalled();
    await f.store.invalidateCache();
    expect(f.session.clear).toHaveBeenCalledWith('one');
  });
});
