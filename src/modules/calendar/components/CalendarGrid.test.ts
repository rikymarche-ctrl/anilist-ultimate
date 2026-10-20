import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { CalendarStore } from '../CalendarStore';
import { CalendarGrid } from './CalendarGrid';
import { DayColumn } from './DayColumn';
import { CalendarDataService } from '../services/CalendarDataService';
import { EventBus } from '@core/events/EventBus';
import type { AnimeEntry } from '@core/types';
import { AnimeCard } from './AnimeCard';
import { SocialRenderer } from '@modules/social/SocialRenderer';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { calendarEntry } from '@/test/calendar-fixtures';
import type { CalendarPreferences, CardOptions } from '@core/types';

const grids: CalendarGrid[] = [];
function fixture(preferences: Partial<CalendarPreferences> = {}) {
  const store = new CalendarStore({} as never, { create: () => ({}) } as never);
  store.setState({ entries: [calendarEntry(1), calendarEntry(2), calendarEntry(3)],
    preferences: { ...DEFAULT_CALENDAR_PREFERENCES, hideEmptyDays: true, socialEnabled: false, maxCardsPerDay: 1, ...preferences } });
  const scope = container.createChildContainer();
  scope.register(TOKENS.ComponentScope, { useFactory: child => child });
  scope.registerInstance(TOKENS.CalendarStore, store);
  scope.registerInstance(TOKENS.ApiClient, { getContext: () => ({ userId: 1, sessionId: 'one' }) });
  scope.registerInstance(TOKENS.CalendarService, { hasAired: () => false, isAiringSoon: () => false,
    formatAiringTime: () => '20:00', formatTimeUntilAiring: () => 'remaining' });
  scope.registerInstance(SocialRenderer, { attachPortal: () => new AbortController() } as never);
  scope.registerInstance(AstraRatingModal, { open: async () => {} } as never);
  const mark = vi.fn(async () => {});
  scope.registerInstance('CalendarGridProps', { astraEnabled: true, onMarkWatched: mark });
  let subscriptions = 0;
  const subscribe = store.subscribe.bind(store);
  vi.spyOn(store, 'subscribe').mockImplementation(listener => {
    subscriptions++; const stop = subscribe(listener); let active = true;
    return () => { if (active) { active = false; subscriptions--; } stop(); };
  });
  const grid = scope.resolve(CalendarGrid); grids.push(grid);
  return { grid, store, scope, mark, subscriptions: () => subscriptions };
}
function cards(grid: CalendarGrid) { return [...grid.getElement().querySelectorAll<HTMLElement>('.anime-card[data-media-id]')]; }
function toggle(grid: CalendarGrid) { return grid.getElement().querySelector<HTMLButtonElement>('.calendar-day-column__toggle')!; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00')); history.replaceState({}, '', '/home'); });
afterEach(() => { for (const grid of grids.splice(0)) grid.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('calendar grid ownership and mounted children', () => {
  it('does not mount cards or subscribe merely by constructing a grid', () => {
    const f = fixture(); expect(f.subscriptions()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('resolves and mounts real cards in the received child scope and cleans all children', () => {
    const f = fixture(); f.grid.mount(document.body);
    expect(cards(f.grid)).toHaveLength(3); expect(f.grid.getElement().querySelector('.anime-card-error-placeholder')).toBeNull();
    expect(f.subscriptions()).toBe(4); expect(vi.getTimerCount()).toBe(1);
    f.grid.unmount(); expect(f.subscriptions()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('expands and collapses overflow cards with the mounted column handler', () => {
    const f = fixture(); f.grid.mount(document.body); expect(cards(f.grid).filter(card => !card.classList.contains('anime-card--hidden'))).toHaveLength(1);
    toggle(f.grid).click(); expect(f.store.getState().expandedDays.has('Thursday')).toBe(true);
    expect(cards(f.grid).filter(card => !card.classList.contains('anime-card--hidden'))).toHaveLength(3); expect(toggle(f.grid).getAttribute('aria-expanded')).toBe('true');
    toggle(f.grid).click(); expect(cards(f.grid).filter(card => !card.classList.contains('anime-card--hidden'))).toHaveLength(1);
  });
  it('keeps one subscription per mounted component and one timer through repeated refreshes', () => {
    const f = fixture(); f.grid.mount(document.body);
    for (let i = 0; i < 5; i++) f.grid.refresh();
    expect(f.subscriptions()).toBe(4); expect(vi.getTimerCount()).toBe(1);
    f.grid.unmount(); expect(f.subscriptions()).toBe(0);
  });
  it('does not stop another grid countdown when the first grid unmounts', () => {
    const f = fixture({ timeFormat: 'countdown' });
    const second = f.scope.resolve(CalendarGrid); grids.push(second);
    f.grid.mount(document.body); second.mount(document.body); expect(vi.getTimerCount()).toBe(2);
    f.grid.unmount(); expect(vi.getTimerCount()).toBe(1);
  });
  it('renders the current store snapshot when mounting after construction and after reopening', () => {
    const f = fixture(); f.store.setEntries([calendarEntry(4)]); f.grid.mount(document.body);
    expect(cards(f.grid).map(card => card.dataset.mediaId)).toEqual(['4']);
    f.grid.unmount(); f.store.setEntries([calendarEntry(5)]); f.grid.mount(document.body);
    expect(cards(f.grid).map(card => card.dataset.mediaId)).toEqual(['5']); expect(f.subscriptions()).toBe(2);
  });
  it('leaves old controls inert after refresh and after unmount', () => {
    const f = fixture(); f.grid.mount(document.body); const oldToggle = toggle(f.grid);
    f.grid.refresh(); oldToggle.click(); expect(f.store.getState().expandedDays.size).toBe(0);
    const current = toggle(f.grid); f.grid.unmount(); current.click(); expect(f.store.getState().expandedDays.size).toBe(0);
  });
  it('retains live card elements and pending actions during progress-only updates', async () => {
    const f = fixture(); f.grid.mount(document.body); const roots = cards(f.grid);
    let finish!: () => void; f.mark.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    roots[0].querySelector<HTMLButtonElement>('[data-action="mark-watched"]')!.click();
    f.store.updateEntry(1, { progress: 11 });
    expect(cards(f.grid)).toEqual(roots); roots[0].querySelector<HTMLButtonElement>('[data-action="mark-watched"]')!.click();
    expect(f.mark).toHaveBeenCalledTimes(1); finish(); await Promise.resolve(); await Promise.resolve();
    expect(f.subscriptions()).toBe(4);
  });
  it('removes the old child resources when entries become empty or skeleton replaces them', () => {
    const f = fixture({ showEmptyToday: false }); f.grid.mount(document.body); f.store.setEntries([]);
    expect(f.grid.getElement().classList.contains('calendar-grid__empty')).toBe(true); expect(f.subscriptions()).toBe(1);
    f.store.setLoading(true); expect(cards(f.grid)).toHaveLength(0); expect(f.subscriptions()).toBe(1);
  });
  it('recomputes today and the date header after midnight without accumulating timers', () => {
    const f = fixture({ hideEmptyDays: false, startDay: 'today' }); f.grid.mount(document.body);
    expect(f.grid.getElement().querySelector<HTMLElement>('[data-day]')?.dataset.day).toBe('Thursday');
    vi.setSystemTime(new Date('2026-10-09T00:01:00')); vi.advanceTimersByTime(60000);
    expect(f.grid.getElement().querySelector<HTMLElement>('[data-day]')?.dataset.day).toBe('Friday');
    expect(f.grid.getElement().querySelector('.calendar-day-column--today .calendar-day-column__day-number')?.textContent).toBe('9');
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('day column lifecycle', () => {
  it('constructs children only at mount, cleans them and creates one fresh set on remount', () => {
    const f = fixture(); const options: CardOptions = { ...DEFAULT_CALENDAR_PREFERENCES, astraEnabled: false, onMarkWatched: f.mark };
    f.scope.registerInstance('DayColumnProps', { day: 'Thursday', entries: [calendarEntry()], cardOptions: options });
    const column = f.scope.resolve(DayColumn);
    expect(f.subscriptions()).toBe(0); column.mount(document.body); expect(f.subscriptions()).toBe(1);
    column.unmount(); expect(f.subscriptions()).toBe(0); column.mount(document.body);
    expect(column.getElement().querySelectorAll('.anime-card')).toHaveLength(1); column.unmount();
  });
  it('renders a direct caller day as literal text rather than new HTML', () => {
    const f = fixture(); f.scope.registerInstance('DayColumnProps', { day: '<img src=x onerror=alert(1)>', entries: [], cardOptions: { ...DEFAULT_CALENDAR_PREFERENCES, astraEnabled: false } });
    const column = f.scope.resolve(DayColumn);
    expect(column.getElement().querySelector('.calendar-day-column__day-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(column.getElement().querySelector('img')).toBeNull();
  });
  it('isolates a failed card without leaving its neighbors or column unusable', () => {
    const f = fixture(); const resolve = f.scope.resolve.bind(f.scope);
    const cardFactory = vi.spyOn(AnimeCard.prototype, 'mount'); cardFactory.mockImplementationOnce(() => { throw new Error('Synthetic mount error'); });
    f.scope.registerInstance('DayColumnProps', { day: 'Thursday', entries: [calendarEntry(), calendarEntry(2)], cardOptions: { ...DEFAULT_CALENDAR_PREFERENCES, maxCardsPerDay: 1, astraEnabled: false } });
    const column = resolve(DayColumn); column.mount(document.body);
    expect(column.getElement().querySelectorAll('.anime-card')).toHaveLength(1);
    expect(column.getElement().querySelectorAll('.anime-card-error-placeholder')).toHaveLength(1);
    column.unmount(); expect(f.subscriptions()).toBe(0);
  });
});

describe('calendar grid updates and errors', () => {
  it('updates card callbacks without rebuilding live cards', async () => {
    const f = fixture(); f.grid.mount(document.body); const roots = cards(f.grid); const newer = vi.fn(async () => {});
    f.grid.update({ onMarkWatched: newer }); roots[0].querySelector<HTMLButtonElement>('[data-action="mark-watched"]')!.click();
    expect(newer).toHaveBeenCalledTimes(1); expect(f.mark).not.toHaveBeenCalled(); expect(cards(f.grid)).toEqual(roots);
    await Promise.resolve();
  });
  it('cleans removed cards and rebuilds a column when its membership changes', () => {
    const f = fixture(); f.grid.mount(document.body); const roots = cards(f.grid);
    f.store.setEntries([calendarEntry(3)]); expect(cards(f.grid).map(card => card.dataset.mediaId)).toEqual(['3']);
    roots[0].querySelector<HTMLButtonElement>('[data-action="mark-watched"]')!.click();
    expect(f.mark).not.toHaveBeenCalled(); expect(f.subscriptions()).toBe(2);
  });
  it('applies unlimited and layout preferences without accumulating child resources', () => {
    const f = fixture(); f.grid.mount(document.body);
    f.store.setState({ preferences: { ...f.store.getState().preferences, maxCardsPerDay: 0, layoutMode: 'compact' } });
    expect(toggle(f.grid)).toBeNull(); expect(cards(f.grid).every(card => !card.classList.contains('anime-card--hidden') && card.classList.contains('anime-card--compact'))).toBe(true);
    expect(f.subscriptions()).toBe(4); expect(vi.getTimerCount()).toBe(1);
  });
  it('does not update externally detached roots or revive them from store/timer callbacks', () => {
    const f = fixture(); f.grid.mount(document.body); const root = f.grid.getElement(); root.remove();
    f.store.updateEntry(1, { progress: 0 }); vi.advanceTimersByTime(60000);
    expect(f.grid.getElement()).toBe(root); expect(root.isConnected).toBe(false);
    f.grid.unmount(); expect(f.subscriptions()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not mount partially prepared columns on an error root and retries only the current root', () => {
    const f = fixture(); f.store.setEntries([calendarEntry(), calendarEntry(2, { airingAt: new Date('2026-10-09T12:00:00') })]);
    let fail = true;
    f.scope.register(DayColumn, { useFactory: child => {
      const props = child.resolve<ConstructorParameters<typeof DayColumn>[0]>('DayColumnProps');
      if (fail && props.day === 'Friday') throw new Error('Synthetic column failure');
      return new DayColumn(props, f.store, child);
    } });
    f.grid.mount(document.body); const oldRetry = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    expect(f.grid.getElement().classList.contains('calendar-grid__error')).toBe(true); expect(f.subscriptions()).toBe(1);
    fail = false; oldRetry.click(); expect(cards(f.grid)).toHaveLength(2); expect(f.subscriptions()).toBe(3);
    oldRetry.click(); expect(f.subscriptions()).toBe(3);
  });
});


describe('calendar provider failure feedback', () => {
  it('renders provider errors instead of claiming the calendar is empty, without exposing provider details', () => {
    const f = fixture({ showEmptyToday: false }); f.store.setEntries([]); f.grid.mount(document.body);
    f.store.setError(new Error('<img src=x onerror=alert(1)> secret diagnostic'));
    expect(f.grid.getElement().classList.contains('calendar-grid__error')).toBe(true);
    expect(f.grid.getElement().querySelector('[role="alert"]')).not.toBeNull();
    expect(f.grid.getElement().textContent).toContain('Unable to load calendar');
    expect(f.grid.getElement().textContent).not.toContain('secret diagnostic');
    expect(f.grid.getElement().querySelector('img')).toBeNull();
    expect(f.grid.getElement().querySelector('.calendar-grid__empty')).toBeNull();
  });
  it('preserves existing cards and pending actions while showing and clearing a failed refresh', () => {
    const f = fixture(); f.grid.mount(document.body); const roots = cards(f.grid);
    f.store.setError(new Error('provider offline'));
    expect(cards(f.grid)).toEqual(roots); expect(f.grid.getElement().querySelector('[role="alert"]')).not.toBeNull();
    f.store.clearError(); expect(cards(f.grid)).toEqual(roots);
    expect(f.grid.getElement().querySelector('[role="alert"]')).toBeNull(); expect(f.subscriptions()).toBe(4);
  });
  it('does not offer a provider retry when no data loader is connected', () => {
    const f = fixture(); f.store.setEntries([]); f.store.setError(new Error('offline')); f.grid.mount(document.body);
    expect(f.grid.getElement().querySelector('.calendar-grid__retry-btn')).toBeNull();
  });
  it('calls the connected loader once while pending and permits a later retry after failure', async () => {
    const f = fixture(); f.store.setEntries([]); f.store.setError(new Error('offline'));
    let reject!: (error: Error) => void; const retry = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    f.grid.update({ onRetry: retry }); f.grid.mount(document.body);
    const button = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    button.click(); button.click(); await Promise.resolve(); expect(retry).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
    reject(new Error('retry failed')); await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click(); await Promise.resolve(); expect(retry).toHaveBeenCalledTimes(2);
    reject(new Error('retry failed again')); await vi.waitFor(() => expect(button.disabled).toBe(false));
  });
  it('keeps a retry locked across refresh and leaves replaced or unmounted buttons inert', async () => {
    const f = fixture(); f.store.setError(new Error('offline')); let finish!: () => void;
    const retry = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    f.grid.update({ onRetry: retry }); f.grid.mount(document.body);
    const old = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    old.click(); await Promise.resolve(); f.grid.refresh(); old.click();
    const current = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    current.click(); expect(current.disabled).toBe(true); expect(retry).toHaveBeenCalledTimes(1);
    f.grid.unmount(); current.click(); finish(); await Promise.resolve(); await Promise.resolve();
    expect(retry).toHaveBeenCalledTimes(1); expect(f.subscriptions()).toBe(0);
  });
  it('uses the latest retry callback and disables it during a provider load', async () => {
    const f = fixture(); f.store.setError(new Error('offline')); const old = vi.fn(async () => {}); const next = vi.fn(async () => {});
    f.grid.update({ onRetry: old }); f.grid.mount(document.body); f.grid.update({ onRetry: next });
    f.store.setLoading(true); const button = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    expect(button.disabled).toBe(true); button.click(); await Promise.resolve(); expect(next).not.toHaveBeenCalled();
    f.store.setLoading(false); button.click(); await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(old).not.toHaveBeenCalled();
  });
  it('publishes showError into the store so refresh cannot erase failure feedback', () => {
    const f = fixture(); f.grid.mount(document.body); f.grid.showError('provider offline'); f.grid.refresh();
    expect(f.store.getState().error?.message).toBe('provider offline');
    expect(f.grid.getElement().querySelector('[role="alert"]')).not.toBeNull();
  });
});


describe('calendar provider recovery with the real data service', () => {
  function connected() {
    const f = fixture({ showEmptyToday: false }); f.store.setEntries([]);
    const api = { getContext: () => ({ userId: 1, sessionId: 'one' }), ensureContext: async () => ({ userId: 1, sessionId: 'one' }) };
    const provider = { fetchAiringSchedule: vi.fn(async (): Promise<AnimeEntry[]> => [calendarEntry()]) };
    const data = new CalendarDataService(new EventBus(), provider as never, {} as never, f.store, api as never);
    f.grid.update({ onRetry: () => data.loadSchedule(1, true) }); f.grid.mount(document.body);
    return { ...f, data, provider };
  }
  it('recovers from a provider failure via a genuine fetch and publishes the returned cards', async () => {
    const f = connected(); f.provider.fetchAiringSchedule.mockRejectedValueOnce(new Error('offline'));
    await expect(f.data.loadSchedule(1, true)).rejects.toThrow('offline');
    let finish!: (entries: AnimeEntry[]) => void;
    f.provider.fetchAiringSchedule.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const button = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    button.focus(); button.click(); button.click();
    await vi.waitFor(() => expect(f.provider.fetchAiringSchedule).toHaveBeenCalledTimes(2));
    expect(button.disabled).toBe(true); expect(f.grid.getElement().querySelector('.calendar-grid__retry-btn')).toBe(button);
    finish([calendarEntry(9)]); await vi.waitFor(() => expect(cards(f.grid).map(card => card.dataset.mediaId)).toEqual(['9']));
    expect(f.grid.getElement().querySelector('[role="alert"]')).toBeNull(); expect(f.store.getState().error).toBeNull();
  });
  it('keeps failure feedback through repeated failures and only shows empty after a confirmed empty result', async () => {
    const f = connected(); f.provider.fetchAiringSchedule.mockRejectedValue(new Error('offline'));
    await expect(f.data.loadSchedule(1, true)).rejects.toThrow('offline');
    const button = f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!; button.click();
    await vi.waitFor(() => expect(f.provider.fetchAiringSchedule).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(f.grid.getElement().querySelector('[role="alert"]')).not.toBeNull();
    f.provider.fetchAiringSchedule.mockResolvedValueOnce([]); button.click();
    await vi.waitFor(() => expect(f.grid.getElement().classList.contains('calendar-grid__empty')).toBe(true));
    expect(f.store.getState().error).toBeNull(); expect(f.provider.fetchAiringSchedule).toHaveBeenCalledTimes(3);
  });
  it('preserves loaded cards during a failed refresh and removes feedback on successful recovery', async () => {
    const f = connected(); await f.data.loadSchedule(1, true); const roots = cards(f.grid);
    f.provider.fetchAiringSchedule.mockRejectedValueOnce(new Error('offline'));
    await expect(f.data.loadSchedule(1, true)).rejects.toThrow('offline');
    expect(cards(f.grid)).toEqual(roots); expect(f.grid.getElement().textContent).toContain('Previously loaded episodes');
    f.grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!.click();
    await vi.waitFor(() => expect(f.store.getState().error).toBeNull());
    expect(cards(f.grid)).toEqual(roots); expect(f.provider.fetchAiringSchedule).toHaveBeenCalledTimes(3);
  });
});
