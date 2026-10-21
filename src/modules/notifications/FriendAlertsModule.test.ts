import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { FriendAlertsModule } from './FriendAlertsModule';
import { emptyFriendAlerts, type FriendAlertsState } from './FriendAlerts';

function fixture(initialEnabled = true) {
  let session = 'one';
  let signedIn = true;
  let state: FriendAlertsState = emptyFriendAlerts();
  const auth = {
    ensureInitialized: async () => {},
    getSessionId: () => session,
    hasToken: () => signedIn,
  };
  const observer = { register: vi.fn(), unregister: vi.fn() };
  const bus = new EventBus();
  const lists = { init: vi.fn(async () => {}), getLists: () => ({ 'Best Friends': [{ id: 2 }] }) };
  let enabled = initialEnabled;
  const changes = new Set<() => Promise<void>>();
  const config = {
    isFeatureEnabled: () => enabled,
    onChange: (_key: string, callback: () => Promise<void>) => {
      changes.add(callback);
      return () => {
        changes.delete(callback);
      };
    },
  };
  const module = new FriendAlertsModule(
    bus,
    auth as never,
    lists as never,
    observer as never,
    config as never
  );
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: {
    operation: string;
    value?: { mediaId?: number; list?: string };
  }) => {
    if (message.operation === 'watch')
      state.rules.push({
        mediaId: message.value!.mediaId!,
        title: 'Title',
        list: message.value!.list || null,
        mediaType: 'ANIME',
        since: 1000,
        checkedAt: 0,
      });
    if (message.operation === 'read')
      state.alerts.forEach((alert) => {
        alert.read = true;
      });
    return { success: true, data: structuredClone(state) };
  }) as never);
  return {
    module,
    bus,
    observer,
    state,
    setEnabled: async (value: boolean) => {
      enabled = value;
      await Promise.all([...changes].map((callback) => callback()));
    },
    configListeners: () => changes.size,
    switchAccount: () => {
      session = 'two';
      state = emptyFriendAlerts();
    },
    logout: () => {
      signedIn = false;
      session = 'out';
    },
  };
}
function click(text: string): void {
  const target = [...document.querySelectorAll('button')].find(
    (button) =>
      button.textContent === text ||
      button.getAttribute('aria-label') === text ||
      (text.startsWith('Friend alerts') && button.classList.contains('au-friend-alerts-bell'))
  );
  if (!target) throw new Error(`Missing button ${text}`);
  target.click();
}
describe('friend alerts independent UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    history.replaceState({}, '', '/anime/10/title/');
    document.body.innerHTML =
      '<div class="media"><div class="header"><h1>Title</h1><div class="actions"><div class="list">Watching</div><button class="favourite">Heart</button></div></div></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });
  it('starts disabled without UI, refresh timers or inbox requests, then activates without reloading', async () => {
    const f = fixture(false);
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-watch')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(f.observer.register).not.toHaveBeenCalled();
    await f.setEnabled(true);
    expect(document.querySelectorAll('.au-friend-alerts-watch')).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    await f.setEnabled(false);
    expect(document.querySelector('.au-friend-alerts-watch')).toBeNull();
    expect(document.querySelector('.au-friend-alerts')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(requests);
    await f.setEnabled(true);
    expect(document.querySelectorAll('.au-friend-alerts-watch')).toHaveLength(1);
    await f.module.destroy();
    expect(f.configListeners()).toBe(0);
    await f.setEnabled(true);
    expect(document.querySelector('.au-friend-alerts-watch')).toBeNull();
  });
  it('removes the notification inbox immediately and restores saved subscriptions when reenabled', async () => {
    history.replaceState({}, '', '/notifications/#friend-alerts');
    document.body.innerHTML =
      '<div class="notifications"><div class="notification">Native</div></div>';
    const f = fixture();
    f.state.rules.push({
      mediaId: 10,
      title: 'Saved title',
      mediaType: 'ANIME',
      list: 'Best Friends',
      since: 1000,
      checkedAt: 0,
    });
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-inbox')).not.toBeNull();
    await f.setEnabled(false);
    expect(document.querySelector('.au-friend-alerts-inbox')).toBeNull();
    expect(document.querySelector('.notifications')?.textContent).toBe('Native');
    expect(f.state.rules).toHaveLength(1);
    await f.setEnabled(true);
    // The #friend-alerts hash was consumed by the first activation; re-enabling is not a navigation.
    click('Friend alerts');
    document.querySelector<HTMLButtonElement>('#au-friend-alerts-tab-following')!.click();
    expect(document.querySelector('.au-friend-alerts-rule')?.textContent).toContain('Saved title');
    await f.module.destroy();
  });
  it('discards a pending inbox response after disabling, including when the feature is enabled again', async () => {
    const f = fixture();
    await f.module.init();
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      (() =>
        new Promise((resolve) => {
          finish = resolve;
        })) as never
    );
    await vi.advanceTimersByTimeAsync(60000);
    await f.setEnabled(false);
    await f.setEnabled(true);
    finish({
      success: true,
      data: {
        ...emptyFriendAlerts(),
        rules: [
          {
            mediaId: 10,
            title: 'Stale subscription',
            mediaType: 'ANIME',
            list: null,
            since: 1000,
            checkedAt: 0,
          },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.rules).toEqual([]);
    expect(document.querySelectorAll('.au-friend-alerts-watch')).toHaveLength(1);
    expect(document.querySelector('.au-friend-alerts-watch')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
    await f.module.destroy();
  });
  it('offers following and custom lists from a title without Astra UI', async () => {
    const f = fixture();
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-bell')).toBeNull();
    expect(document.querySelector('.au-friend-alerts')).toBeNull();
    expect(document.querySelector('.au-friend-alerts-watch')?.textContent).toBe('');
    expect(document.querySelector('.au-friend-alerts-watch')?.getAttribute('aria-label')).toBe(
      'Friend alerts'
    );
    document.querySelector<HTMLButtonElement>('.au-friend-alerts-watch')!.click();
    await vi.advanceTimersByTimeAsync(0);
    const select = document.querySelector('select')!;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'People I follow',
      'Best Friends (1)',
    ]);
    select.value = 'Best Friends';
    click('Enable alert');
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MSG.FRIEND_ALERTS,
      operation: 'watch',
      value: { mediaId: 10, list: 'Best Friends' },
      sessionId: 'one',
    });
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain(
      'Alerts enabled'
    );
    expect(document.querySelector('.au-friend-alerts-watch')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(
      document.querySelector<HTMLAnchorElement>('.au-friend-alerts-panel a')?.getAttribute('href')
    ).toBe('/notifications/#friend-alerts');
    await f.module.destroy();
  });
  it('counts unread activity and marks it read without touching native notifications', async () => {
    history.replaceState({}, '', '/notifications');
    const f = fixture();
    f.state.alerts.push({
      id: 7,
      mediaId: 10,
      userId: 2,
      userName: '<img src=x onerror=alert(1)>',
      title: 'Title',
      status: 'watched episode',
      progress: '3',
      createdAt: 1050,
      read: false,
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="notifications"><div class="notification">Native alert</div></div>'
    );
    await f.module.init();
    click('Friend alerts · 1');
    expect(document.querySelector('.au-friend-alerts-panel img')).toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>('.au-friend-alerts-item a')?.getAttribute('href')
    ).toBe('/activity/7/');
    click('Mark all read');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-bell')?.textContent).toBe('Friend alerts');
    expect(document.querySelector('.notifications > .notification')?.textContent).toBe(
      'Native alert'
    );
    expect(document.querySelector('.notifications > .au-friend-alerts-inbox')).not.toBeNull();
    await f.module.destroy();
  });
  it('clears the old inbox immediately on account change and ignores a pending response', async () => {
    history.replaceState({}, '', '/notifications');
    document.body.innerHTML = '<div class="notifications"></div>';
    const f = fixture();
    await f.module.init();
    click('Friend alerts');
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      (() =>
        new Promise((resolve) => {
          finish = resolve;
        })) as never
    );
    click('Check now');
    await vi.advanceTimersByTimeAsync(0);
    f.switchAccount();
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 3,
      timestamp: new Date(),
    });
    finish({
      success: true,
      data: {
        ...emptyFriendAlerts(),
        alerts: [
          {
            id: 7,
            mediaId: 10,
            userId: 2,
            userName: 'Old private context',
            title: 'Old title',
            status: 'watched',
            progress: '',
            createdAt: 1050,
            read: false,
          },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    click('Friend alerts');
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).not.toContain(
      'Old private context'
    );
    await f.module.destroy();
  });
  it('shows login guidance when signed out and retires listeners, timers and DOM', async () => {
    const f = fixture();
    f.logout();
    await f.module.init();
    document.querySelector<HTMLButtonElement>('.au-friend-alerts-watch')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain(
      'Sign in through the extension'
    );
    await f.module.destroy();
    expect(document.querySelector('.au-friend-alerts')).toBeNull();
    expect(document.querySelector('.au-friend-alerts-watch')).toBeNull();
    expect(document.querySelector('.actions')?.classList.contains('au-friend-alerts-actions')).toBe(
      false
    );
    expect(f.observer.unregister).toHaveBeenCalledWith('friendAlerts');
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('supports Escape and moves the title action during SPA navigation', async () => {
    const f = fixture();
    await f.module.init();
    const trigger = document.querySelector<HTMLButtonElement>('.au-friend-alerts-watch')!;
    trigger.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.au-friend-alerts-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    history.replaceState({}, '', '/home');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/home',
      previousPath: '/anime/10/title/',
      timestamp: new Date(),
    });
    expect(document.querySelector('.au-friend-alerts-watch')).toBeNull();
    expect(document.querySelectorAll('.au-friend-alerts-bell')).toHaveLength(0);
    expect(document.querySelector('.au-friend-alerts')).toBeNull();
    await f.module.destroy();
  });
  it('shows write failures without claiming the subscription succeeded', async () => {
    const f = fixture();
    await f.module.init();
    document.querySelector<HTMLButtonElement>('.au-friend-alerts-watch')!.click();
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: false });
    click('Enable alert');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Unable to update');
    expect(document.querySelector('.au-friend-alerts-watch')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
    await f.module.destroy();
  });
  it('opens the inbox from its notification link and remounts after the native container is replaced', async () => {
    history.replaceState({}, '', '/notifications/#friend-alerts');
    document.body.innerHTML =
      '<div class="notifications"><article class="notification">Native</article></div>';
    const f = fixture();
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-panel')).not.toBeNull();
    document.querySelector('.notifications')!.outerHTML =
      '<div class="notifications"><article class="notification">New native</article></div>';
    f.observer.register.mock.calls[0][1]();
    expect(document.querySelectorAll('.notifications > .au-friend-alerts')).toHaveLength(1);
    await f.module.destroy();
    expect(document.querySelector('.notifications')?.textContent).toBe('New native');
  });
  it('separates activity from followed titles and paginates without a title cap', async () => {
    history.replaceState({}, '', '/notifications/#friend-alerts');
    document.body.innerHTML = '<div class="notifications"></div>';
    const f = fixture();
    f.state.rules = Array.from({ length: 42 }, (_, index) => ({
      mediaId: index + 100,
      title: `Title ${String(index).padStart(2, '0')}`,
      mediaType: 'ANIME',
      list: 'Best Friends',
      since: 1000,
      checkedAt: 0,
    }));
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-panel h2')).toBeNull();
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain(
      'You’re all caught up'
    );
    expect(document.querySelectorAll('.au-friend-alerts-rule')).toHaveLength(0);
    const tab = document.querySelector<HTMLButtonElement>('#au-friend-alerts-tab-activity')!;
    const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.length;
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.activeElement?.id).toBe('au-friend-alerts-tab-following');
    expect(
      document.querySelector('#au-friend-alerts-tab-following')?.getAttribute('aria-selected')
    ).toBe('true');
    expect(document.querySelectorAll('.au-friend-alerts-rule')).toHaveLength(25);
    expect(document.querySelector('.au-friend-alerts-pagination')?.textContent).toContain(
      '1–25 of 42'
    );
    click('Next');
    expect(document.querySelectorAll('.au-friend-alerts-rule')).toHaveLength(17);
    expect(document.querySelector('.au-friend-alerts-pagination')?.textContent).toContain(
      '26–42 of 42'
    );
    expect(
      [...document.querySelectorAll('button')].find((button) => button.textContent === 'Next')
        ?.disabled
    ).toBe(true);
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.length).toBe(requests);
    await f.module.destroy();
  });
});


