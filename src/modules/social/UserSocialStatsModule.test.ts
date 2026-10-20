import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { UserSocialStatsModule } from './UserSocialStatsModule';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((pass) => {
    resolve = pass;
  });
  return { promise, resolve };
}

const counts = { following: 3, followers: 5 };
const navMarkup =
  '<div class="header"><div class="nav container"><a class="link">Social</a></div></div>';

describe('user social stats injection', () => {
  let social: { getFullUser: ReturnType<typeof vi.fn> };
  let bus: EventBus;
  let module: UserSocialStatsModule;

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/user/Friend');
    document.body.innerHTML = navMarkup;
    social = { getFullUser: vi.fn(async () => counts) };
    bus = new EventBus();
    module = new UserSocialStatsModule(social as never, bus);
  });
  afterEach(async () => {
    await module.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not write counts for a profile the user navigated away from during the request', async () => {
    const response = deferred<typeof counts>();
    social.getFullUser.mockReturnValueOnce(response.promise);
    await module.init();
    history.replaceState({}, '', '/user/Other');
    response.resolve(counts);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-nav-count')).toBeNull();
  });

  it('waits for a cached profile navigation to render before injecting counts', async () => {
    document.body.innerHTML = '';
    await module.init();
    await vi.advanceTimersByTimeAsync(0);
    document.body.innerHTML = navMarkup;
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('.au-nav-count')?.textContent).toBe(' (8)');
  });

  it('does not mark a profile processed until its target renders, so a later page change retries it', async () => {
    document.body.innerHTML = '';
    await module.init();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(document.querySelector('.au-nav-count')).toBeNull();
    document.body.innerHTML = navMarkup;
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath: '/user/Friend',
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.au-nav-count')?.textContent).toBe(' (8)');
  });
});
