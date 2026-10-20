import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarStore } from './CalendarStore';
import { DEFAULT_CALENDAR_PREFERENCES, STORAGE_KEYS, STORAGE_PREFIX } from '@core/constants';
import type { CalendarCustomPlan, CalendarPreferences } from '@core/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Storage fake whose reads return the last committed value, as chrome.storage does. */
function fixture(stored: unknown = null) {
  let data: unknown = stored;
  const commit = (value: unknown) => { data = JSON.parse(JSON.stringify(value)); };
  const storage = { get: vi.fn(async (): Promise<unknown> => data), set: vi.fn(async (_key: string, value: unknown): Promise<boolean> => { commit(value); return true; }) };
  const store = new CalendarStore(storage as never, { create: () => ({}) } as never);
  return { store, storage, commit };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('calendar cross-tab writes', () => {
  /** Two tabs share one storage backend; each keeps its own in-memory store. */
  function twoTabs() {
    const data = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string): Promise<unknown> => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null)),
      set: vi.fn(async (key: string, value: unknown): Promise<boolean> => { data.set(key, JSON.parse(JSON.stringify(value))); return true; }),
    };
    const make = () => new CalendarStore(storage as never, { create: () => ({}) } as never);
    return { data, tabA: make(), tabB: make() };
  }
  const planKey = `${STORAGE_PREFIX}calendar_custom_7`;
  const plan = (mediaId: number, progress = 0): CalendarCustomPlan => ({ mediaId, title: `Plan ${mediaId}`, coverImage: '',
    siteUrl: `https://anilist.co/anime/${mediaId}`, totalEpisodes: 12, progress, dayOfWeek: 'Monday', time: '20:00' });
  const storedIds = (data: Map<string, unknown>) => (data.get(planKey) as CalendarCustomPlan[]).map(item => item.mediaId).sort();

  it('keeps plans another tab saved when this tab adds or removes a plan', async () => {
    const { data, tabA, tabB } = twoTabs();
    await tabA.loadCustomPlans(7); await tabB.loadCustomPlans(7);
    await tabB.saveCustomPlan(7, plan(2));
    await tabA.saveCustomPlan(7, plan(1));
    expect(storedIds(data)).toEqual([1, 2]);
    expect(tabA.getCustomPlans(7).map(item => item.mediaId).sort()).toEqual([1, 2]);
    await tabB.removeCustomPlan(7, 2);
    expect(storedIds(data)).toEqual([1]);
  });

  it('applies a progress change to the stored plan list without reverting another tab plan', async () => {
    const { data, tabA, tabB } = twoTabs();
    await tabA.loadCustomPlans(7); await tabA.saveCustomPlan(7, plan(1));
    await tabB.loadCustomPlans(7); await tabB.saveCustomPlan(7, plan(2));
    tabA.updateEntry(1, { progress: 5 });
    await vi.waitFor(() => expect(data.get(planKey)).toEqual([expect.objectContaining({ mediaId: 1, progress: 5 }),
      expect.objectContaining({ mediaId: 2, progress: 0 })]));
  });

  it('merges a preference patch over the stored record instead of this tab snapshot', async () => {
    const { data, tabA, tabB } = twoTabs();
    await tabA.init(); await tabB.init();
    await tabA.savePreferences({ showTime: false });
    await tabB.savePreferences({ layoutMode: 'compact' });
    expect(data.get(STORAGE_KEYS.CALENDAR_PREFS)).toMatchObject({ showTime: false, layoutMode: 'compact' });
    expect(tabB.getState().preferences).toMatchObject({ showTime: false, layoutMode: 'compact' });
  });
});

