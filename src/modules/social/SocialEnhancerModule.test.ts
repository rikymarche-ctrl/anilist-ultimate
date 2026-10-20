import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialEnhancerModule } from './SocialEnhancerModule';
import { SocialRenderer } from './SocialRenderer';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus, type FriendActivity } from '@core/types';
import type { AppPreferences } from '@core/services/PreferencesService';
import { logger } from '@core/logger';

const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function card(url = '/anime/7/title') {
  const element = document.createElement('article'); element.className = 'media-card';
  const cover = document.createElement('a'); cover.className = 'cover'; cover.href = url; element.append(cover);
  document.body.append(element); return element;
}

describe('social portal async cleanup', () => {
  const modules: SocialEnhancerModule[] = [];
  beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/home'); vi.spyOn(logger, 'error').mockImplementation(() => undefined); });
  afterEach(async () => { for (const module of modules) await module.destroy(); modules.length = 0; vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
  async function fixture() {
    const requests: ReturnType<typeof deferred<Map<number, FriendActivity[]>>>[] = [];
    const service = { getFriendActivityBatch: vi.fn(() => { const request = deferred<Map<number, FriendActivity[]>>(); requests.push(request); return request.promise; }) };
    let enabled = true;
    let prefsCallback!: (prefs: AppPreferences) => void;
    const prefs = { socialEnabled: true, socialShowAvatars: true, enableAstra: true, enableSocialFeatures: true, autoUpdateProgress: false, compactMode: false };
    const unsubscribe = vi.fn();
    const preferences = { isSocialEnabled: () => enabled, getPreferences: () => ({ ...prefs, socialEnabled: enabled }), onChanges: vi.fn((callback: typeof prefsCallback) => { prefsCallback = callback; return unsubscribe; }) };
    const renderer = new SocialRenderer(preferences as never); const attach = vi.spyOn(renderer, 'attachPortal');
    const callbacks: Array<() => void> = [];
    const observer = { register: vi.fn((_name: string, callback: () => void) => callbacks.push(callback)), unregister: vi.fn() };
    const bus = new EventBus();
    const module = new SocialEnhancerModule(service as never, renderer, observer as never, bus, preferences as never); modules.push(module);
    await module.init();
    const changePrefs = (value: boolean) => { enabled = value; prefsCallback({ ...prefs, socialEnabled: enabled }); };
    const scan = () => callbacks.at(-1)?.();
    return { module, bus, renderer, attach, observer, callbacks, preferences, unsubscribe, requests, service, scan, changePrefs };
  }

  it('does not recreate portals after destroy while a fetch is pending', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800); expect(f.requests).toHaveLength(1);
    await f.module.destroy(); f.requests[0].resolve(new Map([[7, []]])); await drain();
    expect(f.attach).not.toHaveBeenCalled(); expect(element.hasAttribute('data-au-social-processed')).toBe(false);
  });

  it('ignores cards removed during an API request', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    element.remove(); f.requests[0].resolve(new Map([[7, []]])); await drain(); expect(f.attach).not.toHaveBeenCalled();
  });

  it('aborts installed portals and their native listeners/markers on destroy', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800); f.requests[0].resolve(new Map([[7, []]])); await drain();
    const controller = f.attach.mock.results[0].value as AbortController;
    element.dispatchEvent(new MouseEvent('mouseenter')); expect(document.querySelector('.au-social-bubble-portal')).not.toBeNull();
    await f.module.destroy(); expect(controller.signal.aborted).toBe(true);
    expect(document.querySelector('.au-social-bubble-portal')).toBeNull(); expect(element.hasAttribute('data-au-social-media-id')).toBe(false);
    element.dispatchEvent(new MouseEvent('mouseenter')); expect(document.querySelector('.au-social-bubble-portal')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores captured observer/preference callbacks after destroy and remounts once', async () => {
    const f = await fixture(); const old = f.callbacks[0]; await f.module.init(); expect(f.preferences.onChanges).toHaveBeenCalledTimes(1);
    await f.module.destroy(); card(); old(); f.changePrefs(true); await vi.advanceTimersByTimeAsync(800);
    expect(f.service.getFriendActivityBatch).not.toHaveBeenCalled(); expect(f.observer.register).toHaveBeenCalledTimes(1);
    await f.module.init(); old(); await vi.advanceTimersByTimeAsync(800); expect(f.requests).toHaveLength(1);
    f.requests[0].resolve(new Map([[7, []]])); await drain(); expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it('retries a failed batch on the next scan without leaving cards marked as processed', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800); f.requests[0].reject(new Error('Network')); await drain();
    expect(element.hasAttribute('data-au-social-processed')).toBe(false);
    f.scan(); await vi.advanceTimersByTimeAsync(800); expect(f.requests).toHaveLength(2);
    f.requests[1].resolve(new Map([[7, []]])); await drain(); expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'missing', 'failure'] as const)('keeps reused cards bound to their latest media after an old %s', async outcome => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    element.querySelector<HTMLAnchorElement>('a')!.href = '/manga/8/title'; f.scan(); await vi.advanceTimersByTimeAsync(800);
    expect(f.requests).toHaveLength(2);
    if (outcome === 'failure') f.requests[0].reject(new Error('Old error'));
    else f.requests[0].resolve(outcome === 'missing' ? new Map() : new Map([[7, []]]));
    await drain(); expect(element.getAttribute('data-au-social-media-id')).toBe('8'); expect(element.hasAttribute('data-au-social-processed')).toBe(true);
    expect(f.attach).not.toHaveBeenCalled();
    f.requests[1].resolve(new Map([[8, []]])); await drain(); expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.attach.mock.calls[0][1]).toBe(8); expect(f.attach.mock.calls[0][4]).toBe('MANGA');
  });

  it('releases removed portals during scans and aborts a portal when its card changes route', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800); f.requests[0].resolve(new Map([[7, []]])); await drain();
    const first = f.attach.mock.results[0].value as AbortController;
    element.querySelector<HTMLAnchorElement>('a')!.href = '/manga/8/title'; f.scan(); expect(first.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(800); f.requests[1].resolve(new Map([[8, []]])); await drain();
    const second = f.attach.mock.results[1].value as AbortController; element.remove(); f.scan(); expect(second.signal.aborted).toBe(true);
    expect(element.hasAttribute('data-au-social-media-id')).toBe(false);
  });

  it('does not overwrite the newest cache when a previous request completes last', async () => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    element.querySelector<HTMLAnchorElement>('a')!.href = '/manga/8/title'; f.scan();
    element.querySelector<HTMLAnchorElement>('a')!.href = '/anime/7/title'; f.scan(); await vi.advanceTimersByTimeAsync(800);
    const latest: FriendActivity[] = [{ id: 1, status: MediaListStatus.CURRENT, score: 80, progress: 4,
      user: { id: 2, name: 'Latest', avatar: { medium: '' } } }];
    f.requests[1].resolve(new Map([[7, latest]])); await drain();
    f.requests[0].resolve(new Map([[7, []]])); await drain(); card(); f.scan();
    expect(f.attach).toHaveBeenCalledTimes(2); expect(f.attach.mock.calls[1][3]).toEqual(latest);
  });

  it.each(['success', 'missing', 'failure'] as const)('retains the latest request even when a card returns to the same media after an old %s', async outcome => {
    const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    element.querySelector<HTMLAnchorElement>('a')!.href = '/manga/8/title'; f.scan();
    element.querySelector<HTMLAnchorElement>('a')!.href = '/anime/7/title'; f.scan(); await vi.advanceTimersByTimeAsync(800);
    expect(f.requests).toHaveLength(2);
    if (outcome === 'failure') f.requests[0].reject(new Error('Old'));
    else f.requests[0].resolve(outcome === 'missing' ? new Map() : new Map([[7, []]]));
    await drain(); expect(f.attach).not.toHaveBeenCalled(); expect(element.hasAttribute('data-au-social-processed')).toBe(true);
    f.requests[1].resolve(new Map([[7, []]])); await drain(); expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it('invalidates account/navigation requests and does not restart outside Home when preferences change', async () => {
    card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 20, timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(800); expect(f.requests).toHaveLength(2);
    f.requests[0].resolve(new Map([[7, []]])); await drain(); expect(f.attach).not.toHaveBeenCalled();
    history.replaceState({}, '', '/anime/7/title'); f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath: '/home', timestamp: new Date() });
    const registrations = f.observer.register.mock.calls.length; f.changePrefs(true); f.scan();
    f.requests[1].resolve(new Map([[7, []]])); await drain(); expect(f.attach).not.toHaveBeenCalled(); expect(f.observer.register).toHaveBeenCalledTimes(registrations);
  });

  it('only requests valid media routes on the current origin', async () => {
    const invalid = ['/character/1/anime/7', '/staff/1/manga/7', '/anime/0', '/anime/7junk', '/anime/2147483648', 'https://example.org/anime/7'];
    invalid.forEach(url => card(url)); card('/anime/9/title');
    const f = await fixture(); await vi.advanceTimersByTimeAsync(800); expect(f.service.getFriendActivityBatch.mock.calls).toEqual([[[9]]]);
    f.requests[0].resolve(new Map([[9, []]])); await drain(); expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it('expires a cache written at timestamp zero and clears pending timers when switched off', async () => {
    vi.setSystemTime(0); const element = card(); const f = await fixture(); await vi.advanceTimersByTimeAsync(800);
    vi.setSystemTime(0); f.requests[0].resolve(new Map([[7, []]])); await drain();
    f.changePrefs(false); expect(element.hasAttribute('data-au-social-media-id')).toBe(false);
    vi.setSystemTime(300001); f.changePrefs(true); expect(f.attach).toHaveBeenCalledTimes(1);
    f.changePrefs(false); await vi.advanceTimersByTimeAsync(800); expect(f.requests).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
});
