import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { CustomLists } from './CustomListService';
import type { FollowingMediaResult } from './FollowingMediaReader';
import {
  FollowingGroupsModule,
  isFollowingGroupsOverviewRoute,
  isFollowingGroupsPageRoute,
  isFollowingGroupsRoute,
} from './FollowingGroupsModule';
import { FOLLOWING_GROUPS_KEY, FollowingGroupsService } from './FollowingGroupsService';

interface TestAccess {
  scan(): void;
}
const row = (name: string) =>
  `<a class="follow" href="/user/${name}/"><div class="name">${name}</div><div class="status">Watching</div><div class="score">7</div><span class="hover-icon"><svg data-icon="comment"></svg></span></a>`;
const user = (name: string, id = 1) => ({ id, name, avatar: '' });

describe('Following groups module on the social tab', () => {
  let module: FollowingGroupsModule;
  let bus: EventBus;
  let data: Record<string, unknown>;
  let lists: CustomLists;
  let listeners: Set<() => void>;
  const media = {
    read: vi.fn(
      async (_mediaId: number): Promise<FollowingMediaResult> => ({ entries: [], scoreFormat: 'POINT_100' })
    ),
  };
  const scan = () => (module as unknown as TestAccess).scan();
  const settle = async () => {
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const headerOf = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('.au-following-group-header')].find(
      (header) => header.querySelector('.au-following-group-label')?.textContent === label
    )!;
  const toggleOf = (label: string) =>
    headerOf(label).querySelector<HTMLButtonElement>('.au-following-group-toggle')!;
  const rowOf = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('.follow')].find(
      (element) => element.querySelector('.name')?.textContent === name
    )!;
  const orderOf = (element: Element | null | undefined) => (element as HTMLElement | null)?.style.order ?? '';
  const ownNodes = () => document.querySelectorAll('.au-following-group-header, .au-following-clone');

  function storage(initial: Record<string, unknown>) {
    vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
      Promise.resolve({ [key]: structuredClone(initial[key]) })) as never);
    vi.mocked(chrome.storage.local.set).mockImplementation(((items: Record<string, unknown>) => {
      Object.assign(initial, structuredClone(items));
      return Promise.resolve();
    }) as never);
    return initial;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    media.read.mockReset();
    media.read.mockResolvedValue({ entries: [], scoreFormat: 'POINT_100' } as never);
    history.replaceState({}, '', '/anime/1/title/social');
    document.body.innerHTML = `<section><div class="section-header">Following</div><div class="users">${row('ann')}${row('bob')}${row('carol')}</div></section>`;
    data = storage({
      [FOLLOWING_GROUPS_KEY]: { groups: ['Trusted', 'Friends'], collapsed: [], othersCollapsed: false },
    });
    lists = { Trusted: [user('bob', 2)], Friends: [user('ann'), user('dave', 4)] };
    listeners = new Set();
    const api = { isAuthenticated: () => true, getContext: () => ({ sessionId: 'A', userId: 1 }) };
    const listService = {
      init: vi.fn(async () => undefined),
      getLists: () => structuredClone(lists),
      onChange: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    };
    bus = new EventBus();
    module = new FollowingGroupsModule(
      api as never,
      listService as never,
      new FollowingGroupsService(),
      media as never,
      bus
    );
  });
  afterEach(async () => {
    await module.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('groups the column top to bottom with Others last, and never moves native rows', async () => {
    await module.init();
    await settle();
    const headers = [...document.querySelectorAll<HTMLElement>('.au-following-group-header')];
    expect(
      headers.map((header) => [
        header.querySelector('.au-following-group-label')?.textContent,
        header.querySelector('.au-following-group-count')?.textContent,
        header.style.order,
      ])
    ).toEqual([
      ['Trusted', '1', '0'],
      ['Friends', '1', '2'],
      ['Others', '1', '4'],
    ]);
    expect(['ann', 'bob', 'carol'].map((name) => [name, orderOf(rowOf(name))])).toEqual([
      ['ann', '3'],
      ['bob', '1'],
      ['carol', '5'],
    ]);
    expect(
      [...document.querySelectorAll<HTMLElement>('.follow')].map(
        (element) => element.querySelector('.name')?.textContent
      )
    ).toEqual(['ann', 'bob', 'carol']);
  });

  it('builds each header as a toggle plus, in the first header only, the edit gear', async () => {
    await module.init();
    await settle();
    const headers = [...document.querySelectorAll<HTMLElement>('.au-following-group-header')];
    expect(headers.every((header) => header.querySelector('.au-following-group-toggle'))).toBe(true);
    expect(
      headers.map((header) => header.querySelector('.au-following-group-toggle')?.getAttribute('aria-expanded'))
    ).toEqual(['true', 'true', 'true']);
    const gear = headers[0].querySelector<HTMLAnchorElement>('.au-following-groups-edit');
    expect(gear?.getAttribute('href')).toBe('/settings#au-custom-lists');
    expect(gear?.getAttribute('aria-label')).toBe('Edit groups');
    expect(document.querySelectorAll('.au-following-groups-edit')).toHaveLength(1);
    expect(headers[0].classList.contains('au-following-group-header--first')).toBe(true);
    expect(headers.slice(1).some((header) => header.classList.contains('au-following-group-header--first'))).toBe(
      false
    );
  });

  it('adds the flex fallback when the column is not already a flex or grid container', async () => {
    await module.init();
    await settle();
    const users = document.querySelector<HTMLElement>('.users')!;
    expect(users.classList.contains('au-following-grouped')).toBe(true);
    expect(users.classList.contains('au-following-grouped-flex')).toBe(true);
  });

  it('sets the header spacing from the first row margin', async () => {
    rowOf('ann').style.marginBottom = '12px';
    await module.init();
    await settle();
    expect(document.querySelector<HTMLElement>('.users')!.style.getPropertyValue('--au-fg-gap')).toBe('12px');
    expect(headerOf('Trusted').classList.contains('au-following-group-header--first')).toBe(true);
  });

  it('falls back to a 10px spacing when the rows have no bottom margin', async () => {
    await module.init();
    await settle();
    expect(document.querySelector<HTMLElement>('.users')!.style.getPropertyValue('--au-fg-gap')).toBe('10px');
  });

  it('collapses a group from its toggle, hides only its rows and persists the choice', async () => {
    await module.init();
    await settle();
    toggleOf('Trusted').click();
    await settle();
    expect(toggleOf('Trusted').getAttribute('aria-expanded')).toBe('false');
    expect(rowOf('bob').classList.contains('au-following-group-hidden')).toBe(true);
    expect(rowOf('ann').classList.contains('au-following-group-hidden')).toBe(false);
    expect(data[FOLLOWING_GROUPS_KEY]).toMatchObject({ collapsed: ['Trusted'] });
  });

  it('leaves no trace when no group is configured', async () => {
    delete data[FOLLOWING_GROUPS_KEY];
    await module.init();
    await settle();
    expect(ownNodes()).toHaveLength(0);
    expect(document.querySelector('.au-following-groups-edit')).toBeNull();
    expect(orderOf(rowOf('bob'))).toBe('');
    expect(document.querySelector<HTMLElement>('.users')!.className).toBe('users');
    expect(document.querySelector<HTMLElement>('.users')!.style.getPropertyValue('--au-fg-gap')).toBe('');
  });

  it('leaves no trace when no configured list has a visible member', async () => {
    lists = { Trusted: [user('zed', 9)] };
    await module.init();
    await settle();
    expect(ownNodes()).toHaveLength(0);
    expect(orderOf(rowOf('ann'))).toBe('');
    expect(document.querySelector('.users')!.classList.contains('au-following-grouped')).toBe(false);
  });

  it('groups rows that are appended later, through the observer', async () => {
    await module.init();
    await settle();
    document.querySelector('.users')!.insertAdjacentHTML('beforeend', row('dave'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(orderOf(rowOf('dave'))).toBe('3');
    expect(headerOf('Friends').querySelector('.au-following-group-count')?.textContent).toBe('2');
  });

  it('regroups when a list changes', async () => {
    await module.init();
    await settle();
    lists = { Trusted: [user('bob', 2), user('carol', 3)], Friends: [user('ann')] };
    listeners.forEach((listener) => listener());
    await settle();
    expect(headerOf('Trusted').querySelector('.au-following-group-count')?.textContent).toBe('2');
    expect(headerOf('Others')).toBeUndefined();
    expect(orderOf(rowOf('carol'))).toBe('1');
  });

  it('restores native orders and removes every element it added when leaving the social route', async () => {
    rowOf('ann').style.order = '7';
    await module.init();
    await settle();
    history.replaceState({}, '', '/character/1');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/character/1',
      previousPath: '/anime/1/title/social',
      timestamp: new Date(),
    });
    await settle();
    expect(ownNodes()).toHaveLength(0);
    expect(rowOf('ann').style.order).toBe('7');
    expect(rowOf('bob').classList.contains('au-following-group-hidden')).toBe(false);
    expect(document.querySelector<HTMLElement>('.users')!.className).toBe('users');
    expect(document.querySelector<HTMLElement>('.users')!.style.getPropertyValue('--au-fg-gap')).toBe('');
  });

  it('removes its elements and stops listening to list changes on destroy', async () => {
    await module.init();
    await settle();
    await module.destroy();
    expect(ownNodes()).toHaveLength(0);
    expect(listeners.size).toBe(0);
  });

  it('does not produce mutations when a scan runs on an unchanged column', async () => {
    await module.init();
    await settle();
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    scan();
    observer.takeRecords();
    scan();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it.each(['/anime/1/title/social', '/anime/1/social', '/manga/2/Title/social/'])(
    'runs the social grouping on %s',
    (path) => {
      expect(isFollowingGroupsRoute(path)).toBe(true);
      expect(isFollowingGroupsPageRoute(path)).toBe(true);
      expect(isFollowingGroupsOverviewRoute(path)).toBe(false);
    }
  );

  it.each(['/anime/1/title', '/manga/2/Title/', '/anime/16498/Attack-on-Titan'])(
    'runs the overview on %s',
    (path) => {
      expect(isFollowingGroupsOverviewRoute(path)).toBe(true);
      expect(isFollowingGroupsPageRoute(path)).toBe(true);
      expect(isFollowingGroupsRoute(path)).toBe(false);
    }
  );

  it.each([
    '/anime/1/characters',
    '/anime/1/staff',
    '/anime/1/stats',
    '/anime/1/reviews',
    '/anime/1/recommendations',
    '/anime/0/social',
    '/character/1/social',
    '/anime/1/title/social/extra',
    '/home',
  ])('ignores %s', (path) => {
    expect(isFollowingGroupsPageRoute(path)).toBe(false);
  });
});
