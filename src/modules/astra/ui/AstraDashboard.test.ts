import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AstraDashboard } from './AstraDashboard';
import type { IDashboardState } from '../interfaces/IDashboardState';
import { AstraWorkTable } from './components/AstraWorkTable';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { AstraOverlayService } from '../services/AstraOverlayService';
import { logger } from '@core/logger';
import { MediaListStatus } from '@/api/AnilistTypes';

const dashboards: AstraDashboard[] = [];
afterEach(() => {
  for (const dashboard of dashboards.splice(0)) dashboard.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function fixture() {
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard',
    isLoading: false, error: null, filteredWorks: [],
    stats: { totalCount: 0, averageScore: 0, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const store = { subscribe: vi.fn(), getState: () => state, setTab: vi.fn(), ready: vi.fn(async () => {}) };
  const component = () => ({ mount: vi.fn(), unmount: vi.fn(), update: vi.fn(), getElement: () => document.createElement('div') });
  const dashboard = new AstraDashboard(store as never, {} as never,
    { on: vi.fn() } as never, component() as never, component() as never,
    component() as never, {} as never);
  dashboards.push(dashboard);
  dashboard.mount(document.body);
  return { dashboard, store };
}

describe('Astra dashboard navigation', () => {
  it('accepts the settings tab', () => {
    const { dashboard, store } = fixture();
    dashboard.getElement().querySelector<HTMLElement>('[data-tab="settings"]')!.click();
    expect(store.setTab).toHaveBeenCalledExactlyOnceWith('settings');
  });

  it.each(['unknown', '', undefined])('ignores an unsupported tab value %s', tab => {
    const { dashboard, store } = fixture();
    const navigation = dashboard.getElement().querySelector<HTMLElement>('[data-tab="settings"]')!;
    if (tab === undefined) delete navigation.dataset.tab;
    else navigation.dataset.tab = tab;
    navigation.click();
    expect(store.setTab).not.toHaveBeenCalled();
  });
});

function tableFixture() {
  let state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    filteredWorks: Array.from({ length: 1000 }, (_, index) => ({ id: `work_${index}`, mediaId: index + 1,
      title: `Work ${index}`, type: 'anime', status: MediaListStatus.CURRENT, updatedAt: 1, currentScore: 8,
      progress: 1, episodes: 12, sectionScores: { story: 8 } })),
    stats: { totalCount: 1000, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  let update!: (state: IDashboardState) => void;
  const store = { subscribe: (callback: typeof update) => { update = callback; callback(state); }, getState: () => state,
    setSort: (sort: IDashboardState['sort']) => { state = { ...state, sort }; update(state); }, setTab: vi.fn(), setSeparateAiring: vi.fn() };
  const service = { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }] };
  const table = new AstraWorkTable(store as never, service as never, { open: vi.fn() } as never);
  const component = () => ({ mount: vi.fn(), unmount: vi.fn(), update: vi.fn() });
  const dashboard = new AstraDashboard(store as never, service as never, { on: vi.fn() } as never,
    component() as never, table, component() as never, {} as never);
  dashboards.push(dashboard); dashboard.mount(document.body);
  return { dashboard, table, store, update: (patch: Partial<IDashboardState>) => { state = { ...state, ...patch }; update(state); } };
}

describe('Astra dashboard scroll integration with the production work table', () => {
  it('keeps the airing preference out of the dashboard toolbar', () => {
    const f = tableFixture();
    expect(f.dashboard.getElement().querySelector('#astra-dashboard-airing')).toBeNull();
  });

  it('keeps the dashboard heading visible when results are scrolled or filtered', () => {
    const f = tableFixture();
    const layout = f.dashboard.getElement().querySelector('.astra-dashboard-layout')!;
    const header = layout.querySelector('.astra-dashboard-shell-header')!;
    const table = f.table.getElement();
    table.scrollTop = 20;
    table.dispatchEvent(new Event('scroll'));
    expect(layout.contains(header)).toBe(true);

    const state = f.store.getState();
    f.update({
      filters: { ...state.filters, country: 'JP' },
      filteredWorks: state.filteredWorks.slice(0, 250),
    });

    expect(layout.contains(header)).toBe(true);
    expect(layout.classList.contains('astra-dashboard-layout--scrolled')).toBe(false);
  });
});

function dashboardLifecycleFixture() {
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null, filteredWorks: [],
    stats: { totalCount: 0, averageScore: 0, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const listeners = new Set<(state: IDashboardState) => void>();
  const store = { subscribe: vi.fn((listener: (state: IDashboardState) => void) => { listeners.add(listener); listener(state); return () => listeners.delete(listener); }),
    getState: () => state, ready: vi.fn(async () => {}), setTab: vi.fn(), setLayout: vi.fn(), setShowProgress: vi.fn() };
  const component = () => ({ mount: vi.fn(), unmount: vi.fn(), update: vi.fn(), focusEntry: vi.fn(), getElement: () => document.createElement('div') });
  const table = { ...component(), prepareAiringData: vi.fn(async () => {}), cancelAiringDataRequest: vi.fn() };
  const service = { init: vi.fn(async () => {}) }; const bus = new EventBus();
  const overlay = new AstraOverlayService();
  const dashboard = new AstraDashboard(store as never, service as never, bus, component() as never, table as never, component() as never, overlay);
  dashboards.push(dashboard);
  return { dashboard, store, listeners, table, service, bus, overlay };
}
function deferredInit() {
  let resolve!: () => void;
  const promise = new Promise<void>(finish => { resolve = finish; }); return { promise, resolve };
}
type DashboardLifecycle = { activate(): void; deactivate(): void; dispose(): void };
describe('Astra dashboard overlay and document lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.style.overflow = ''; });
  it.each(['close', 'auth', 'deactivate', 'dispose'] as const)('does not mount a late initialization after %s', async action => {
    const f = dashboardLifecycleFixture(); const init = deferredInit(); f.service.init.mockReturnValueOnce(init.promise);
    const pending = f.dashboard.open();
    if (action === 'auth') f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    else if (action === 'close') f.dashboard.close();
    else (f.dashboard as unknown as DashboardLifecycle)[action]();
    init.resolve(); await pending; await vi.runAllTimersAsync();
    expect(f.dashboard.getElement().isConnected).toBe(false); expect(f.overlay.isActive('dashboard')).toBe(false);
  });
  it('prepares Airing before showing the dashboard while the rest of initialization runs', async () => {
    const f = dashboardLifecycleFixture(); const airing = deferredInit();
    f.table.prepareAiringData.mockReturnValueOnce(airing.promise);
    const opening = f.dashboard.open();
    await Promise.resolve();
    expect(f.service.init).toHaveBeenCalledOnce();
    expect(f.table.prepareAiringData).toHaveBeenCalledOnce();
    expect(f.overlay.isActive('dashboard')).toBe(false);
    airing.resolve(); await opening;
    expect(f.overlay.isActive('dashboard')).toBe(true);
    f.dashboard.close(); await vi.runAllTimersAsync();
  });
  it('allows a fresh open after cancelling an older pending open', async () => {
    const f = dashboardLifecycleFixture(); const init = deferredInit(); f.service.init.mockReturnValueOnce(init.promise);
    const old = f.dashboard.open({ mediaId: 7 }); f.dashboard.close();
    await f.dashboard.open({ mediaId: 8 }); init.resolve(); await old; await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelectorAll('#astra-overlay-dashboard')).toHaveLength(1);
    expect(f.table.focusEntry).toHaveBeenCalledExactlyOnceWith(8); f.dashboard.close(); await vi.runAllTimersAsync();
  });
  it('cancels delayed focus and makes copied focus callbacks inert after close and reopen', async () => {
    const f = dashboardLifecycleFixture(); const timers = vi.spyOn(globalThis, 'setTimeout');
    await f.dashboard.open({ mediaId: 7 });
    const oldFocus = timers.mock.calls.find(call => call[1] === 500)?.[0];
    f.dashboard.close(); await vi.advanceTimersByTimeAsync(350); await f.dashboard.open();
    if (typeof oldFocus === 'function') oldFocus();
    await vi.advanceTimersByTimeAsync(500); expect(f.table.focusEntry).not.toHaveBeenCalled();
    f.dashboard.close(); await vi.runAllTimersAsync();
  });
  it('releases subscriptions on OFF, reactivates once on ON and disposes permanently', async () => {
    const f = dashboardLifecycleFixture(); const lifecycle = f.dashboard as unknown as DashboardLifecycle;
    expect(f.listeners.size).toBe(1); expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_OPEN)).toBe(1);
    await f.dashboard.open(); lifecycle.deactivate(); lifecycle.deactivate();
    expect(f.listeners.size).toBe(0); expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_OPEN)).toBe(0);
    expect(f.overlay.isActive('dashboard')).toBe(false); expect(vi.getTimerCount()).toBe(0);
    lifecycle.activate(); lifecycle.activate();
    expect(f.listeners.size).toBe(1); expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_OPEN)).toBe(1);
    await f.dashboard.open(); expect(f.dashboard.getElement().isConnected).toBe(true);
    lifecycle.dispose(); lifecycle.activate(); await f.dashboard.open();
    expect(f.listeners.size).toBe(0); expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_OPEN)).toBe(0);
    expect(f.dashboard.getElement().isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a copied store callback inert after deactivation and reactivation', async () => {
    const f = dashboardLifecycleFixture(); const lifecycle = f.dashboard as unknown as DashboardLifecycle;
    const obsolete = f.store.subscribe.mock.calls[0][0]; lifecycle.deactivate(); lifecycle.activate(); await f.dashboard.open();
    f.table.update.mockClear(); obsolete({ ...f.store.getState(), activeTab: 'settings' });
    expect(f.table.update).not.toHaveBeenCalled(); expect(f.dashboard.getElement().querySelector('.astra-dashboard-layout')).not.toBeNull();
    lifecycle.dispose();
  });
  it('contains global-open rejection and allows the next open', async () => {
    const f = dashboardLifecycleFixture(); const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    f.service.init.mockRejectedValueOnce(new Error('failed'));
    f.bus.emit(EVENT_TYPES.ASTRA_OPEN); for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(errorLog).toHaveBeenCalled(); await f.dashboard.open(); expect(f.dashboard.getElement().isConnected).toBe(true);
    (f.dashboard as unknown as DashboardLifecycle).dispose();
  });
  it('reopens during fade without letting the previous close callback unmount the new view', async () => {
    const f = dashboardLifecycleFixture(); await f.dashboard.open(); f.dashboard.close(); await f.dashboard.open();
    await vi.advanceTimersByTimeAsync(350); expect(f.dashboard.getElement().isConnected).toBe(true);
    expect(f.overlay.isActive('dashboard')).toBe(true); (f.dashboard as unknown as DashboardLifecycle).dispose();
  });
});

describe('Astra dashboard keyboard dismissal', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closes the dashboard on Escape', async () => {
    const f = dashboardLifecycleFixture(); await f.dashboard.open();
    expect(f.overlay.isActive('dashboard')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(f.overlay.isActive('dashboard')).toBe(false);
  });

  it('leaves the dashboard open on Escape while another Astra overlay is on top', async () => {
    const f = dashboardLifecycleFixture(); await f.dashboard.open();
    const other = document.createElement('div'); other.className = 'astra-modal-overlay'; document.body.append(other);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(f.overlay.isActive('dashboard')).toBe(true);
  });
});
