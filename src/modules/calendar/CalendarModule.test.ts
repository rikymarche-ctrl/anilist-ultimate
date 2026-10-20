import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarModule } from './CalendarModule';
import { CalendarDomService } from './services/CalendarDomService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import { CSS_CLASSES, DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { calendarEntry } from '@/test/calendar-fixtures';
describe('calendar lifecycle and account updates', () => {
  beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/home'); document.body.replaceChildren(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); document.body.style.overflow = ''; container.reset(); });
  function fixture(authenticated = true) {
    let owner = 42; const bus = new EventBus();
    const api = { isAuthenticated: () => authenticated, getCurrentUserId: vi.fn(async () => owner), getContext: () => ({ userId: owner, sessionId: `session-${owner}` }),
      ensureContext: async () => ({ userId: owner, sessionId: `session-${owner}` }) };
    const element: HTMLElement = document.createElement('div');
    let settingsClick: (() => void) | undefined; let retry: (() => Promise<void>) | undefined;
    let loginClick: (() => Promise<void>) | undefined;
    const dom = { injectCalendar: vi.fn(async (onSettings?: () => void, _mark?: unknown, _astra?: unknown, _current?: unknown, onRetry?: () => Promise<void>) => { settingsClick = onSettings; retry = onRetry; return element; }), cleanup: vi.fn(), findAiringSection: vi.fn(async () => null), maskNativeSections: vi.fn(), showAuthPrompt: vi.fn((callback: () => Promise<void>) => { loginClick = callback; }) };
    const data = { loadSchedule: vi.fn(async () => undefined) };
    const entries: ReturnType<typeof calendarEntry>[] = [];
    const store = { init: vi.fn(async (): Promise<void> => undefined), loadCustomPlans: vi.fn(async () => []),
      getCustomPlans: vi.fn(() => []), clearCustomPlans: vi.fn(),
      stopCountdownInterval: vi.fn(), updateEntry: vi.fn(), removeEntry: vi.fn(), getState: () => ({ entries, preferences: { ...DEFAULT_CALENDAR_PREFERENCES } }) };
    container.registerInstance(TOKENS.CalendarStore, store);
    const observer = { register: vi.fn(), unregister: vi.fn() };
    const auth = { login: vi.fn(async () => undefined) };
    const social = { loadFriendActivity: vi.fn(async () => undefined) };
    const config = { isFeatureEnabled: vi.fn((_feature: string) => false) };
    const module = new CalendarModule(api as never, dom as never, data as never, social as never, store as never, observer as never, config as never, auth as never, bus);
    return { module, api, dom, data, store, observer, bus, auth, social, config, loginCallback: () => loginClick!, settingsClick: () => settingsClick!(), settingsCallback: () => settingsClick!, retryCallback: () => retry!, switchAccount: () => { owner = 43; }, authenticate: () => {
      authenticated = true; bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: owner, timestamp: new Date() });
    } };
  }
  it('starts loading from the authenticated session without waiting for a Viewer request', async () => {
    const f = fixture();
    f.api.getCurrentUserId.mockImplementation(() => new Promise<number>(() => {}));
    const pending = f.module.init();
    try {
      await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledWith(42, false));
      expect(f.api.getCurrentUserId).not.toHaveBeenCalled();
      await pending;
    } finally { await f.module.destroy(); }
  });
  it('falls back to resolving the owner for API clients without session metadata', async () => {
    const f = fixture();
    Object.assign(f.api, { ensureContext: undefined, getContext: undefined });
    await f.module.init();
    expect(f.api.getCurrentUserId).toHaveBeenCalledTimes(1);
    expect(f.data.loadSchedule).toHaveBeenCalledWith(42, false);
    await f.module.destroy();
  });
  it('rejects a session changed while capturing the startup account', async () => {
    const f = fixture();
    f.api.ensureContext = async () => {
      f.switchAccount();
      return { userId: 42, sessionId: 'session-42' };
    };
    await f.module.init();
    expect(f.dom.injectCalendar).not.toHaveBeenCalled();
    expect(f.data.loadSchedule).not.toHaveBeenCalled();
    await f.module.destroy();
  });
  it('does not refetch for personal or catch-up rows whose time has passed', async () => {
    const f = fixture(); await f.module.init();
    const root = document.createElement('div'); root.id = CSS_CLASSES.CALENDAR;
    root.innerHTML = '<div class="calendar-grid"></div>'; document.body.append(root);
    const past = new Date(Date.now() - 1000);
    f.store.getState().entries.push({ ...calendarEntry(1), airingAt: past }, { ...calendarEntry(2), airingAt: past, calendarKind: 'personal' as const });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(1);
    await f.module.destroy();
  });
  it('handles an auth change that arrives while the first load is still pending', async () => {
    const f = fixture();
    let release!: () => void; const gate = new Promise<void>(done => { release = done; });
    f.dom.injectCalendar.mockImplementationOnce(async () => { await gate; return document.createElement('div'); });
    const pending = f.module.init();
    await vi.waitFor(() => expect(f.dom.injectCalendar).toHaveBeenCalledTimes(1));
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 42, timestamp: new Date() });
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledWith(42, true));
    release(); await pending; await f.module.destroy();
  });
  it('restores friend activity after a personal plan reload', async () => {
    const f = fixture(); f.config.isFeatureEnabled.mockReturnValue(true);
    await f.module.init();
    f.social.loadFriendActivity.mockClear();
    await (f.module as unknown as { reloadAfterPersonalPlanChange(ownerId: number): Promise<void> }).reloadAfterPersonalPlanChange(42);
    expect(f.data.loadSchedule).toHaveBeenLastCalledWith(42, true);
    expect(f.social.loadFriendActivity).toHaveBeenCalledTimes(1);
    await f.module.destroy();
  });
  it('refreshes an expired schedule in an already mounted calendar without a page refresh', async () => {
    const f = fixture(); await f.module.init();
    const root = document.createElement('div'); root.id = CSS_CLASSES.CALENDAR;
    root.innerHTML = '<div class="calendar-grid"></div>'; document.body.append(root);
    f.store.getState().entries.push({ ...calendarEntry(1), calendarKind: 'airing' as const, airingAt: new Date(Date.now() + 1000) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
    expect(f.data.loadSchedule).toHaveBeenLastCalledWith(42, true);
    await vi.advanceTimersByTimeAsync(298000); expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); expect(f.data.loadSchedule).toHaveBeenCalledTimes(3);
    f.store.getState().entries[0].airingAt = new Date(Date.now() + 604800000);
    await vi.advanceTimersByTimeAsync(600000); expect(f.data.loadSchedule).toHaveBeenCalledTimes(3);
    await f.module.destroy();
  });
  it('defers repeated queue broadcasts in a hidden tab and refreshes once when it becomes visible', async () => {
    const f = fixture(); await f.module.init();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    for (let signal = 0; signal < 8; signal++) f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
    await vi.advanceTimersByTimeAsync(10000); expect(f.data.loadSchedule).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(2));
    expect(f.data.loadSchedule).toHaveBeenLastCalledWith(42, true);
    await f.module.destroy(); document.dispatchEvent(new Event('visibilitychange'));
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
  });
  it('does not fetch a calendar opened in the background until the user selects the tab', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const f = fixture(); await f.module.init(); expect(f.data.loadSchedule).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledWith(42, true)); await f.module.destroy();
  });
  it('activates the calendar when authentication completes after a signed-out startup', async () => {
    const f = fixture(false); await f.module.init();
    expect(f.dom.showAuthPrompt).toHaveBeenCalledTimes(1);
    f.authenticate(); await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledWith(42, true));
    await f.module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates a login failure to the prompt and rejects stale login callbacks', async () => {
    const f = fixture(false); await f.module.init(); const login = f.loginCallback();
    f.auth.login.mockRejectedValueOnce(new Error('Login failed'));
    await expect(login()).rejects.toThrow('Login failed');
    expect(f.auth.login).toHaveBeenCalledTimes(1);
    history.replaceState({}, '', '/anime/1');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/1', previousPath: '/home', timestamp: new Date() });
    history.replaceState({}, '', '/home'); await login();
    expect(f.auth.login).toHaveBeenCalledTimes(1);
    await f.module.destroy(); await login(); expect(f.auth.login).toHaveBeenCalledTimes(1);
  });
  it('does not start observers or intervals after destruction while preferences load', async () => {
    const f = fixture(); let resolve!: () => void;
    f.store.init.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    const pending = f.module.init(); await f.module.destroy(); resolve(); await pending;
    expect(f.observer.register).not.toHaveBeenCalled(); expect(f.dom.injectCalendar).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not load data or resume module resources after a late injection completes', async () => {
    const f = fixture(); let resolve!: (value: HTMLElement) => void;
    f.dom.injectCalendar.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = f.module.init(); await vi.waitFor(() => expect(f.dom.injectCalendar).toHaveBeenCalled());
    await f.module.destroy(); resolve(document.createElement('div')); await pending;
    expect(f.data.loadSchedule).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('refreshes with the new owner and ignores progress events for another owner or removal of repeating entries', async () => {
    const f = fixture(); await f.module.init(); f.switchAccount(); f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenLastCalledWith(43, true));
    f.bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, userId: 42, progress: 3, previousProgress: 2 });
    expect(f.store.updateEntry).not.toHaveBeenCalled();
    f.bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, userId: 43, progress: 3, previousProgress: 2, status: MediaListStatus.REPEATING });
    expect(f.store.removeEntry).not.toHaveBeenCalled(); expect(f.store.updateEntry).toHaveBeenCalledWith(1, { progress: 3 });
    await f.module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('guards the DOM service itself when cleanup occurs during section lookup', async () => {
    const service = new CalendarDomService(); let resolve!: (value: HTMLElement) => void;
    vi.spyOn(service, 'findAiringSection').mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = service.injectCalendar(() => undefined, async () => undefined, false);
    service.cleanup(); const header = document.createElement('h2'); header.textContent = 'Airing'; document.body.append(header); resolve(header);
    expect(await pending).toBeNull(); expect(header.textContent).toBe('Airing'); expect(document.querySelector('.anilist-calendar')).toBeNull();
  });

  it('owns one settings panel, restores scroll on route leave and rejects an old injection callback', async () => {
    const f = fixture(); await f.module.init(); document.body.style.overflow = 'clip';
    const oldClick = f.settingsCallback(); f.settingsClick(); f.settingsClick();
    expect(document.querySelectorAll('.settings-overlay')).toHaveLength(1);
    expect(document.body.style.overflow).toBe('hidden');
    history.replaceState({}, '', '/anime/1');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/1', previousPath: '/home', timestamp: new Date() });
    expect(document.querySelector('.settings-overlay')).toBeNull(); expect(document.body.style.overflow).toBe('clip');
    history.replaceState({}, '', '/home'); oldClick();
    expect(document.querySelector('.settings-overlay')).toBeNull();
    await f.module.destroy();
  });

  it('unmounts settings on account change and destroy and permits reopening after close', async () => {
    const f = fixture(); await f.module.init(); f.settingsClick();
    document.querySelector<HTMLButtonElement>('.settings-panel__close')!.click();
    f.settingsClick(); expect(document.querySelectorAll('.settings-overlay')).toHaveLength(1);
    f.switchAccount(); f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
    expect(document.querySelector('.settings-overlay')).toBeNull();
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenLastCalledWith(43, true));
    f.settingsClick(); expect(document.querySelector('.settings-overlay')).not.toBeNull();
    const oldClick = f.settingsCallback(); await f.module.destroy(); oldClick();
    expect(document.querySelector('.settings-overlay')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    document.body.style.overflow = '';
  });
  it('connects retry to a forced load and keeps error views out of automatic persistence polling', async () => {
    const f = fixture(); await f.module.init();
    const existing = document.createElement('div'); existing.id = CSS_CLASSES.CALENDAR;
    existing.innerHTML = '<div class="calendar-grid__error"></div>'; document.body.append(existing);
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.dom.injectCalendar).toHaveBeenCalledTimes(1); expect(f.data.loadSchedule).toHaveBeenCalledTimes(1);
    await f.retryCallback()(); expect(f.data.loadSchedule).toHaveBeenLastCalledWith(42, true);
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2); expect(f.dom.injectCalendar).toHaveBeenCalledTimes(1); await f.module.destroy();
  });
  it('rejects retry callbacks from a previous account, route or destroyed module', async () => {
    const f = fixture(); await f.module.init(); const staleAccount = f.retryCallback();
    f.switchAccount(); await expect(staleAccount()).rejects.toThrow('account changed');
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(1);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenLastCalledWith(43, true));
    const staleRoute = f.retryCallback(); history.replaceState({}, '', '/anime/1');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/1', previousPath: '/home', timestamp: new Date() });
    history.replaceState({}, '', '/home'); await staleRoute();
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2); await f.module.destroy(); await f.retryCallback()();
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a slow provider refresh after the former processing safety timeout', async () => {
    const f = fixture(); await f.module.init(); const retry = f.retryCallback();
    const existing = document.createElement('div'); existing.id = CSS_CLASSES.CALENDAR;
    existing.innerHTML = '<div class="calendar-grid__error"></div>'; document.body.append(existing);
    let finish!: () => void; f.data.loadSchedule.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }));
    const pending = retry(); await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(12000); await retry();
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
    finish(); await pending; await retry(); expect(f.data.loadSchedule).toHaveBeenCalledTimes(3);
    await f.module.destroy();
  });

  it('refreshes live data on a queue signal and coalesces signals received during a slow refresh', async () => {
    const f = fixture(); await f.module.init(); let finish!: () => void;
    f.data.loadSchedule.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(2));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined); f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2); finish();
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(3));
    await f.module.destroy(); f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(3);
  });
  it('schedules a follow-up when a queue signal invalidates the initial load before initialization finishes', async () => {
    const f = fixture(); let finish!: () => void;
    f.data.loadSchedule.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }));
    const pending = f.module.init(); await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(1));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined); finish(); await pending;
    await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(2)); await f.module.destroy();
  });
  it('drops queued refresh intent on route leave and destruction', async () => {
    const f = fixture(); await f.module.init(); let finish!: () => void;
    f.data.loadSchedule.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(undefined); }));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined); await vi.waitFor(() => expect(f.data.loadSchedule).toHaveBeenCalledTimes(2));
    f.bus.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined); history.replaceState({}, '', '/anime/1');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/1', previousPath: '/home', timestamp: new Date() });
    await f.module.destroy(); finish(); await Promise.resolve(); await Promise.resolve(); expect(f.data.loadSchedule).toHaveBeenCalledTimes(2);
  });

  it('replaces owned callbacks on a home-to-home navigation instead of leaving the old generation inert', async () => {
    const f = fixture(); await f.module.init(); const oldRetry = f.retryCallback();
    const existing = document.createElement('div'); existing.id = CSS_CLASSES.CALENDAR;
    existing.innerHTML = '<div class="calendar-grid"></div>'; document.body.append(existing);
    f.dom.cleanup.mockImplementation(() => { existing.remove(); });
    history.replaceState({}, '', '/'); f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/', previousPath: '/home', timestamp: new Date() });
    await vi.waitFor(() => expect(f.dom.injectCalendar).toHaveBeenCalledTimes(2));
    expect(f.dom.cleanup).toHaveBeenCalledTimes(1); await oldRetry();
    expect(f.data.loadSchedule).toHaveBeenCalledTimes(2); await f.retryCallback()();
    expect(f.data.loadSchedule).toHaveBeenLastCalledWith(42, true); expect(f.data.loadSchedule).toHaveBeenCalledTimes(3);
    await f.module.destroy();
  });

});
