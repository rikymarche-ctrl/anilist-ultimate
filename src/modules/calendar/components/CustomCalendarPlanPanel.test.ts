import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomCalendarPlanPanel } from './CustomCalendarPlanPanel';
import { CalendarStore } from '../CalendarStore';
import { calendarCollection, calendarListEntry, calendarEntry } from '@/test/calendar-fixtures';
import { BackgroundOperationError } from '@core/errors/OperationFailure';

function media(id = 1, title = 'Cyberpunk: Edgerunners') {
  const entry = calendarListEntry(id);
  return { ...entry.media, title: { english: title, romaji: 'Saibāpanku', native: 'サイバーパンク' },
    status: 'FINISHED', episodes: 12, nextAiringEpisode: null, format: 'ONA', seasonYear: 2022,
    mediaListEntry: { id: entry.id, mediaId: id, userId: 1, status: 'CURRENT', progress: 2 } };
}
const panels: CustomCalendarPlanPanel[] = [];
function fixture(initialPlan = false) {
  let context = { userId: 1, sessionId: 'one' };
  const first = calendarListEntry(); first.media = { ...first.media, ...media() } as never;
  const storage = { get: vi.fn(async () => null), set: vi.fn(async () => true) };
  const api = { ensureContext: vi.fn(async () => ({ ...context })), getContext: () => context, isAuthenticated: () => true,
    query: vi.fn(async (query: string, _variables?: Record<string, unknown>): Promise<unknown> => query.includes('SearchCalendarAnime')
      ? { Page: { media: [media()] } } : calendarCollection([first])) };
  const store = new CalendarStore(storage as never, { create: () => ({}) } as never, api as never);
  const plan = { mediaId: 1, title: 'Cyberpunk', siteUrl: 'https://anilist.co/anime/1', coverImage: '',
    totalEpisodes: 12, progress: 2, dayOfWeek: 'Monday' as const, time: '20:00' };
  const changed = vi.fn(); const closed = vi.fn();
  const panel = new CustomCalendarPlanPanel({ api: api as never, store, ownerId: 1,
    ...(initialPlan ? { initialPlan: plan } : {}), onChanged: changed, onClose: closed });
  panels.push(panel);
  return { panel, api, store, storage, changed, closed, plan, changeAccount: () => { context = { userId: 2, sessionId: 'two' }; } };
}
function control<T extends HTMLElement = HTMLElement>(selector: string): T { return document.querySelector<T>(selector)!; }
function type(title: string) {
  control<HTMLInputElement>('#calendar-plan-search-input').value = title;
  control('#calendar-plan-search-input').dispatchEvent(new Event('input', { bubbles: true }));
}
function submit() { control('.calendar-plan-search').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
function searchTab() { control('[data-source="search"]').click(); }
function status() { return control('.calendar-plan-status').textContent || ''; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function settled() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

afterEach(() => { panels.splice(0).forEach(panel => panel.close()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('personal calendar picker', () => {
  it('opens on own lists and filters all title variants without further API requests', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled();
    expect(control('[data-source="lists"]').getAttribute('aria-selected')).toBe('true');
    expect(control('[data-media-id="1"]').textContent).toContain('Cyberpunk');
    type('saibapanku'); expect(document.querySelectorAll('[data-media-id]')).toHaveLength(1);
    type('サイバー'); expect(document.querySelectorAll('[data-media-id]')).toHaveLength(1);
    type('unknown'); expect(document.querySelectorAll('[data-media-id]')).toHaveLength(0);
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });
  it('debounces automatic suggestions and sends no requests for short input', async () => {
    vi.useFakeTimers(); const f = fixture(); f.panel.mount(document.body); await settled(); searchTab();
    type('C'); await vi.advanceTimersByTimeAsync(600); expect(f.api.query).toHaveBeenCalledTimes(1);
    type('Cyb'); await vi.advanceTimersByTimeAsync(300); type('Cyberp'); await vi.advanceTimersByTimeAsync(499);
    expect(f.api.query).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1);
    expect(f.api.query).toHaveBeenCalledTimes(2); expect(control('[data-media-id="1"]').textContent).toContain('Cyberpunk');
  });
  it('manual search flushes the debounce without dispatching twice', async () => {
    vi.useFakeTimers(); const f = fixture(); f.panel.mount(document.body); await settled(); searchTab(); type('Cyberp'); submit();
    await settled(); await vi.advanceTimersByTimeAsync(1000); expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('manual search refreshes cached membership after a change on AniList', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); searchTab();
    f.api.query.mockResolvedValueOnce({ Page: { media: [{ ...media(), mediaListEntry: null }] } });
    type('Cyberp'); submit(); await settled(); expect(control<HTMLButtonElement>('[data-media-id="1"]').disabled).toBe(true);
    submit(); await settled(); expect(control<HTMLButtonElement>('[data-media-id="1"]').disabled).toBe(false);
    expect(f.api.query).toHaveBeenCalledTimes(3);
  });
  it('refreshes own lists after external edits without losing the local filter', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); type('new');
    const entry = calendarListEntry(2); entry.media = { ...entry.media, ...media(2, 'New anime') } as never;
    f.api.query.mockResolvedValueOnce(calendarCollection([entry])); control('.calendar-plan-refresh').click(); await settled();
    expect(control<HTMLInputElement>('#calendar-plan-search-input').value).toBe('new');
    expect(control('[data-media-id="2"]').textContent).toContain('New anime'); expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('keeps only the latest queued search and never displays obsolete results', async () => {
    vi.useFakeTimers(); const f = fixture(); f.panel.mount(document.body); await settled(); searchTab();
    const old = deferred<unknown>(); f.api.query.mockReturnValueOnce(old.promise);
    type('old'); submit(); await settled(); type('middle'); await vi.advanceTimersByTimeAsync(500);
    type('latest'); await vi.advanceTimersByTimeAsync(500); expect(f.api.query).toHaveBeenCalledTimes(2);
    f.api.query.mockResolvedValueOnce({ Page: { media: [media(2, 'Latest title')] } });
    old.resolve({ Page: { media: [media(3, 'Obsolete title')] } }); await settled();
    expect(f.api.query).toHaveBeenCalledTimes(3); expect(f.api.query.mock.calls[2][1]).toEqual({ search: 'latest' });
    expect(document.querySelector('[data-media-id="3"]')).toBeNull(); expect(control('[data-media-id="2"]').textContent).toContain('Latest');
  });
  it('ignores a late search after switching to lists', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); searchTab();
    const old = deferred<unknown>(); f.api.query.mockReturnValueOnce(old.promise); type('late'); submit(); await settled();
    control('[data-source="lists"]').click(); old.resolve({ Page: { media: [media(2, 'Wrong tab')] } }); await settled();
    expect(document.querySelector('[data-media-id="2"]')).toBeNull(); expect(control('[data-media-id="1"]').textContent).toContain('Cyberpunk');
  });
  it('cancels pending timers on close and restores focus and scrolling', async () => {
    vi.useFakeTimers(); const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    document.body.style.overflow = 'clip'; const f = fixture(); f.panel.mount(document.body); await settled(); searchTab(); type('Cyberp');
    f.panel.close(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.api.query).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('clip'); expect(f.closed).toHaveBeenCalledTimes(1);
  });
  it('shows a useful failure and permits list retry or independent search', async () => {
    const f = fixture(); f.api.query.mockRejectedValueOnce(new BackgroundOperationError('private message', 'API_LIMIT'));
    f.panel.mount(document.body); await settled(); expect(status()).toContain('limiting requests'); expect(status()).not.toContain('private');
    control('.calendar-plan-retry').click(); await settled(); expect(control('[data-media-id="1"]')).toBeDefined();
    searchTab(); type('Cyberp'); submit(); await settled(); expect(status()).toContain('Choose an anime');
  });
  it('omits scheduled titles from search while preserving the AniList link for titles outside the active lists', async () => {
    const f = fixture(); await f.store.saveCustomPlan(1, f.plan); f.panel.mount(document.body); await settled(); searchTab();
    f.api.query.mockResolvedValueOnce({ Page: { media: [media(), { ...media(2), mediaListEntry: null },
      { ...media(3), nextAiringEpisode: { airingAt: 1791489600 } }] } });
    type('Cyberp'); submit(); await settled();
    expect(document.querySelector('[data-media-id="1"]')).toBeNull();
    expect(document.querySelector('[data-media-id="3"]')).toBeNull();
    expect(control<HTMLButtonElement>('[data-media-id="2"]').disabled).toBe(true);
    expect(control<HTMLAnchorElement>('.calendar-plan-result__link').href).toBe('https://anilist.co/anime/2');
  });
  it('omits calendar entries without upcoming airings and counts only remaining additions', async () => {
    const f = fixture(); f.store.setEntries([calendarEntry(1)]);
    const existing = calendarListEntry(1); existing.media = { ...existing.media, ...media() } as never;
    const next = calendarListEntry(2); next.media = { ...next.media, ...media(2, 'Available anime') } as never;
    const airing = calendarListEntry(3);
    f.api.query.mockResolvedValueOnce(calendarCollection([existing, next, airing]));
    f.panel.mount(document.body); await settled();
    expect([...document.querySelectorAll<HTMLElement>('[data-media-id]')].map(item => item.dataset.mediaId)).toEqual(['2']);
    expect(status()).toContain('1 anime');
    expect(document.body.textContent).not.toContain('Already on the airing calendar');
  });
  it('offers a clear empty state when every matching title is already scheduled', async () => {
    const f = fixture(); await f.store.saveCustomPlan(1, f.plan); f.panel.mount(document.body); await settled();
    expect(document.querySelectorAll('[data-media-id]')).toHaveLength(0);
    expect(status()).toContain('No more anime to add');
    expect(control('[data-edit-plan="1"]')).toBeTruthy();
    searchTab(); type('Cyberp'); submit(); await settled();
    expect(document.querySelectorAll('[data-media-id]')).toHaveLength(0);
    expect(status()).toContain('No new anime to add');
  });
  it('filters scheduled titles before applying the result limit', async () => {
    const f = fixture();
    const scheduled = Array.from({ length: 60 }, (_, index) => calendarListEntry(index + 2));
    const available = calendarListEntry(1); available.media = { ...available.media, ...media() } as never;
    f.api.query.mockResolvedValueOnce(calendarCollection([...scheduled, available])); f.panel.mount(document.body); await settled();
    expect(document.querySelectorAll('[data-media-id]')).toHaveLength(1);
    expect(control('[data-media-id="1"]')).toBeTruthy();
    expect(control('.calendar-plan-more').hidden).toBe(true);
  });
  it('selects and durably saves the weekly slot through the real store', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); control('[data-media-id="1"]').click();
    expect(control('.calendar-plan-picker').hidden).toBe(true); expect(control('.calendar-plan-editor').hidden).toBe(false);
    control<HTMLSelectElement>('[name="day"]').value = 'Friday'; control<HTMLInputElement>('[name="time"]').value = '21:30';
    control('.calendar-plan-editor').dispatchEvent(new Event('submit', { cancelable: true })); await settled();
    expect(f.store.getCustomPlans(1)[0]).toMatchObject({ mediaId: 1, dayOfWeek: 'Friday', time: '21:30' });
    expect(f.store.getState().entries[0]).toMatchObject({ mediaId: 1, calendarKind: 'personal', progress: 10 });
    expect(f.changed).toHaveBeenCalledTimes(1); expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });
  it('preserves the editor after a failed storage write and permits retry', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); control('[data-media-id="1"]').click();
    f.storage.set.mockResolvedValueOnce(false);
    control('.calendar-plan-editor').dispatchEvent(new Event('submit', { cancelable: true })); await settled();
    expect(status()).toContain('could not be saved'); expect(f.closed).not.toHaveBeenCalled();
    expect(f.store.getCustomPlans(1)).toEqual([]);
    control('.calendar-plan-editor').dispatchEvent(new Event('submit', { cancelable: true })); await settled();
    expect(f.changed).toHaveBeenCalledTimes(1);
  });
  it('returns from selection to the same filtered list', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); type('Cyber'); control('[data-media-id="1"]').click();
    control('.calendar-plan-back').click(); expect(control<HTMLInputElement>('#calendar-plan-search-input').value).toBe('Cyber');
    expect(control('.calendar-plan-editor').hidden).toBe(true); expect(f.api.query).toHaveBeenCalledTimes(1);
  });
  it('opens a saved plan directly, removes it locally and never calls an AniList mutation', async () => {
    const f = fixture(true); await f.store.saveCustomPlan(1, f.plan); f.panel.mount(document.body);
    expect(control('.calendar-plan-editor').hidden).toBe(false); expect(control('.calendar-plan-picker').hidden).toBe(true);
    control('.calendar-plan-remove').click(); await settled();
    expect(f.store.getCustomPlans(1)).toEqual([]); expect(f.store.getState().entries).toEqual([]);
    expect(f.api.query).not.toHaveBeenCalled(); expect(f.closed).toHaveBeenCalledTimes(1);
  });
  it('rejects saving a selected title after an account switch', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled(); control('[data-media-id="1"]').click(); f.changeAccount();
    control('.calendar-plan-editor').dispatchEvent(new Event('submit', { cancelable: true })); await settled();
    expect(f.storage.set).not.toHaveBeenCalled(); expect(status()).toContain('account changed');
  });
  it('supports keyboard source switching, result navigation and Escape', async () => {
    const f = fixture(); f.panel.mount(document.body); await settled();
    const input = control('#calendar-plan-search-input'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(control('[data-media-id="1"]'));
    control('[data-source="lists"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(control('[data-source="search"]').getAttribute('aria-selected')).toBe('true');
    control('[data-source="search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.closed).toHaveBeenCalledTimes(1);
  });
});
