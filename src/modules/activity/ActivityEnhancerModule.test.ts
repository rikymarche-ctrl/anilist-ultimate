import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEnhancerModule } from './ActivityEnhancerModule';
import { EventBus } from '@core/events/EventBus';
import { logger } from '@core/logger';
import { feedActivity } from '@/test/activity-fixtures';
import { MediaListStatus } from '@/api/AnilistTypes';
import { ensurePersistentLoadMore } from './shared/PersistentLoadMore';
import { NATIVE_ACTIVITY_SELECTOR } from './shared/ActivityRenderer';
import type { ActivityFilterType } from './ActivityUtils';
describe('home activity async lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/home');
    document.body.innerHTML =
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  function fixture() {
    const renderer = {
      hideNativeActivities: vi.fn(),
      showNativeActivities: vi.fn(),
      showLoader: vi.fn(),
      renderCustomActivities: vi.fn(),
      appendCustomActivities: vi.fn(),
      showEmptyMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      clear: vi.fn(),
      configure: vi.fn(),
      applyFilters: vi.fn(),
    };
    const pending: Array<(value: unknown) => void> = [];
    const auth = { value: false };
    const bar = { filters: new Set<ActivityFilterType>(['ALL']), search: '' };
    const api = {
      isAuthenticated: () => auth.value,
      query: vi.fn((_query: string, _variables: unknown) => new Promise((r) => pending.push(r))),
    };
    const module = new ActivityEnhancerModule(
      logger,
      {
        destroy: vi.fn(),
        getActiveFilters: () => bar.filters,
        getSearchQuery: () => bar.search,
      } as never,
      renderer as never,
      { destroy: vi.fn(), isActive: () => false } as never,
      { getLists: () => ({ A: [{ id: 1 }, { id: 1 }], B: [{ id: 2 }], Empty: [] }) } as never,
      api as never,
      new EventBus()
    );
    return {
      module,
      auth,
      bar,
      renderer,
      pending,
      api,
      internal: module as unknown as {
        handleListChange(name: string | null): Promise<void>;
        startObservation(): Promise<void>;
        checkAndProcess(): Promise<void>;
        reloadFeed(): Promise<void>;
        tabManager: { isActive: () => boolean };
        loadMoreReconcileInterval: number | null;
      },
    };
  }
  it('keeps the latest selection when responses arrive in reverse order', async () => {
    const { module, renderer, pending, internal } = fixture();
    const a = internal.handleListChange('A');
    await Promise.resolve();
    const b = internal.handleListChange('B');
    await Promise.resolve();
    pending[1]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(2, 2)] } });
    await b;
    pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await a;
    expect(renderer.renderCustomActivities).toHaveBeenCalledTimes(1);
    expect(renderer.renderCustomActivities.mock.calls[0][0]).toEqual([
      { ...feedActivity(2, 2), isLiked: false },
    ]);
    await module.destroy();
  });
  it('re-asserts the native-only selector before hiding rows, so a selector left by the profile page cannot hide custom rows', async () => {
    const { module, renderer, pending, internal } = fixture();
    const waiting = internal.handleListChange('A');
    await Promise.resolve();
    expect(renderer.configure).toHaveBeenCalledWith({ activitySelector: NATIVE_ACTIVITY_SELECTOR });
    expect(renderer.configure.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.hideNativeActivities.mock.invocationCallOrder[0]
    );
    pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [] } });
    await waiting;
    await module.destroy();
  });
  it('ignores results after destruction and clears its reconciliation interval', async () => {
    const { module, renderer, pending, internal } = fixture();
    const waiting = internal.handleListChange('A');
    await Promise.resolve();
    internal.loadMoreReconcileInterval = window.setInterval(() => undefined, 2000);
    await module.destroy();
    pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await waiting;
    expect(renderer.renderCustomActivities).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows failure with retry rather than a confirmed empty feed and makes old retries inert', async () => {
    const f = fixture();
    const first = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: {} });
    await first;
    expect(f.renderer.showEmptyMessage).not.toHaveBeenCalled();
    expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
    const retry = f.renderer.showErrorMessage.mock.calls[0][1] as () => void;
    retry();
    await Promise.resolve();
    expect(f.api.query).toHaveBeenCalledTimes(2);
    expect(f.api.query.mock.calls[0][1]).toMatchObject({ userIds: [1] });
    f.pending[1]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(3, 1)] } });
    await vi.waitFor(() => expect(f.renderer.renderCustomActivities).toHaveBeenCalledOnce());
    await f.internal.handleListChange(null);
    retry();
    await Promise.resolve();
    expect(f.api.query).toHaveBeenCalledTimes(2);
    await f.module.destroy();
  });

  it('rejects a list response for a nonmember and avoids a request for an empty selection', async () => {
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 2)] } });
    await request;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
    await f.internal.handleListChange('Empty');
    expect(f.api.query).toHaveBeenCalledOnce();
    expect(f.renderer.renderCustomActivities).toHaveBeenLastCalledWith(
      [],
      expect.any(HTMLElement),
      'No activities found for the users in this list.'
    );
    await f.module.destroy();
  });

  it('does not send a stale selection after account context initialization finishes', async () => {
    const f = fixture();
    let resolve!: (value: unknown) => void;
    Object.assign(f.api, {
      ensureContext: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const request = f.internal.handleListChange('A');
    await f.internal.handleListChange(null);
    resolve({ userId: 1, sessionId: 'one' });
    await request;
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.renderer.showErrorMessage).not.toHaveBeenCalled();
    await f.module.destroy();
  });
  it('waits for a native row to clone before rendering a restored selection', async () => {
    document.body.innerHTML = '<div class="activity-feed"></div>';
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    document
      .querySelector('.activity-feed')!
      .insertAdjacentHTML('beforeend', '<div class="activity-entry activity-text"></div>');
    await vi.advanceTimersByTimeAsync(1000);
    await request;
    expect(f.renderer.renderCustomActivities).toHaveBeenCalledOnce();
    await f.module.destroy();
  });

  it('still renders when no native row ever appears', async () => {
    document.body.innerHTML = '<div class="activity-feed"></div>';
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await vi.advanceTimersByTimeAsync(5000);
    await request;
    expect(f.renderer.renderCustomActivities).toHaveBeenCalledOnce();
    await f.module.destroy();
  });

  it('replaces an endless loader with the retry state', async () => {
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await vi.advanceTimersByTimeAsync(20_000);
    await request;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
    await f.module.destroy();
  });

  it('puts the container back when AniList redraws the feed during a request', async () => {
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    document.body.innerHTML =
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await request;
    const container = f.renderer.renderCustomActivities.mock.calls[0][1] as HTMLElement;
    expect(container.isConnected).toBe(true);
    expect(container.parentElement?.classList.contains('activity-feed')).toBe(true);
    await f.module.destroy();
  });
  it('keeps a rendered custom feed when AniList redraws its feed after navigation', async () => {
    const f = fixture();
    f.internal.tabManager.isActive = () => true;
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await request;
    const container = f.renderer.renderCustomActivities.mock.calls[0][1] as HTMLElement;
    container.innerHTML = '<div class="au-custom-activity">row</div>';
    document.body.innerHTML =
      '<div class="au-activity-bar"></div><div class="feed-type-toggle"><div class="au-custom-list-btn"></div></div>' +
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
    expect(container.isConnected).toBe(false);
    await f.internal.checkAndProcess();
    expect(document.querySelector('.activity-feed')!.firstElementChild).toBe(container);
    expect(container.textContent).toBe('row');
    expect(f.renderer.renderCustomActivities).toHaveBeenCalledOnce();
    await f.module.destroy();
  });

  it('does not build into the previous page DOM before the home feed toggle is mounted', async () => {
    const f = fixture();
    // Path is already /home but the DOM still shows a profile feed (no Following/Global toggle).
    document.body.innerHTML =
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
    await f.internal.checkAndProcess();
    expect(document.querySelector('.au-activity-bar')).toBeNull();
    expect(f.api.query).not.toHaveBeenCalled();
    await f.module.destroy();
  });

  it('leaves the feed alone when no custom list is active', async () => {
    const f = fixture();
    const request = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await request;
    await f.internal.handleListChange(null);
    document.body.innerHTML =
      '<div class="au-activity-bar"></div><div class="au-custom-list-btn"></div>' +
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
    await f.internal.checkAndProcess();
    expect(document.querySelector('.au-custom-activities-container')).toBeNull();
    await f.module.destroy();
  });
  it('re-queries a custom list when a filter is chosen and shows only matching rows', async () => {
    const f = fixture();
    const first = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await first;
    f.bar.filters = new Set<ActivityFilterType>([MediaListStatus.DROPPED]);
    const filtered = f.internal.reloadFeed();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.api.query.mock.calls[1][1]).toMatchObject({
      userIds: [1],
      types: ['ANIME_LIST', 'MANGA_LIST'],
    });
    f.pending[1]({
      Page: {
        pageInfo: { hasNextPage: false },
        activities: [
          { ...feedActivity(2, 1), status: 'dropped', progress: null },
          feedActivity(3, 1),
        ],
      },
    });
    await filtered;
    const rows = f.renderer.renderCustomActivities.mock.calls[1][0] as Array<{ id: number }>;
    expect(rows.map((row) => row.id)).toEqual([2]);
    await f.module.destroy();
  });

  it('queries Following with a filter when connected, and keeps Global filtering on the page', async () => {
    document.body.innerHTML =
      '<div class="feed-type-toggle"><div class="link active">Following</div><div class="link">Global</div></div>' +
      '<div class="activity-feed"><div class="activity-entry activity-anime_list"></div></div>';
    const f = fixture();
    f.bar.filters = new Set<ActivityFilterType>([MediaListStatus.PAUSED]);
    await f.internal.reloadFeed();
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.renderer.applyFilters).toHaveBeenCalled();

    f.auth.value = true;
    const following = f.internal.reloadFeed();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.api.query.mock.calls[0][0]).toContain('isFollowing: true');
    f.pending[0]({
      Page: {
        pageInfo: { hasNextPage: false },
        activities: [{ ...feedActivity(5, 9), status: 'paused watching' }],
      },
    });
    await following;
    expect(f.renderer.hideNativeActivities).toHaveBeenCalled();
    expect(
      (f.renderer.renderCustomActivities.mock.calls[0][0] as Array<{ id: number }>)[0].id
    ).toBe(5);

    const [followingTab, globalTab] = document.querySelectorAll('.feed-type-toggle .link');
    followingTab.classList.remove('active');
    globalTab.classList.add('active');
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="au-activity-bar"></div><div class="au-custom-list-btn"></div>'
    );
    await f.internal.checkAndProcess();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.renderer.showNativeActivities).toHaveBeenCalled();
    expect(f.api.query).toHaveBeenCalledOnce();
    await f.module.destroy();
  });

  it('pages the extension feed with Load More and appends the next rows', async () => {
    const f = fixture();
    const first = f.internal.handleListChange('A');
    await Promise.resolve();
    const many = Array.from({ length: 20 }, (_, i) => feedActivity(100 + i, 1));
    f.pending[0]({ Page: { pageInfo: { hasNextPage: true }, activities: many } });
    await first;
    ensurePersistentLoadMore(document.querySelector('.activity-feed')!);
    const button = document.querySelector<HTMLButtonElement>('.au-persistent-load-more')!;
    expect(button.hidden).toBe(false);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.api.query.mock.calls[1][1]).toMatchObject({ page: 2 });
    expect(button.disabled).toBe(true);
    f.pending[1]({
      Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(200, 1)] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (f.renderer.appendCustomActivities.mock.calls[0][0] as Array<{ id: number }>).map((r) => r.id)
    ).toEqual([200]);
    expect(button.hidden).toBe(true);
    await f.module.destroy();
    expect(button.isConnected).toBe(false);
  });
  it('reloads a custom feed that navigation left empty, but never more than three times a minute', async () => {
    const f = fixture();
    const first = f.internal.handleListChange('A');
    await Promise.resolve();
    f.pending[0]({ Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] } });
    await first;
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="au-activity-bar"></div><div class="feed-type-toggle"><div class="au-custom-list-btn"></div></div>'
    );
    const container = document.querySelector('.au-custom-activities-container')!;
    for (let i = 1; i <= 5; i++) {
      container.replaceChildren();
      await f.internal.checkAndProcess();
      await vi.advanceTimersByTimeAsync(0);
      f.pending[i]?.({
        Page: { pageInfo: { hasNextPage: false }, activities: [feedActivity(1, 1)] },
      });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(f.api.query).toHaveBeenCalledTimes(4);
    await f.module.destroy();
  });
});
