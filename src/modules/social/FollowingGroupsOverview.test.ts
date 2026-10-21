import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { CustomLists } from './CustomListService';
import type { FollowingMediaResult } from './FollowingMediaReader';
import { FollowingGroupsModule } from './FollowingGroupsModule';
import { FOLLOWING_GROUPS_KEY, FollowingGroupsService } from './FollowingGroupsService';

const row = (name: string) =>
  `<a class="follow" href="/user/${name}/"><div class="name">${name}</div><div class="status">Watching</div><div class="score">7</div><span class="hover-icon"><svg data-icon="comment"></svg></span></a>`;
const user = (name: string, id = 1) => ({ id, name, avatar: '' });
const entry = (name: string, id: number) => ({
  userId: id,
  name,
  avatar: 'https://example.com/a.png',
  status: 'CURRENT',
  score: 80,
});
const NAMES = ['ann', 'bob', 'carol', 'dan', 'eve'];

describe('Following groups on the title overview', () => {
  let module: FollowingGroupsModule;
  let bus: EventBus;
  let data: Record<string, unknown>;
  let lists: CustomLists;
  let viewerName: string;
  const media = {
    read: vi.fn(
      async (_mediaId: number): Promise<FollowingMediaResult> => ({ entries: [], scoreFormat: 'POINT_100' })
    ),
  };
  const settle = async () => {
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const rowOf = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('.follow')].find(
      (element) => element.querySelector('.name')?.textContent === name
    )!;
  /** Visual order is CSS order: a clone is appended last in the DOM but can rank first. */
  const visibleRows = () =>
    [...document.querySelectorAll<HTMLElement>('.follow')]
      .filter((element) => !element.classList.contains('au-following-group-hidden'))
      .sort((a, b) => Number(a.style.order) - Number(b.style.order));
  const namesOf = (rows: HTMLElement[]) => rows.map((element) => element.querySelector('.name')?.textContent);

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
    history.replaceState({}, '', '/anime/1/title');
    document.body.innerHTML = `<section><div class="section-header">Following</div><div class="users">${NAMES.map(row).join('')}</div></section>`;
    data = storage({ [FOLLOWING_GROUPS_KEY]: { groups: ['Team'], collapsed: [], othersCollapsed: false } });
    lists = { Team: [user('zed', 9)] };
    viewerName = 'Viewer';
    const api = { isAuthenticated: () => true, getContext: () => ({ sessionId: 'A', userId: 1 }),
      getCurrentUser: async () => ({ id: 1, name: viewerName }) };
    const listService = {
      init: vi.fn(async () => undefined),
      getLists: () => structuredClone(lists),
      onChange: vi.fn(() => () => undefined),
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

  it('shows five rows with the fetched group member first as a clone, and hides the last native row', async () => {
    media.read.mockResolvedValueOnce({ entries: [entry('zed', 9)], scoreFormat: 'POINT_100' } as never);
    await module.init();
    await settle();
    const visible = visibleRows();
    expect(namesOf(visible)).toEqual(['zed', 'ann', 'bob', 'carol', 'dan']);
    const clone = visible[0];
    expect(clone.classList.contains('au-following-clone')).toBe(true);
    expect(clone.getAttribute('href')).toBe('/user/zed/');
    expect(clone.querySelector('.status')?.textContent).toBe('Watching');
    expect(clone.querySelector('.score')?.textContent).toBe('80');
    expect(clone.querySelector('.hover-icon')).toBeNull();
    expect(rowOf('eve').classList.contains('au-following-group-hidden')).toBe(true);
    expect(document.querySelectorAll('.au-following-group-header')).toHaveLength(0);
    expect(media.read).toHaveBeenCalledTimes(1);
  });

  it('puts the viewer before group members while retaining the overview limit', async () => {
    viewerName = 'EVE';
    media.read.mockResolvedValueOnce({ entries: [entry('zed', 9)], scoreFormat: 'POINT_100' } as never);
    await module.init(); await settle();
    expect(namesOf(visibleRows())).toEqual(['eve', 'zed', 'ann', 'bob', 'carol']);
    expect(document.querySelector('.au-following-group-header')).toBeNull();
  });

  it('pins a native viewer row without fetching any additional members when groups are disabled', async () => {
    viewerName = 'eve'; delete data[FOLLOWING_GROUPS_KEY];
    await module.init(); await settle();
    expect(namesOf(visibleRows())).toEqual(['eve', 'ann', 'bob', 'carol', 'dan']);
    expect(media.read).not.toHaveBeenCalled();
  });

  it('makes no fetch and changes nothing when no enabled group is configured', async () => {
    delete data[FOLLOWING_GROUPS_KEY];
    await module.init();
    await settle();
    expect(media.read).not.toHaveBeenCalled();
    expect(visibleRows()).toHaveLength(5);
    expect(document.querySelectorAll('.au-following-clone')).toHaveLength(0);
    expect(document.querySelectorAll('.au-following-group-hidden')).toHaveLength(0);
  });

  it('does nothing when the fetched result holds no group member', async () => {
    media.read.mockResolvedValueOnce({ entries: [entry('stranger', 8)], scoreFormat: 'POINT_100' } as never);
    await module.init();
    await settle();
    expect(media.read).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.au-following-clone')).toHaveLength(0);
    expect(document.querySelectorAll('.au-following-group-hidden')).toHaveLength(0);
    expect(rowOf('ann').style.order).toBe('');
  });

  it('removes the clones when the viewer moves from the overview to the social tab', async () => {
    media.read.mockResolvedValueOnce({ entries: [entry('zed', 9)], scoreFormat: 'POINT_100' } as never);
    await module.init();
    await settle();
    expect(document.querySelectorAll('.au-following-clone')).toHaveLength(1);
    history.replaceState({}, '', '/anime/1/title/social');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/anime/1/title/social',
      previousPath: '/anime/1/title',
      timestamp: new Date(),
    });
    await settle();
    expect(document.querySelectorAll('.au-following-clone')).toHaveLength(0);
    expect(document.querySelectorAll('.follow.au-following-group-hidden')).toHaveLength(0);
    expect(document.querySelectorAll('.follow')).toHaveLength(5);
  });

  it('does not produce mutations on a second scan of an unchanged overview', async () => {
    media.read.mockResolvedValueOnce({ entries: [entry('zed', 9)], scoreFormat: 'POINT_100' } as never);
    await module.init();
    await settle();
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    (module as unknown as { scan(): void }).scan();
    observer.takeRecords();
    (module as unknown as { scan(): void }).scan();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });
});