describe('friend alerts inbox regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // 1000 s
    history.replaceState({}, '', '/notifications/#friend-alerts');
    document.body.innerHTML = '<div class="notifications"><article class="notification">Native</article></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('sends Check now as a user check and says when a recent check was throttled', async () => {
    const f = fixture();
    f.state.lastPoll = 990;
    await f.module.init();
    click('Check now');
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MSG.FRIEND_ALERTS,
      operation: 'poll',
      value: { manual: true },
      sessionId: 'one',
    });
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain(
      'Checked recently — try again in 20s'
    );
    await f.module.destroy();
  });

  it('confirms a check that ran', async () => {
    const f = fixture();
    f.state.lastPoll = 1000;
    await f.module.init();
    click('Check now');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain('Check requested.');
    await f.module.destroy();
  });

  it('shows the catch-up notice only while a group backlog page is unfinished', async () => {
    const f = fixture();
    f.state.rules.push({ mediaId: 10, title: 'Title', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0,
      scan: { since: 1000, until: 1200, page: 3 } });
    f.state.groups = [{ mediaIds: [10], audience: 'following', since: 1000, until: 1200, page: 1, recentAfter: 0, complete: false }];
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).not.toContain('Catching up');
    await f.module.destroy();

    const next = fixture();
    next.state.rules.push({ mediaId: 10, title: 'Title', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 });
    next.state.groups = [{ mediaIds: [10], audience: 'following', since: 1000, until: 1200, page: 2, recentAfter: 0, complete: false }];
    await next.module.init();
    expect(document.querySelector('.au-friend-alerts-panel')?.textContent).toContain('Catching up');
    await next.module.destroy();
  });

  it('consumes the inbox hash once so a closed panel stays closed when the feed remounts', async () => {
    const f = fixture();
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-panel')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.au-friend-alerts-panel')).toBeNull();
    document.querySelector('.notifications')!.outerHTML =
      '<div class="notifications"><article class="notification">New native</article></div>';
    f.observer.register.mock.calls[0][1]();
    expect(document.querySelectorAll('.notifications > .au-friend-alerts')).toHaveLength(1);
    expect(document.querySelector('.au-friend-alerts-panel')).toBeNull();
    await f.module.destroy();
  });
});