describe('calendar preference persistence', () => {
  it('loads valid legacy values while ignoring malformed and unknown fields', async () => {
    const f = fixture(JSON.parse('{"layoutMode":"compact","startDay":"today","showTime":"false","maxCardsPerDay":-1,"other":true,"__proto__":{"bad":true}}'));
    await f.store.init();
    expect(f.store.getState().preferences).toEqual({ ...DEFAULT_CALENDAR_PREFERENCES, layoutMode: 'compact', startDay: 'today' });
    expect(f.storage.set).not.toHaveBeenCalled();
  });

  it('retries a failed initial read and does not write over unread preferences', async () => {
    const f = fixture({ layoutMode: 'compact' });
    f.storage.get.mockRejectedValueOnce(new Error('read failed'));
    await expect(f.store.savePreferences({ showTime: false })).rejects.toThrow('read failed');
    expect(f.storage.set).not.toHaveBeenCalled();
    await f.store.savePreferences({ showTime: false });
    expect(f.store.getState().preferences).toMatchObject({ layoutMode: 'compact', showTime: false });
    // Init read, then the write-time re-read of the stored record.
    expect(f.storage.get).toHaveBeenCalledTimes(3);
  });

  it('shares initialization and snapshots a patch before a pending read finishes', async () => {
    const f = fixture({ layoutMode: 'extended' }); const read = deferred<unknown>();
    f.storage.get.mockReturnValueOnce(read.promise);
    const init = f.store.init(); const patch = { showTime: false };
    const saving = f.store.savePreferences(patch); patch.showTime = true;
    expect(f.storage.set).not.toHaveBeenCalled();
    read.resolve({ layoutMode: 'extended' }); await init; await saving;
    // One shared init read plus the save's write-time re-read.
    expect(f.storage.get).toHaveBeenCalledTimes(2);
    expect(f.store.getState().preferences).toMatchObject({ layoutMode: 'extended', showTime: false });
  });

  it('serializes rapid edits and commits only after storage succeeds', async () => {
    const f = fixture(); await f.store.init(); const first = deferred<boolean>();
    f.storage.set.mockImplementationOnce(async (_key: string, value: unknown) => { const ok = await first.promise; if (ok) f.commit(value); return ok; });
    const a = f.store.savePreferences({ showTime: false });
    const b = f.store.savePreferences({ layoutMode: 'compact' });
    await vi.waitFor(() => expect(f.storage.set).toHaveBeenCalledTimes(1));
    expect(f.store.getState().preferences.showTime).toBe(true);
    first.resolve(true); await Promise.all([a, b]);
    expect(f.storage.set).toHaveBeenLastCalledWith(STORAGE_KEYS.CALENDAR_PREFS, expect.objectContaining({ showTime: false, layoutMode: 'compact' }));
    expect(f.store.getState().preferences).toMatchObject({ showTime: false, layoutMode: 'compact' });
  });

  it.each(['reject', 'false'])('reports %s storage failures and continues without committing failed fields', async (failure) => {
    const f = fixture(); await f.store.init();
    if (failure === 'reject') f.storage.set.mockRejectedValueOnce(new Error('disk failed'));
    else f.storage.set.mockResolvedValueOnce(false);
    const a = f.store.savePreferences({ showTime: false });
    const rejection = expect(a).rejects.toThrow();
    const b = f.store.savePreferences({ layoutMode: 'compact' });
    await rejection; await b;
    expect(f.store.getState().preferences).toMatchObject({ showTime: true, layoutMode: 'compact' });
    expect(f.storage.set).toHaveBeenLastCalledWith(STORAGE_KEYS.CALENDAR_PREFS, expect.objectContaining({ showTime: true, layoutMode: 'compact' }));
  });

  it.each([{ maxCardsPerDay: NaN }, { maxCardsPerDay: 1.5 }, { showTime: 'false' }, { layoutMode: 'invalid' }, { unexpected: true }])('rejects malformed patches without state or storage changes: %j', async (patch) => {
    const f = fixture();
    await expect(f.store.savePreferences(patch as Partial<CalendarPreferences>)).rejects.toThrow();
    expect(f.store.getState().preferences).toEqual(DEFAULT_CALENDAR_PREFERENCES);
    expect(f.storage.set).not.toHaveBeenCalled();
  });

  it('orders reset after accepted edits and allows a later edit after reset', async () => {
    const f = fixture({ layoutMode: 'compact' }); await f.store.init(); const first = deferred<boolean>();
    f.storage.set.mockReturnValueOnce(first.promise);
    const a = f.store.savePreferences({ showTime: false });
    const resetting = f.store.resetPreferences();
    const b = f.store.savePreferences({ maxCardsPerDay: 7 });
    first.resolve(true); await Promise.all([a, resetting, b]);
    expect(f.store.getState().preferences).toEqual({ ...DEFAULT_CALENDAR_PREFERENCES, maxCardsPerDay: 7 });
    expect(f.storage.set).toHaveBeenCalledTimes(3);
  });

  it('publishes the preference event only for durable commits, including reset', async () => {
    const f = fixture(); const event = vi.fn(); window.addEventListener('calendar-preferences-updated', event);
    try {
      await f.store.init(); const pending = deferred<boolean>(); f.storage.set.mockReturnValueOnce(pending.promise);
      const saving = f.store.savePreferences({ showTime: false });
      expect(event).not.toHaveBeenCalled(); pending.resolve(true); await saving;
      expect(event).toHaveBeenCalledTimes(1);
      f.storage.set.mockRejectedValueOnce(new Error('failed')); await expect(f.store.savePreferences({ showTime: true })).rejects.toThrow();
      expect(event).toHaveBeenCalledTimes(1);
      await f.store.resetPreferences(); expect(event).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('calendar-preferences-updated', event); }
  });
});
