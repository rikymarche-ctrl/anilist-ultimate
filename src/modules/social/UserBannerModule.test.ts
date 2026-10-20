import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { UserBannerModule } from './UserBannerModule';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const user = { id: 7, name: 'Friend', avatar: { medium: 'https://example.com/avatar.png' } };
describe('profile custom list lifecycle', () => {
  let module: UserBannerModule;
  let bus: EventBus;
  let lists: {
    init: ReturnType<typeof vi.fn>;
    getLists: ReturnType<typeof vi.fn>;
    isUserInList: ReturnType<typeof vi.fn>;
    toggleUserInList: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
  };
  let listChanged = null as (() => void) | null;
  let social: { getFullUser: ReturnType<typeof vi.fn>; getViewerId: ReturnType<typeof vi.fn> };
  let observer: { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    history.replaceState({}, '', '/user/Friend');
    document.body.innerHTML =
      '<div class="banner-content"><div class="actions"><div class="nav-btn">Follow</div></div></div>';
    bus = new EventBus();
    listChanged = null;
    lists = {
      init: vi.fn(async () => {}),
      getLists: vi.fn(() => ({ Friends: [] })),
      isUserInList: vi.fn(() => false),
      toggleUserInList: vi.fn(async () => {}),
      onChange: vi.fn((listener: () => void) => {
        listChanged = listener;
        return () => {
          listChanged = null;
        };
      }),
    };
    social = { getFullUser: vi.fn(async () => user), getViewerId: vi.fn(async () => 1) };
    observer = { register: vi.fn(), unregister: vi.fn() };
    module = new UserBannerModule(
      { isAuthenticated: () => true } as never,
      lists as never,
      social as never,
      observer as never,
      { error: vi.fn() } as never,
      bus
    );
  });
  afterEach(async () => {
    await module.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });
  const button = async () => {
    await module.init();
    await vi.waitFor(() => expect(document.querySelector('.au-banner-list-btn')).not.toBeNull());
    return document.querySelector<HTMLElement>('.au-banner-list-btn')!;
  };
  it('does not register observers after destroy during initialization', async () => {
    const ready = deferred<void>();
    lists.init.mockReturnValueOnce(ready.promise);
    const pending = module.init();
    await module.destroy();
    ready.resolve();
    await pending;
    expect(observer.register).not.toHaveBeenCalled();
  });
  it('does not inject a button after destroy while fetching a profile', async () => {
    const response = deferred<typeof user>();
    social.getFullUser.mockReturnValueOnce(response.promise);
    await module.init();
    await module.destroy();
    response.resolve(user);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.au-banner-list-btn')).toBeNull();
  });
  it('removes buttons, popovers and outside-click listeners on navigation', async () => {
    const btn = await button();
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('.au-banner-popover')).not.toBeNull());
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    history.replaceState({}, '', '/anime/1');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath: '/home',
      timestamp: new Date(),
    });
    expect(abort).toHaveBeenCalled();
    expect(document.querySelector('.au-banner-popover')).toBeNull();
    expect(document.querySelector('.au-banner-list-btn')).toBeNull();
  });
  it('activates after a later login instead of staying dormant from a logged-out start', async () => {
    let authenticated = false;
    await module.destroy();
    module = new UserBannerModule(
      { isAuthenticated: () => authenticated } as never,
      lists as never,
      social as never,
      observer as never,
      { error: vi.fn() } as never,
      bus
    );
    await module.init();
    expect(lists.init).not.toHaveBeenCalled();
    expect(document.querySelector('.au-banner-list-btn')).toBeNull();
    authenticated = true;
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 2,
      timestamp: new Date(),
    });
    await vi.waitFor(() => expect(document.querySelector('.au-banner-list-btn')).not.toBeNull());
    expect(lists.init).toHaveBeenCalledTimes(1);
  });
  it('ignores a second click on a popover row while its toggle is pending', async () => {
    const btn = await button();
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('.au-popover-item')).not.toBeNull());
    const response = deferred<void>();
    lists.toggleUserInList.mockReturnValueOnce(response.promise);
    const item = document.querySelector<HTMLElement>('.au-popover-item')!;
    item.click();
    item.click();
    expect(lists.toggleUserInList).toHaveBeenCalledTimes(1);
    response.resolve();
    await vi.waitFor(() => expect(item.classList.contains('active')).toBe(true));
    expect(item.classList.contains('active')).toBe(true);
  });
  it('re-renders the open popover and button when lists change outside the popover', async () => {
    const btn = await button();
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('.au-popover-item')).not.toBeNull());
    expect(document.querySelector('.au-popover-item')?.classList.contains('active')).toBe(false);
    lists.isUserInList.mockImplementation((name: string) => name === 'Friends');
    listChanged?.();
    expect(document.querySelector('.au-popover-item')?.classList.contains('active')).toBe(true);
    expect(btn.classList.contains('au-in-list')).toBe(true);
  });
  it('captures the clicked profile before an asynchronous list update', async () => {
    const btn = await button();
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('.au-popover-item')).not.toBeNull());
    const response = deferred<void>();
    lists.toggleUserInList.mockReturnValueOnce(response.promise);
    document.querySelector<HTMLElement>('.au-popover-item')!.click();
    history.replaceState({}, '', '/user/Another');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath: '/home',
      timestamp: new Date(),
    });
    response.resolve();
    await Promise.resolve();
    expect(lists.toggleUserInList).toHaveBeenCalledWith(
      'Friends',
      { id: 7, name: 'Friend', avatar: user.avatar.medium },
      true
    );
  });
});
