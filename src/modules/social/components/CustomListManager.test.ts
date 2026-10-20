import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomListManager } from './CustomListManager';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import type { CustomListUser } from '../CustomListService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const drain = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
const friend = (id = 1, avatar = 'https://example.com/avatar.png', name = `Friend ${id}`) => ({
  id,
  name,
  avatar: { medium: avatar },
});

describe('custom list manager ownership and mutations', () => {
  const views: CustomListManager[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    views.forEach((view) => view.unmount());
    views.length = 0;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  async function fixture(initialization = Promise.resolve(), mount = true) {
    let context = { sessionId: 'A', userId: 10 };
    let authenticated = true;
    const bus = new EventBus();
    const api = {
      getContext: () => context,
      ensureContext: async () => context,
      isAuthenticated: () => authenticated,
    };
    const followings: ReturnType<typeof deferred<ReturnType<typeof friend>[]>>[] = [];
    const social = {
      getAllFollowings: vi.fn(() => {
        const request = deferred<ReturnType<typeof friend>[]>();
        followings.push(request);
        return request.promise;
      }),
      getAllFollowers: vi.fn(async (): Promise<ReturnType<typeof friend>[]> => []),
    };
    const memberships = new Set<string>();
    const changeListeners = new Set<() => void>();
    const listData: Record<string, CustomListUser[]> = { Team: [], Other: [] };
    const lists = {
      init: vi.fn(() => initialization),
      getLists: () => listData,
      isUserInList: (name: string, id: number) => memberships.has(`${name}:${id}`),
      toggleUserInList: vi.fn(async (name: string, user: CustomListUser, active: boolean) => {
        if (active) memberships.add(`${name}:${user.id}`);
        else memberships.delete(`${name}:${user.id}`);
      }),
      createList: vi.fn(async (): Promise<void> => undefined),
      deleteList: vi.fn(async (): Promise<void> => undefined),
      onChange: vi.fn((listener: () => void) => {
        changeListeners.add(listener);
        return () => {
          changeListeners.delete(listener);
        };
      }),
    };
    const toast = { error: vi.fn() };
    const groups = {
      init: vi.fn(async (): Promise<void> => undefined),
      getConfig: () => ({ groups: [], collapsed: [], othersCollapsed: false }),
      onChange: vi.fn(() => () => undefined),
      setGroupEnabled: vi.fn(async (): Promise<void> => undefined),
      moveGroup: vi.fn(async (): Promise<void> => undefined),
      setCollapsed: vi.fn(async (): Promise<void> => undefined),
    };
    const view = new CustomListManager(
      social as never,
      lists as never,
      api as never,
      bus,
      toast as never,
      groups as never
    );
    views.push(view);
    if (mount) view.mount(document.body);
    await vi.advanceTimersByTimeAsync(0);
    await drain();
    const root = view.getElement();
    const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.click();
    return {
      view,
      root,
      lists,
      listData,
      social,
      bus,
      api,
      toast,
      followings,
      click,
      memberships,
      notifyListChange: () => {
        for (const listener of changeListeners) listener();
      },
      changeContext: (auth = true) => {
        context = { sessionId: 'B', userId: 20 };
        authenticated = auth;
      },
    };
  }
  async function manage(f: Awaited<ReturnType<typeof fixture>>, users = [friend()]) {
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    f.followings.at(-1)!.resolve(users);
    await drain();
  }

  it('starts no initialization while constructed but not mounted', async () => {
    const f = await fixture(Promise.resolve(), false);
    expect(f.lists.init).not.toHaveBeenCalled();
    f.view.mount(document.body);
    await drain();
    expect(f.lists.init).toHaveBeenCalledTimes(1);
  });

  it('does not render or attach events after unmount during initialization', async () => {
    const pending = deferred<void>();
    const f = await fixture(pending.promise);
    f.view.unmount();
    pending.resolve();
    await drain();
    expect(f.root.querySelector('.au-cl-add-list-btn')).toBeNull();
    expect(f.root.textContent).not.toContain('Team');
  });

  it('shows the latest selected list immediately while sharing a pending following request', async () => {
    const f = await fixture();
    f.click('.au-cl-manage-btn[data-list="Team"]');
    f.click('.au-cl-back-btn');
    f.root.querySelector<HTMLElement>('.au-cl-manage-btn[data-list="Other"]')!.click();
    await drain();
    expect(f.root.querySelector('.au-cl-current-list')?.textContent).toContain('Other');
    expect(f.social.getAllFollowings).toHaveBeenCalledTimes(1);
    f.followings[0].resolve([friend()]);
    await drain();
    expect(f.root.querySelector('.au-cl-current-list')?.textContent).toContain('Other');
  });

  it('clears displayed users on account change and rejects an earlier following result', async () => {
    const f = await fixture();
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    f.changeContext();
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 20,
      timestamp: new Date(),
    });
    await drain();
    f.followings[0].resolve([friend(1, undefined, 'Previous account friend')]);
    await drain();
    expect(f.root.textContent).not.toContain('Previous account friend');
    expect(f.root.querySelector('.au-cl-current-list')).toBeNull();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    f.view.unmount();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });

  it('retains a successful empty following result across list selection', async () => {
    const f = await fixture();
    await manage(f, []);
    f.click('.au-cl-back-btn');
    f.click('.au-cl-manage-btn[data-list="Other"]');
    await drain();
    expect(f.social.getAllFollowings).toHaveBeenCalledTimes(1);
    expect(f.root.querySelector('.au-cl-empty')?.textContent).toContain('No users found');
  });

  it('groups followings first, excludes overlapping followers, then shows saved manual users', async () => {
    const f = await fixture();
    f.social.getAllFollowers.mockResolvedValue([
      friend(1, undefined, 'Duplicate from followers'),
      friend(3, undefined, 'Follower only'),
    ]);
    f.listData.Other.push({
      id: 4,
      name: 'Added manually',
      avatar: 'https://example.com/manual.png',
    });
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    f.followings[0].resolve([
      friend(1, undefined, 'Following and follower'),
      friend(2, undefined, 'Following only'),
    ]);
    await drain();
    expect(
      [...f.root.querySelectorAll<HTMLElement>('.au-cl-user-group')].map(
        (group) => group.dataset.userGroup
      )
    ).toEqual(['following', 'followers', 'manual']);
    expect([...f.root.querySelectorAll('.au-cl-name')].map((user) => user.textContent)).toEqual([
      'Following and follower',
      'Following only',
      'Follower only',
      'Added manually',
    ]);
    f.root.querySelector<HTMLElement>('.au-cl-user-card[data-user-id="4"]')!.click();
    await drain();
    expect(f.lists.toggleUserInList).toHaveBeenCalledWith(
      'Team',
      { id: 4, name: 'Added manually', avatar: 'https://example.com/manual.png' },
      true
    );
  });

  it('prevents duplicate pending membership writes and reverts failed optimism with retry', async () => {
    const f = await fixture();
    await manage(f);
    const pending = deferred<void>();
    f.lists.toggleUserInList.mockImplementationOnce(() => pending.promise);
    const card = f.root.querySelector<HTMLElement>('.au-cl-user-card')!;
    card.click();
    card.click();
    expect(f.lists.toggleUserInList).toHaveBeenCalledTimes(1);
    pending.reject(new Error('disk full'));
    await drain();
    expect(f.root.querySelector('.au-cl-user-card')?.classList.contains('active')).toBe(false);
    expect(f.toast.error).toHaveBeenCalledTimes(1);
    f.click('.au-cl-user-card');
    await drain();
    expect(f.lists.toggleUserInList).toHaveBeenCalledTimes(2);
  });

  it('does not allow stale detached rows to write into another list', async () => {
    const f = await fixture();
    await manage(f);
    const card = f.root.querySelector<HTMLElement>('.au-cl-user-card')!;
    f.click('.au-cl-back-btn');
    f.click('.au-cl-manage-btn[data-list="Other"]');
    await drain();
    card.click();
    expect(f.lists.toggleUserInList).not.toHaveBeenCalled();
  });

  it('rejects actions after a silent session change even before an auth event', async () => {
    const f = await fixture();
    await manage(f);
    f.changeContext();
    f.click('.au-cl-user-card');
    expect(f.lists.toggleUserInList).not.toHaveBeenCalled();
  });

  it('encodes profile links and prevents the new tab from controlling its opener', async () => {
    const f = await fixture();
    await manage(f, [friend(1, undefined, 'name/with ?#')]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    f.click('.au-cl-avatar');
    expect(open).toHaveBeenCalledWith(
      'https://anilist.co/user/name%2Fwith%20%3F%23/',
      '_blank',
      'noopener,noreferrer'
    );
    expect(f.lists.toggleUserInList).not.toHaveBeenCalled();
  });

  it('keeps untrusted avatar URLs from introducing other CSS declarations', async () => {
    const f = await fixture();
    await manage(f, [
      friend(
        1,
        "https://example.com/x'); color:red; background-image:url('https://evil.invalid/')"
      ),
    ]);
    const avatar = f.root.querySelector<HTMLElement>('.au-cl-avatar')!;
    expect(avatar.style.color).toBe('');
  });

  it('contains initialization errors and permits an explicit retry', async () => {
    const f = await fixture(Promise.reject(new Error('lists unavailable')));
    expect(f.root.querySelector('.au-cl-retry-btn')).not.toBeNull();
    f.lists.init.mockResolvedValue(undefined);
    f.click('.au-cl-retry-btn');
    await drain();
    expect(f.lists.init).toHaveBeenCalledTimes(2);
    expect(f.root.querySelector('.au-cl-manage-btn')).not.toBeNull();
  });

  it('does not turn a failed following read into an empty result when typing and retries the read', async () => {
    const f = await fixture();
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    f.followings[0].reject(new Error('offline'));
    await drain();
    const input = f.root.querySelector<HTMLInputElement>('input')!;
    input.value = 'Friend';
    input.dispatchEvent(new Event('input'));
    expect(f.root.querySelector('.au-cl-retry-btn')).not.toBeNull();
    f.click('.au-cl-retry-btn');
    await drain();
    expect(f.followings).toHaveLength(2);
    f.followings[1].resolve([friend()]);
    await drain();
    expect(f.root.querySelector('.au-cl-name')?.textContent).toBe('Friend 1');
  });

  it('discards late following errors after unmount and releases retained controls', async () => {
    const f = await fixture();
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    const oldSearch = f.root.querySelector<HTMLInputElement>('input')!;
    f.view.unmount();
    f.followings[0].reject(new Error('late offline'));
    await drain();
    oldSearch.value = 'late';
    oldSearch.dispatchEvent(new Event('input'));
    expect(f.root.textContent).toBe('');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('preserves pending membership optimism through a search refresh and applies the final cache', async () => {
    const f = await fixture();
    await manage(f);
    const pending = deferred<void>();
    const original = f.lists.toggleUserInList.getMockImplementation()!;
    f.lists.toggleUserInList.mockImplementationOnce(async (name, user, active) => {
      await pending.promise;
      await original(name, user, active);
    });
    f.click('.au-cl-user-card');
    const input = f.root.querySelector<HTMLInputElement>('input')!;
    input.value = 'friend';
    input.dispatchEvent(new Event('input'));
    expect(f.root.querySelector('.au-cl-user-card')?.classList.contains('active')).toBe(true);
    f.click('.au-cl-user-card');
    expect(f.lists.toggleUserInList).toHaveBeenCalledTimes(1);
    pending.resolve();
    await drain();
    expect(f.root.querySelector('.au-cl-user-card')?.classList.contains('active')).toBe(true);
  });

  it('does not publish failed writes or callbacks into a remounted component', async () => {
    const f = await fixture();
    await manage(f);
    const pending = deferred<void>();
    f.lists.toggleUserInList.mockImplementationOnce(() => pending.promise);
    f.click('.au-cl-user-card');
    f.view.unmount();
    f.view.mount(document.body);
    await drain();
    pending.reject(new Error('late disk full'));
    await drain();
    expect(f.toast.error).not.toHaveBeenCalled();
    expect(f.root.querySelector('.au-cl-current-list')).toBeNull();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
  });

  it('clears displayed account data on logout and offers login without reading lists', async () => {
    const f = await fixture();
    await manage(f);
    const reads = f.lists.init.mock.calls.length;
    f.changeContext(false);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await drain();
    expect(f.root.textContent).not.toContain('Friend 1');
    expect(f.root.querySelector('.au-cl-login-btn')).not.toBeNull();
    expect(f.lists.init).toHaveBeenCalledTimes(reads);
  });

  it('prevents duplicate create/delete attempts and permits retry after a write error', async () => {
    const f = await fixture();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('New list');
    const pending = deferred<void>();
    f.lists.createList.mockImplementationOnce(() => pending.promise);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    f.click('.au-cl-add-list-btn');
    f.click('.au-cl-add-list-btn');
    f.click('.au-cl-delete-btn');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    pending.reject(new Error('failed'));
    await drain();
    expect(f.toast.error).toHaveBeenCalledTimes(1);
    f.click('.au-cl-add-list-btn');
    await drain();
    expect(f.lists.createList).toHaveBeenCalledTimes(2);
  });

  it('re-renders the open manage view when membership changes outside its own toggle', async () => {
    const f = await fixture();
    await manage(f);
    expect(f.root.querySelector('.au-cl-user-card')?.classList.contains('active')).toBe(false);
    f.memberships.add('Team:1');
    f.notifyListChange();
    await drain();
    expect(f.root.querySelector('.au-cl-user-card')?.classList.contains('active')).toBe(true);
  });

  it('re-renders the overview when lists change outside the manager', async () => {
    const f = await fixture();
    f.listData.Extra = [{ id: 9, name: 'Ninth', avatar: '' }];
    f.notifyListChange();
    await drain();
    expect(f.root.querySelector('.au-cl-list-card[data-list="Extra"]')).not.toBeNull();
  });

  it('rebuilds the grid once per membership toggle', async () => {
    const f = await fixture();
    await manage(f);
    const refresh = vi.spyOn(f.view as unknown as { refreshGrid(): void }, 'refreshGrid');
    f.click('.au-cl-user-card');
    await drain();
    expect(f.lists.toggleUserInList).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('debounces search keystrokes into a single grid rebuild', async () => {
    const f = await fixture();
    await manage(f);
    const refresh = vi.spyOn(f.view as unknown as { refreshGrid(): void }, 'refreshGrid');
    const input = f.root.querySelector<HTMLInputElement>('.au-cl-search-input')!;
    for (const value of ['F', 'Fr', 'Fri']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded groups visible and notes the unavailable one when a group fails to load', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const f = await fixture();
    f.social.getAllFollowers.mockResolvedValue([friend(3, undefined, 'Follower only')]);
    f.click('.au-cl-manage-btn[data-list="Team"]');
    await drain();
    f.followings[0].reject(new Error('Pagination limit'));
    await drain();
    expect(
      [...f.root.querySelectorAll<HTMLElement>('.au-cl-user-group')].map(
        (group) => group.dataset.userGroup
      )
    ).toEqual(['followers']);
    expect([...f.root.querySelectorAll('.au-cl-name')].map((user) => user.textContent)).toEqual([
      'Follower only',
    ]);
    expect(f.root.querySelector('.au-cl-group-note')?.textContent).toContain(
      'Following list is truncated or unavailable'
    );
    expect(f.root.querySelector('.au-cl-group-note .au-cl-retry-btn')).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('does not use another session for a prompt or confirm opened in the previous account', async () => {
    const f = await fixture();
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      f.changeContext();
      return 'New list';
    });
    f.click('.au-cl-add-list-btn');
    expect(f.lists.createList).not.toHaveBeenCalled();
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 20,
      timestamp: new Date(),
    });
    await drain();
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      f.view.unmount();
      return true;
    });
    f.click('.au-cl-delete-btn');
    expect(f.lists.deleteList).not.toHaveBeenCalled();
  });
});