describe('friend alerts global unread indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    history.replaceState({}, '', '/home');
    document.body.innerHTML = '<nav class="nav"><div class="user"><a class="avatar" href="/user/Me">Me</a>'
      + '<a class="notification-dot" href="/notifications">2</a></div></nav>';
  });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
  const unreadAlert = (id: number) => ({ id, mediaId: 10, userId: 2, userName: 'Friend', title: 'Title',
    status: 'watched', progress: '1', createdAt: 1050, read: false });

  it('shows persisted unread alerts on the home page and refreshes from background broadcasts', async () => {
    const f = fixture(); f.state.alerts.push(unreadAlert(1));
    await f.module.init();
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.textContent).toBe('1');
    expect(document.querySelector('.au-friend-alerts')).toBeNull();
    f.state.alerts.push(unreadAlert(2));
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    listener({ type: MSG.LOCAL_CHANGED, keys: ['friend_alerts_account_1'] }, {}, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.textContent).toBe('2');
    await f.setEnabled(false);
    expect(document.querySelector('.au-friend-alerts-nav-badge')).toBeNull();
    await f.setEnabled(true);
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.textContent).toBe('2');
    f.state.alerts.forEach(alert => { alert.read = true; });
    listener({ type: MSG.LOCAL_CHANGED, keys: ['friend_alerts_account_1'] }, {}, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-nav-badge')).toBeNull();
    expect(document.querySelector('.notification-dot')?.textContent).toBe('2');
    await f.module.destroy();
  });
  it('refreshes the unread count when returning to a visible tab', async () => {
    const f = fixture();
    await f.module.init();
    f.state.alerts.push(unreadAlert(1));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.textContent).toBe('1');
    await f.module.destroy();
    vi.restoreAllMocks();
  });
  it('opens a closed inbox on the notifications page without marking anything read', async () => {
    history.replaceState({}, '', '/notifications/#friend-alerts');
    document.body.insertAdjacentHTML('beforeend', '<div class="notifications"></div>');
    const f = fixture(); f.state.alerts.push(unreadAlert(1));
    await f.module.init();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.au-friend-alerts-panel')).toBeNull();
    document.querySelector<HTMLAnchorElement>('.au-friend-alerts-nav-badge')!.click();
    expect(document.querySelector('.au-friend-alerts-panel')).not.toBeNull();
    expect(f.state.alerts[0].read).toBe(false);
    click('Mark all read');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.au-friend-alerts-nav-badge')).toBeNull();
    expect(document.querySelector('.notification-dot')?.textContent).toBe('2');
    await f.module.destroy();
  });
  it('clears the previous account immediately on logout and removes its UI when disabled', async () => {
    const f = fixture(); f.state.alerts.push(unreadAlert(1));
    await f.module.init();
    f.logout(); f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(document.querySelector('.au-friend-alerts-nav-badge')).toBeNull();
    expect(document.querySelector('.user')?.className).toBe('user');
    await f.setEnabled(false);
    expect(document.querySelector('.notification-dot')?.textContent).toBe('2');
    expect(vi.getTimerCount()).toBe(0);
    await f.module.destroy();
  });
});
