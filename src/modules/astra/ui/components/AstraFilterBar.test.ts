import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraFilterBar } from './AstraFilterBar';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { IDashboardState } from '../../interfaces/IDashboardState';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { MediaListStatus } from '@/api/AnilistTypes';

const bars: AstraFilterBar[] = [];
afterEach(() => { bars.splice(0).forEach(bar => bar.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let context: ApiContext = { userId: 7, sessionId: 'session-A' };
  const bus = new EventBus();
  const api = { getContext: () => ({ ...context }), ensureContext: async () => ({ ...context }) } as IApiClient;
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    filteredWorks: [], stats: { totalCount: 0, averageScore: 0, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const store = { getState: () => state, setFilters: vi.fn(), setSearch: vi.fn(), setSort: vi.fn() };
  const service = { getWorks: () => [], getAniListCustomLists: vi.fn(async () => ['Current list']) };
  // Exercise the injected capabilities used by the composition root.
  const bar = new AstraFilterBar(store as never, service as never, bus, api);
  bars.push(bar);
  return { bar, bus, store, service, state, api, mount: () => bar.mount(document.body, state), change: (sessionId: string, userId = 7, emit = true) => {
    context = { userId, sessionId };
    if (emit) bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId, timestamp: new Date() });
  } };
}

describe('Astra filter toolbar account and mount lifecycle', () => {
  it('renders freshly fetched list names without needing an unrelated store update', async () => {
    const f = fixture(); f.mount(); await settle();
    expect(f.bar.getElement().textContent).toContain('Current list');
    expect(f.service.getAniListCustomLists).toHaveBeenCalledOnce();
  });
  it('reloads the list names for a different account and same-owner relogin', async () => {
    const f = fixture(); f.mount(); await settle();
    f.service.getAniListCustomLists.mockResolvedValue(['Account B list']); f.change('session-B', 8); await settle();
    expect(f.bar.getElement().textContent).toContain('Account B list');
    expect(f.bar.getElement().textContent).not.toContain('Current list');
    f.service.getAniListCustomLists.mockResolvedValue(['Relogin list']); f.change('session-C', 8); await settle();
    expect(f.bar.getElement().textContent).toContain('Relogin list');
    expect(f.service.getAniListCustomLists).toHaveBeenCalledTimes(3);
  });
  it('detects a silent session change when remounting without an auth event', async () => {
    const f = fixture(); f.mount(); await settle(); f.bar.unmount();
    f.service.getAniListCustomLists.mockResolvedValue(['New session list']); f.change('session-B', 7, false); f.mount(); await settle();
    expect(f.bar.getElement().textContent).toContain('New session list');
    expect(f.bar.getElement().textContent).not.toContain('Current list');
  });
  it('retires a held list fetch across unmount/remount', async () => {
    const f = fixture(); const old = deferred<string[]>();
    f.service.getAniListCustomLists.mockReturnValueOnce(old.promise); f.mount(); await settle(); f.bar.unmount();
    f.service.getAniListCustomLists.mockResolvedValue(['New mount list']); f.mount(); await settle(); old.resolve(['Old mount secret']); await settle();
    expect(f.bar.getElement().textContent).toContain('New mount list');
    expect(f.bar.getElement().textContent).not.toContain('Old mount secret');
  });
  it('retires a held list fetch on a silent same-owner relogin', async () => {
    const f = fixture(); const old = deferred<string[]>();
    f.service.getAniListCustomLists.mockReturnValueOnce(old.promise); f.mount(); await settle();
    f.change('session-B', 7, false); old.resolve(['Old session secret']); await settle();
    expect(f.bar.getElement().textContent).not.toContain('Old session secret');
    f.bar.rerender(); await settle(); expect(f.bar.getElement().textContent).toContain('Current list');
  });
  it('leaves failed loads retryable on a later mount', async () => {
    const f = fixture(); f.service.getAniListCustomLists.mockRejectedValueOnce(new Error('Temporary provider failure'));
    f.mount(); await settle(); f.bar.unmount(); f.mount(); await settle();
    expect(f.service.getAniListCustomLists).toHaveBeenCalledTimes(2);
    expect(f.bar.getElement().textContent).toContain('Current list');
  });
  it('does not rerender a replacement mount when old list fetch completes', async () => {
    const f = fixture(); const old = deferred<string[]>();
    f.service.getAniListCustomLists.mockReturnValueOnce(old.promise); f.mount(); await settle();
    f.bar.unmount(); f.mount(); await settle(); const current = f.bar.getElement(); old.resolve(['Old mount list']); await settle();
    expect(f.bar.getElement()).toBe(current);
  });
  it('does not let old list fetch failure alter the current account toolbar', async () => {
    const f = fixture(); const old = deferred<string[]>();
    f.service.getAniListCustomLists.mockReturnValueOnce(old.promise); f.mount(); await settle();
    f.service.getAniListCustomLists.mockResolvedValue(['Account B list']); f.change('session-B', 8); await settle();
    const current = f.bar.getElement(); old.reject(new Error('Old storage failure')); await settle();
    expect(f.bar.getElement()).toBe(current);
    expect(current.textContent).toContain('Account B list');
  });
  it('releases auth subscriptions and makes removed controls inert', async () => {
    const f = fixture(); f.mount(); await settle();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    const old = f.bar.getElement().querySelector<HTMLButtonElement>('[data-filter-value="__private__"]')!;
    f.change('session-B'); await settle(); old.click(); expect(f.store.setFilters).not.toHaveBeenCalled();
    f.bar.unmount(); expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    const calls = f.service.getAniListCustomLists.mock.calls.length; f.change('session-C'); await settle();
    expect(f.service.getAniListCustomLists).toHaveBeenCalledTimes(calls);
  });
  it('makes a copied former auth callback inert after rerender', async () => {
    const f = fixture(); const on = vi.spyOn(f.bus, 'on'); f.mount(); await settle();
    const old = on.mock.calls.find(call => call[0] === EVENT_TYPES.AUTH_STATE_CHANGED)![1];
    f.bar.rerender(); await settle(); const current = f.bar.getElement();
    old({ isAuthenticated: true, userId: 7, timestamp: new Date() }); await settle();
    expect(f.bar.getElement()).toBe(current);
    expect(f.service.getAniListCustomLists).toHaveBeenCalledOnce();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
  });
  it('resolves the bus and account context through the real DI container', async () => {
    const f = fixture(); const scope = container.createChildContainer();
    scope.registerInstance(TOKENS.AstraStore, f.store);
    scope.registerInstance(TOKENS.AstraService, f.service);
    scope.registerInstance(TOKENS.EventBus, f.bus);
    scope.registerInstance(TOKENS.ApiClient, f.api);
    const bar = scope.resolve(AstraFilterBar); bars.push(bar); bar.mount(document.body, f.state); await settle();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    f.service.getAniListCustomLists.mockResolvedValue(['DI account list']); f.change('session-B', 8); await settle();
    expect(bar.getElement().textContent).toContain('DI account list');
    bar.unmount(); await scope.dispose();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });
  it('keeps a plain divider before the three filter menus and leaves sorting to the table columns', async () => {
    const f = fixture(); f.mount(); await settle();
    expect(f.bar.getElement().querySelector('[data-sort-dropdown]')).toBeNull();
    expect(f.bar.getElement().querySelectorAll('[data-toolbar-dropdown]')).toHaveLength(3);
    expect(f.bar.getElement().querySelector('.astra-toolbar-separator')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reopens the custom-list menu after a synchronous store redraw', async () => {
    const f = fixture(); f.mount(); await settle();
    f.store.setFilters.mockImplementation((patch: Partial<IDashboardState['filters']>) => {
      f.state.filters = { ...f.state.filters, ...patch }; f.bar.update(f.state);
    });
    f.bar.getElement().querySelector<HTMLButtonElement>('[data-filter-value="Current list"]')!.click();
    expect(f.state.filters.customLists).toEqual(['Current list']);
    expect(f.bar.getElement().querySelector('[data-filter-field="customList"]')?.closest('[data-toolbar-dropdown]')?.classList.contains('open')).toBe(true);
    expect(f.bar.getElement().querySelector('[data-sort-dropdown]')).toBeNull();
    expect(f.store.setSort).not.toHaveBeenCalled();
  });

});

describe('Astra filter toolbar in-place updates', () => {
  it('keeps the focused search field, its caret and typed value across update()', async () => {
    const f = fixture(); f.mount(); await settle();
    const root = f.bar.getElement();
    const input = root.querySelector<HTMLInputElement>('#astra-search')!;
    input.focus(); input.value = 'frie'; input.setSelectionRange(2, 2);
    // The store's debounced search lags behind the keystrokes; the typed text must win.
    f.state.filters = { ...f.state.filters, search: 'fri' };
    f.bar.update(f.state);
    expect(f.bar.getElement()).toBe(root);
    expect(root.querySelector('#astra-search')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('frie');
    expect(input.selectionStart).toBe(2);
  });

  it('patches active chips and labels in place without rebuilding the toolbar', async () => {
    const f = fixture(); f.mount(); await settle();
    const root = f.bar.getElement();
    const watching = root.querySelector<HTMLButtonElement>('[data-quick-filter="watching"]')!;
    f.state.filters = { ...f.state.filters, type: 'anime', anilistStatus: [MediaListStatus.CURRENT] };
    f.bar.update(f.state);
    expect(root.querySelector('[data-quick-filter="watching"]')).toBe(watching);
    expect(watching.classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-quick-filter="all"]')!.classList.contains('active')).toBe(false);
    expect(root.querySelector('[data-quick-filter="watching"] span')!.textContent).toBe('Watching');
  });

  it('ignores store updates that do not change any toolbar input', async () => {
    const f = fixture(); f.mount(); await settle();
    const root = f.bar.getElement(); const input = root.querySelector('#astra-search');
    f.bar.update({ ...f.state, sort: 'score-desc', filteredWorks: [] });
    expect(f.bar.getElement()).toBe(root);
    expect(root.querySelector('#astra-search')).toBe(input);
  });

  it('keeps the custom-list menu open and its focus while a fetched list appears', async () => {
    const f = fixture(); const late = deferred<string[]>();
    f.service.getAniListCustomLists.mockReturnValueOnce(late.promise); f.mount(); await settle();
    const root = f.bar.getElement(); const input = root.querySelector<HTMLInputElement>('#astra-search')!;
    input.focus(); late.resolve(['Late list']); await settle();
    expect(root.querySelector('#astra-search')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(root.textContent).toContain('Late list');
    expect(root.textContent).not.toContain('Loading lists...');
  });

  it('shows "No lists found" instead of "Loading lists..." when the fetch returns no lists', async () => {
    const f = fixture(); f.service.getAniListCustomLists.mockResolvedValueOnce([]);
    f.mount(); await settle();
    expect(f.bar.getElement().textContent).toContain('No lists found');
    expect(f.bar.getElement().textContent).not.toContain('Loading lists...');
  });

  it('does not refetch custom lists on rerender after a failed fetch within the same mount', async () => {
    const f = fixture(); f.service.getAniListCustomLists.mockRejectedValue(new Error('Temporary provider failure'));
    f.mount(); await settle();
    f.state.filters = { ...f.state.filters, search: 'x' }; f.bar.update(f.state); await settle();
    f.bar.rerender(); await settle();
    expect(f.service.getAniListCustomLists).toHaveBeenCalledOnce();
  });
});
