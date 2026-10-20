import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialSidebar } from './SocialSidebar';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus, type SocialActivityDetailed } from '@core/types';
import { logger } from '@core/logger';
import { SocialService } from '../SocialService';
import { SocialPaginationLimitError } from '../SocialResponse';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Result = { nodes: SocialActivityDetailed[]; hasNextPage: boolean };
function node(id: number, name = `Friend ${id}`, notes: string | null = 'A & B'): SocialActivityDetailed {
  return { id, status: MediaListStatus.CURRENT, progress: 4, score: 80, notes, updatedAt: Date.now() / 1000,
    user: { id, name, avatar: { medium: 'https://example.com/avatar.png' }, mediaListOptions: { scoreFormat: 'POINT_10' } } };
}
const empty = { nodes: [], hasNextPage: false };
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('social sidebar requests and ownership', () => {
  const mounted: SocialSidebar[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(logger, 'error').mockImplementation(() => undefined); });
  afterEach(() => { mounted.forEach(view => view.unmount()); mounted.length = 0; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
  async function fixture(init = Promise.resolve()) {
    const requests: ReturnType<typeof deferred<Result>>[] = [];
    const service = { getDetailedActivity: vi.fn(() => { const request = deferred<Result>(); requests.push(request); return request.promise; }) };
    const listData: Record<string, Array<{ id: number; name: string; avatar: string }>> = { Team: [{ id: 2, name: 'Friend 2', avatar: '' }] };
    const lists = { init: vi.fn(() => init), getLists: () => listData,
      getList: (name: string) => (name in listData ? [{ id: name === 'Best Friends' ? 1 : 2, name: 'Friend', avatar: '' }] : []), isUserInList: vi.fn(() => false), toggleUserInList: vi.fn(async (): Promise<void> => undefined) };
    const bus = new EventBus();
    let context = { sessionId: 'A', userId: 10 };
    const api = { getContext: () => context };
    const toast = { error: vi.fn() };
    const view = new SocialSidebar(service as never, lists as never, api as never, bus, toast as never);
    view.mount(document.body); mounted.push(view); await drain();
    const root = view.getElement();
    const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.click();
    return { view, root, requests, service, lists, listData, bus, toast, click, changeContext: () => { context = { sessionId: 'B', userId: 20 }; } };
  }

  it('starts the newest media request while the previous one is pending and ignores its late result', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.view.open(2, 'Second');
    expect(f.requests).toHaveLength(2);
    f.requests[1].resolve({ nodes: [node(2)], hasNextPage: false }); await drain();
    f.requests[0].resolve({ nodes: [node(1)], hasNextPage: true }); await drain();
    expect(f.root.querySelectorAll('.au-friend-row')).toHaveLength(1);
    expect(f.root.querySelector('.au-friend-name')?.textContent).toBe('Friend 2');
  });

  it('honors filter and status changes during a pending request', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.click('[data-type="following"]'); f.click('[data-status="COMPLETED"]');
    expect(f.service.getDetailedActivity.mock.calls).toEqual([[1, 'self', 1, 'all'], [1, 'following', 1, 'all'], [1, 'following', 1, 'COMPLETED']]);
    f.requests[2].resolve({ nodes: [node(3)], hasNextPage: false }); await drain();
    f.requests[1].reject(new Error('Old failure')); f.requests[0].resolve(empty); await drain();
    expect(f.root.querySelector('.au-friend-name')?.textContent).toBe('Friend 3');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('filters actual list users and renders note text once', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.click('[data-list-name="Team"]');
    expect(f.service.getDetailedActivity.mock.calls.at(-1)).toEqual([1, 'following', 1, 'all', [2]]);
    f.requests.at(-1)!.resolve({ nodes: [node(1), node(2, 'Friend 2', '<em>A & B</em>')], hasNextPage: false }); await drain();
    expect(f.root.querySelectorAll('.au-friend-row')).toHaveLength(1);
    expect(f.root.querySelector('.au-friend-note')?.textContent).toBe('<em>A & B</em>');
    expect(f.root.querySelector('.au-friend-note em')).toBeNull();
    f.requests[0].resolve(empty);
  });

  it('reaches custom list members beyond the first unfiltered page using the real social service', async () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({ ...node(index + 1), mediaId: 1, userId: index + 1, updatedAt: 1700000000 }));
    const api = { getContext: () => ({ sessionId: 'A', userId: 10 }), ensureContext: async () => ({ sessionId: 'A', userId: 10 }),
      isAuthenticated: () => true, getCurrentUserId: async () => 10, query: vi.fn(async (_query: string, vars: Record<string, unknown>) => {
        const selected = rows.filter(row => (vars.userId === undefined || row.userId === vars.userId)
          && (vars.userIds === undefined || (vars.userIds as number[]).includes(row.userId)));
        return { Page: { mediaList: selected.slice(0, 30), pageInfo: { hasNextPage: selected.length > 30 } } };
      }) };
    const service = new SocialService(api as never, {} as never, { create: () => ({}) } as never);
    const lists = { init: async () => undefined, getLists: () => ({ Team: [rows[30].user] }),
      getList: () => [{ ...rows[30].user, avatar: '' }], isUserInList: () => false };
    const view = new SocialSidebar(service, lists as never, api as never, new EventBus(), { error: vi.fn() } as never);
    mounted.push(view); view.mount(document.body); await drain(); view.open(1, 'First');
    view.getElement().querySelector<HTMLElement>('[data-list-name="Team"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.getElement().querySelector('.au-friend-name')?.textContent).toBe('Friend 31');
    expect(api.query.mock.calls.find(([, vars]) => vars.userIds !== undefined)?.[1]).toMatchObject({ userIds: [31], page: 1 });
  });

  it('does not let typing replace the loader with rows from a previous media', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1)], hasNextPage: false }); await drain();
    f.view.open(2, 'Second');
    const input = f.root.querySelector<HTMLInputElement>('input')!; input.value = 'friend'; input.dispatchEvent(new Event('input'));
    expect(f.root.querySelector('.au-friend-row')).toBeNull(); expect(f.root.querySelector('.au-social-loading')).not.toBeNull();
    f.requests[1].resolve(empty); await drain();
  });

  it('clears private rows and the anchor on close, and immediately allows reopening', async () => {
    const f = await fixture(); const anchor = document.createElement('div'); document.body.append(anchor);
    f.view.open(1, 'First', anchor); f.view.close();
    expect(anchor.classList.contains('au-anime-active')).toBe(false);
    f.view.open(2, 'Second'); expect(f.requests).toHaveLength(2);
    f.requests[0].resolve({ nodes: [node(1)], hasNextPage: false }); await drain();
    expect(f.root.querySelector('.au-friend-row')).toBeNull();
    f.requests[1].resolve({ nodes: [node(2)], hasNextPage: false }); await drain();
    f.view.close(); expect(f.root.querySelector('.au-friend-row')).toBeNull();
  });

  it.each(['unmount', 'navigation', 'account'] as const)('discards pending data after %s', async reason => {
    const f = await fixture(); const anchor = document.createElement('div'); f.view.open(1, 'First', anchor);
    if (reason === 'unmount') f.view.unmount();
    if (reason === 'navigation') f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/home', previousPath: '/anime/1', timestamp: new Date() });
    if (reason === 'account') { f.changeContext(); f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 20, timestamp: new Date() }); }
    f.requests[0].resolve({ nodes: [node(1)], hasNextPage: false }); await drain();
    expect(f.root.querySelector('.au-friend-row')).toBeNull(); expect(anchor.classList.contains('au-anime-active')).toBe(false);
    if (reason === 'unmount') { expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0); expect(f.bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(0); }
  });

  it('checks the account context even before an auth event is delivered', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.changeContext();
    f.requests[0].resolve({ nodes: [node(1)], hasNextPage: false }); await drain();
    expect(f.root.querySelector('.au-friend-row')).toBeNull();
  });

  it('ignores a late menu initialization after unmount, and detached controls cannot reopen it', async () => {
    const init = deferred<void>(); const f = await fixture(init.promise); const filter = f.root.querySelector<HTMLElement>('[data-type="following"]')!;
    f.view.open(1, 'First'); f.view.unmount(); init.resolve(); await drain(); filter.click(); f.view.open(2, 'Second');
    expect(f.root.querySelector('[data-list-name]')).toBeNull(); expect(f.requests).toHaveLength(1);
    f.requests[0].resolve(empty);
  });

  it('keeps paging single-flight, removes a failed page loader and retries the same page', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1)], hasNextPage: true }); await drain();
    const content = f.root.querySelector<HTMLElement>('#au-social-content')!;
    content.dispatchEvent(new Event('scroll')); content.dispatchEvent(new Event('scroll')); expect(f.requests).toHaveLength(2);
    f.requests[1].reject(new Error('Network')); await drain();
    expect(content.querySelector('#au-social-more-loader')).toBeNull(); expect(content.querySelector('.au-friend-row')).not.toBeNull();
    content.dispatchEvent(new Event('scroll')); expect(f.service.getDetailedActivity.mock.calls.at(-1)).toEqual([1, 'self', 2, 'all']);
    f.requests[2].resolve({ nodes: [node(2)], hasNextPage: false }); await drain();
    expect(content.querySelectorAll('.au-friend-row')).toHaveLength(2);
  });

  it('reports a provider cap as incomplete and stops retrying an impossible next page', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [{ ...node(1), updatedAt: 0 }], hasNextPage: true }); await drain();
    expect(f.root.querySelector('.au-friend-date')?.textContent).toBe('');
    const content = f.root.querySelector<HTMLElement>('#au-social-content')!; content.dispatchEvent(new Event('scroll'));
    f.requests[1].reject(new SocialPaginationLimitError()); await drain(); content.dispatchEvent(new Event('scroll'));
    expect(f.requests).toHaveLength(2); expect(content.querySelector('.au-friend-row')).not.toBeNull();
    expect(f.toast.error).toHaveBeenCalledWith(expect.stringContaining('incomplete'));
  });

  it('opens encoded manga and profile links with an isolated opener, and labels chapters', async () => {
    const f = await fixture(); const open = vi.spyOn(window, 'open').mockReturnValue(null);
    f.view.open(1, 'A & B', undefined, 'MANGA'); f.requests[0].resolve({ nodes: [node(1, 'A/B?#')], hasNextPage: false }); await drain();
    f.click('.au-friend-status'); f.click('.au-friend-name');
    expect(open.mock.calls).toEqual([['/user/A%2FB%3F%23/mangalist?search=A%20%26%20B', '_blank', 'noopener'], ['/user/A%2FB%3F%23', '_blank', 'noopener']]);
    expect(f.root.querySelector('.au-friend-status')?.textContent).toContain('Ch 4');
  });

  it('keeps Best Friends management out of Social Activity', async () => {
    const f = await fixture(); f.view.open(1, 'First');
    f.requests[0].resolve({ nodes: [node(10, 'Self')], hasNextPage: false }); await drain();
    expect(f.root.querySelector('.au-friend-header i')).toBeNull();
    f.click('[data-type="following"]');
    f.requests[1].resolve({ nodes: [node(1)], hasNextPage: false }); await drain();
    expect(f.root.querySelector('.au-friend-header i')).toBeNull();
    expect(f.lists.toggleUserInList).not.toHaveBeenCalled();
  });

  it('cannot append an old page or unlock a replacement request while it is pending', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1)], hasNextPage: true }); await drain();
    const content = f.root.querySelector<HTMLElement>('#au-social-content')!; content.dispatchEvent(new Event('scroll'));
    f.click('[data-type="following"]'); f.requests[1].resolve({ nodes: [node(9)], hasNextPage: false }); await drain();
    content.dispatchEvent(new Event('scroll')); expect(f.requests).toHaveLength(3);
    expect(content.querySelector('.au-friend-row')).toBeNull(); expect(content.querySelector('.au-social-loading')).not.toBeNull();
    f.requests[2].resolve({ nodes: [node(2)], hasNextPage: true }); await drain(); content.dispatchEvent(new Event('scroll'));
    expect(f.service.getDetailedActivity.mock.calls.at(-1)).toEqual([1, 'following', 2, 'all']); f.requests[3].resolve(empty);
  });

  it('rejects malformed external open events without requests or exceptions', async () => {
    const f = await fixture();
    for (const detail of [null, {}, { mediaId: 0, title: 'Bad' }, { mediaId: 1, title: {}, type: 'ANIME' }, { mediaId: 1, title: 'Bad', type: 'OTHER' }]) {
      window.dispatchEvent(new CustomEvent('au-open-social-sidebar', { detail }));
    }
    expect(f.requests).toHaveLength(0);
    window.dispatchEvent(new CustomEvent('au-open-social-sidebar', { detail: { mediaId: 2, title: 'Valid', type: 'MANGA' } }));
    expect(f.requests).toHaveLength(1); f.requests[0].resolve(empty);
  });

  it('re-reads the lists menu when the sidebar opens or the menu opens, so created and deleted lists follow', async () => {
    const f = await fixture();
    const names = () => [...f.root.querySelectorAll<HTMLElement>('[data-list-name]')].map(item => item.dataset.listName);
    f.listData.Later = [{ id: 3, name: 'Friend 3', avatar: '' }];
    f.view.open(1, 'First'); await drain();
    expect(names()).toEqual(['Team', 'Later']);
    f.requests[0].resolve(empty); await drain();
    delete f.listData.Team;
    f.click('#au-custom-lists-trigger'); await drain();
    expect(names()).toEqual(['Later']);
  });

  it('falls back to the Following feed when the selected list was deleted elsewhere', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve(empty); await drain();
    f.click('[data-list-name="Team"]'); f.requests[1].resolve(empty); await drain();
    delete f.listData.Team;
    f.view.open(2, 'Second'); await drain();
    expect(f.service.getDetailedActivity.mock.calls.at(-1)).toEqual([2, 'following', 1, 'all']);
    expect(f.root.querySelector('[data-type="following"]')?.classList.contains('active')).toBe(true);
    expect(f.root.querySelector('#au-custom-lists-trigger')?.classList.contains('active')).toBe(false);
    expect(f.root.querySelector('#au-custom-lists-trigger .au-filter-label')?.textContent).toBe('Lists');
    f.requests.forEach(request => request.resolve(empty)); await drain();
  });

  it('shows custom-list members the viewer does not follow, because the list snapshot is not narrowed by isFollowing', async () => {
    const notFollowedId = 2;
    const rows = [1, 2].map(id => ({ ...node(id, 'Friend ' + id), mediaId: 1, userId: id, updatedAt: 1700000000 }));
    const api = { getContext: () => ({ sessionId: 'A', userId: 10 }), ensureContext: async () => ({ sessionId: 'A', userId: 10 }),
      isAuthenticated: () => true, getCurrentUserId: async () => 10, query: vi.fn(async (_query: string, vars: Record<string, unknown>) => {
        const selected = rows.filter(row => (vars.isFollowing !== true || row.userId !== notFollowedId)
          && (vars.userId === undefined || row.userId === vars.userId)
          && (vars.userIds === undefined || (vars.userIds as number[]).includes(row.userId)));
        return { Page: { mediaList: selected, pageInfo: { hasNextPage: false } } };
      }) };
    const service = new SocialService(api as never, {} as never, { create: () => ({}) } as never);
    const lists = { init: async () => undefined, getLists: () => ({ Team: [] }),
      getList: () => [{ id: notFollowedId, name: 'Friend 2', avatar: '' }], isUserInList: () => false };
    const view = new SocialSidebar(service, lists as never, api as never, new EventBus(), { error: vi.fn() } as never);
    mounted.push(view); view.mount(document.body); await drain(); view.open(1, 'First');
    view.getElement().querySelector<HTMLElement>('[data-list-name="Team"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.getElement().querySelector('.au-friend-name')?.textContent).toBe('Friend 2');
    expect(api.query.mock.calls.at(-1)?.[1]).not.toHaveProperty('isFollowing');
  });

  it('auto-loads later pages while a search leaves the panel unfilled, and reaches a match inside the cap', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1, 'Alpha')], hasNextPage: true }); await drain();
    const input = f.root.querySelector<HTMLInputElement>('#au-social-search')!;
    input.value = 'zed'; input.dispatchEvent(new Event('input')); await drain();
    for (let page = 2; page <= 5; page++) {
      expect(f.requests).toHaveLength(page);
      f.requests[page - 1].resolve({ nodes: [node(page, 'Alpha ' + page)], hasNextPage: true }); await drain();
    }
    expect(f.requests).toHaveLength(6);
    f.requests[5].resolve({ nodes: [node(6, 'Zed')], hasNextPage: true }); await drain();
    expect(f.root.querySelector('.au-friend-name')?.textContent).toBe('Zed');
    expect(f.requests).toHaveLength(6);
  });

  it('stops automatic search loading at the cap and reports the search as incomplete', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1, 'Alpha')], hasNextPage: true }); await drain();
    const input = f.root.querySelector<HTMLInputElement>('#au-social-search')!;
    input.value = 'zed'; input.dispatchEvent(new Event('input')); await drain();
    for (let page = 2; page <= 6; page++) {
      expect(f.requests).toHaveLength(page);
      f.requests[page - 1].resolve({ nodes: [node(page, 'Alpha ' + page)], hasNextPage: true }); await drain();
    }
    expect(f.requests).toHaveLength(6);
    expect(f.root.querySelector('.au-friend-row')).toBeNull();
    expect(f.root.querySelector('.au-social-empty-title')?.textContent).toBe('No matches');
    expect(f.root.querySelector('#au-social-summary')?.textContent).toContain('0+');
  });

  it('does not auto-load while the matching rows overflow the panel, leaving scrolling in charge', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1, 'Alpha')], hasNextPage: true }); await drain();
    const content = f.root.querySelector<HTMLElement>('#au-social-content')!;
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 300 });
    const input = f.root.querySelector<HTMLInputElement>('#au-social-search')!;
    input.value = 'alpha'; input.dispatchEvent(new Event('input')); await drain();
    expect(f.requests).toHaveLength(1);
    expect(f.root.querySelector('.au-friend-row')).not.toBeNull();
  });

  it('keeps the Retry panel when the search changes after the first page failed', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].reject(new Error('Network')); await drain();
    expect(f.root.querySelector('.au-social-retry')).not.toBeNull();
    const input = f.root.querySelector<HTMLInputElement>('#au-social-search')!;
    input.value = 'friend'; input.dispatchEvent(new Event('input')); await drain();
    expect(f.root.querySelector('.au-social-retry')).not.toBeNull();
    expect(f.root.querySelector('.au-social-empty-title')?.textContent).toBe("Couldn't load activity");
    f.root.querySelector<HTMLElement>('.au-social-retry')!.click(); await drain();
    expect(f.service.getDetailedActivity.mock.calls.at(-1)).toEqual([1, 'self', 1, 'all']);
    f.requests[1].resolve({ nodes: [node(1, 'Friend 1'), node(2, 'Other')], hasNextPage: false }); await drain();
    expect(f.root.querySelectorAll('.au-friend-row')).toHaveLength(1);
    expect(f.root.querySelector('.au-friend-name')?.textContent).toBe('Friend 1');
  });

  it('does not repeat an entry that moves between offset pages', async () => {
    const f = await fixture(); f.view.open(1, 'First'); f.requests[0].resolve({ nodes: [node(1), node(2), node(3)], hasNextPage: true }); await drain();
    const content = f.root.querySelector<HTMLElement>('#au-social-content')!; content.dispatchEvent(new Event('scroll'));
    f.requests[1].resolve({ nodes: [node(3), node(4)], hasNextPage: false }); await drain();
    expect([...content.querySelectorAll<HTMLElement>('.au-friend-row')].map(row => row.dataset.userId)).toEqual(['1', '2', '3', '4']);
  });
});
