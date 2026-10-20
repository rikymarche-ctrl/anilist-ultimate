import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarDomService } from './CalendarDomService';
import { CalendarStore } from '../CalendarStore';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { SocialRenderer } from '@modules/social/SocialRenderer';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { calendarEntry } from '@/test/calendar-fixtures';
import { AuthLoginError } from '@core/auth/AuthFailure';

const services: CalendarDomService[] = [];
function fixture() {
  document.body.innerHTML = '<div class="home"><section class="list-preview-wrap"><div class="section-header"><h2>Airing</h2><button class="view-selector" style="display:inline-flex">View</button></div><div class="grid-wrap" style="display:grid"><div class="media-preview-card"></div></div></section></div>';
  const store = new CalendarStore({} as never, { create: () => ({}) } as never);
  store.setState({ entries: [calendarEntry()], preferences: { ...DEFAULT_CALENDAR_PREFERENCES, hideEmptyDays: true, socialEnabled: false } });
  const scope = container.createChildContainer(); scope.register(TOKENS.ComponentScope, { useFactory: child => child });
  scope.registerInstance(TOKENS.CalendarStore, store);
  scope.registerInstance(TOKENS.ApiClient, { getContext: () => ({ userId: 1, sessionId: 'one' }) });
  scope.registerInstance(TOKENS.CalendarService, { hasAired: () => false, isAiringSoon: () => false, formatAiringTime: () => '20:00', formatTimeUntilAiring: () => 'remaining' });
  scope.registerInstance(SocialRenderer, { attachPortal: () => new AbortController() } as never);
  scope.registerInstance(AstraRatingModal, { open: async () => {} } as never);
  const service = new CalendarDomService(scope); services.push(service);
  const settings = vi.fn(); const mark = vi.fn(async () => {});
  return { service, store, scope, settings, mark,
    inject: (callback = settings, astra = true) => service.injectCalendar(callback, mark, astra),
    native: () => document.querySelector<HTMLElement>('.grid-wrap')!, view: () => document.querySelector<HTMLElement>('.view-selector')!,
    button: () => document.querySelector<HTMLButtonElement>('.calendar-header__settings')! };
}
beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/home'); });
afterEach(() => { for (const service of services.splice(0)) service.cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('calendar DOM service owned views and native state', () => {
  it('mounts the grid and cards with the injected scope and releases them at cleanup', async () => {
    const f = fixture(); await f.inject();
    expect(document.querySelectorAll('.anime-card[data-media-id]')).toHaveLength(1); expect(vi.getTimerCount()).toBe(1);
    f.service.cleanup(); expect(document.querySelector('.anilist-calendar')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('refreshes settings handlers on reinjection and leaves detached controls inert', async () => {
    const f = fixture(); await f.inject(); const old = f.button(); const next = vi.fn();
    await f.inject(next); f.button().click(); expect(next).toHaveBeenCalledTimes(1); expect(f.settings).not.toHaveBeenCalled();
    old.click(); expect(f.settings).not.toHaveBeenCalled(); const current = f.button(); f.service.cleanup(); current.click(); expect(next).toHaveBeenCalledTimes(1);
  });
  it('restores native header nodes and exact hidden styles when ownership ends', async () => {
    const f = fixture(); const header = document.querySelector('h2')!; const original = header.firstChild;
    await f.inject(); expect(f.native().style.display).toBe('none'); expect(f.view().style.display).toBe('none');
    f.service.cleanup(); expect(header.textContent).toBe('Airing'); expect(header.firstChild).toBe(original);
    expect(f.native().style.display).toBe('grid'); expect(f.view().style.display).toBe('inline-flex');
    expect(document.querySelector('.calendar-header__actions')).toBeNull(); expect(header.classList.contains('au-calendar-title')).toBe(false);
  });
  it('preserves native changes made after injection instead of restoring old Vue state over them', async () => {
    const f = fixture(); await f.inject(); f.native().style.display = 'flex'; const header = document.querySelector('h2')!; header.textContent = 'New native title';
    f.service.cleanup(); expect(f.native().style.display).toBe('flex'); expect(header.textContent).toBe('New native title');
  });
  it('captures the new native style baseline on reinjection and removes its old managed-header class', async () => {
    const f = fixture(); await f.inject(); f.native().style.setProperty('display', 'flex', 'important');
    await f.inject(f.settings, false);
    expect(document.querySelector('.section-header')?.classList.contains('au-calendar-header-managed')).toBe(false);
    f.service.cleanup(); expect(f.native().style.display).toBe('flex'); expect(f.native().style.getPropertyPriority('display')).toBe('important');
  });
  it('unmounts the grid before replacing it with an auth prompt and removes old login callbacks', async () => {
    const f = fixture(); await f.inject(); const oldLogin = vi.fn(); f.service.showAuthPrompt(oldLogin);
    expect(vi.getTimerCount()).toBe(0); const old = document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn')!;
    const nextLogin = vi.fn(); f.service.showAuthPrompt(nextLogin); old.click(); expect(oldLogin).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn')!.click(); await Promise.resolve(); expect(nextLogin).toHaveBeenCalledTimes(1);
    f.service.cleanup(); old.click(); expect(oldLogin).not.toHaveBeenCalled();
  });
  it('shows a pending login immediately, prevents duplicate clicks and offers retry after rejection', async () => {
    const f = fixture(); await f.inject();
    let reject!: (error: Error) => void;
    const login = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    f.service.showAuthPrompt(login);
    const button = document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn')!;
    button.click(); button.click();
    expect(login).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Connecting');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector<HTMLElement>('.calendar-auth-prompt__status')?.hidden).toBe(false);
    reject(new Error('private provider detail')); await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Login could not be completed');
    expect(document.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(false);
    expect(document.querySelector('details')?.open).toBe(false);
    expect(document.body.textContent).not.toContain('private provider detail');
    login.mockResolvedValueOnce(); button.click(); await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(login).toHaveBeenCalledTimes(2); expect(document.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(true);
  });
  it('shows a safe diagnostic code for failures opening the actual authorization window', async () => {
    const f = fixture(); await f.inject();
    f.service.showAuthPrompt(async () => { throw new AuthLoginError('AUTH_OPEN'); });
    document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('AUTH_OPEN'));
    expect(document.querySelector('.calendar-auth-prompt__error-title')?.textContent).toBe('The sign-in window couldn’t open');
    expect(document.querySelector('.calendar-auth-prompt__details')?.textContent).toContain('Technical details');
    expect(document.querySelector('.calendar-auth-prompt__code')?.textContent).toBe('AUTH_OPEN');
  });
  it('restores separately masked native sections at cleanup', async () => {
    const f = fixture(); await f.inject();
    const extra = document.createElement('section'); extra.style.cssText = 'display:flex;visibility:visible;height:33px;overflow:auto';
    extra.innerHTML = '<h2>Airing</h2>'; document.body.append(extra);
    f.service.maskNativeSections(); expect(extra.style.display).toBe('none'); f.service.cleanup();
    expect(extra.style.display).toBe('flex'); expect(extra.style.visibility).toBe('visible'); expect(extra.style.height).toBe('33px'); expect(extra.style.overflow).toBe('auto');
    expect(extra.classList.contains('au-native-airing-hidden')).toBe(false);
  });
  it('removes only the artificial section it created when no native Airing section exists', async () => {
    const f = fixture(); document.body.innerHTML = '<div class="home"></div>'; await f.inject();
    expect(document.querySelector('[data-au-artificial]')).not.toBeNull(); f.service.cleanup(); expect(document.querySelector('[data-au-artificial]')).toBeNull();
  });
  it('continues cleanup if the child container disposal fails', async () => {
    const f = fixture(); await f.inject(); const child = (f.service as unknown as { childContainer: { dispose: () => Promise<void> } }).childContainer;
    vi.spyOn(child, 'dispose').mockRejectedValueOnce(new Error('Synthetic disposal failure'));
    expect(() => f.service.cleanup()).not.toThrow(); await Promise.resolve();
    expect(document.querySelector('.anilist-calendar')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('connects the injected provider retry and disconnects old retry controls at cleanup', async () => {
    const f = fixture(); f.store.setEntries([]); f.store.setError(new Error('offline'));
    const retry = vi.fn(async () => { f.store.setEntries([calendarEntry(9)]); });
    await f.service.injectCalendar(f.settings, f.mark, true, () => true, retry);
    const button = document.querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!; button.click();
    await vi.waitFor(() => expect(document.querySelector('.anime-card[data-media-id="9"]')).not.toBeNull());
    expect(retry).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="alert"]')).toBeNull();
    f.service.cleanup(); button.click(); expect(retry).toHaveBeenCalledTimes(1);
  });

});
