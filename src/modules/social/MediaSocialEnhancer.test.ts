import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaSocialEnhancer } from './MediaSocialEnhancer';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import { feedActivity } from '@/test/activity-fixtures';

describe('media social request lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/anime/10/social');
    document.body.innerHTML =
      '<div class="section-header"><div class="feed-type-toggle"><button class="button active">Following</button><button class="button">Global</button></div></div><div class="activity-feed"></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function fixture() {
    const bus = new EventBus();
    const renderer = {
      hideNativeActivities: vi.fn(),
      showNativeActivities: vi.fn(),
      showLoader: vi.fn(),
      renderCustomActivities: vi.fn(),
      showEmptyMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      clear: vi.fn(),
      configure: vi.fn(),
      applyFilters: vi.fn(),
    };
    const bar = document.createElement('div');
    bar.className = 'au-activity-bar';
    const filter = {
      configure: vi.fn(),
      create: () => bar,
      reset: vi.fn(),
      destroy: () => bar.remove(),
      getActiveFilters: () => [],
      getSearchQuery: () => '',
    };
    const tab = {
      configure: vi.fn(),
      inject: vi.fn(async () => false),
      destroy: vi.fn(),
      isActive: () => false,
    };
    const pending: Array<(value: unknown) => void> = [];
    const api = {
      query: vi.fn(
        (_query: string, _variables: unknown) => new Promise((resolve) => pending.push(resolve))
      ),
    };
    const activity = {
      getMediaActivity: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
    };
    const module = new MediaSocialEnhancer(
      logger,
      filter as never,
      renderer as never,
      tab as never,
      { getLists: () => ({ A: [{ id: 1 }, { id: 1 }], B: [{ id: 2 }] }) } as never,
      activity as never,
      api as never,
      { register: vi.fn(), unregister: vi.fn() } as never,
      bus
    );
    await module.init();
    const internal = module as unknown as {
      handleListChange(name: string | null): Promise<void>;
      loadAstraFollowingFeed(container: HTMLElement): Promise<void>;
      checkAndProcess(): void;
    };
    return { module, bus, renderer, pending, api, activity, tab, internal };
  }

  it('sends numeric user IDs once and retains the newest list response', async () => {
    const f = await fixture();
    const a = f.internal.handleListChange('A');
    await Promise.resolve();
    const b = f.internal.handleListChange('B');
    await Promise.resolve();
    expect(f.api.query.mock.calls[0][1]).toEqual({
      userIds: [1],
      mediaId: 10,
      page: 1,
      perPage: 50,
    });
    f.pending[1]({ Page: { activities: [feedActivity(2, 2)] } });
    await b;
    f.pending[0]({ Page: { activities: [feedActivity(1, 1)] } });
    await a;
    expect(f.renderer.renderCustomActivities).toHaveBeenCalledTimes(1);
    expect(f.renderer.renderCustomActivities.mock.calls[0][0]).toEqual([
      { ...feedActivity(2, 2), isLiked: false },
    ]);
    await f.module.destroy();
  });

  it.each([feedActivity(1, 1, 11), feedActivity(1, 2, 10)])(
    'rejects a response for another media/member and exposes a scoped retry: %j',
    async (row) => {
      const f = await fixture();
      const first = f.internal.handleListChange('A');
      await Promise.resolve();
      f.pending[0]({ Page: { activities: [row] } });
      await first;
      expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
      expect(f.renderer.showEmptyMessage).not.toHaveBeenCalled();
      expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
      const retry = f.renderer.showErrorMessage.mock.calls[0][1] as () => void;
      await f.internal.handleListChange(null);
      retry();
      await Promise.resolve();
      expect(f.api.query).toHaveBeenCalledOnce();
      await f.module.destroy();
    }
  );

  it('discards pending list results after clearing the selection', async () => {
    const f = await fixture();
    const a = f.internal.handleListChange('A');
    await Promise.resolve();
    await f.internal.handleListChange(null);
    f.pending[0]({ Page: { activities: [feedActivity(1, 1)] } });
    await a;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    await f.module.destroy();
  });

  it('discards old-account results and cleans up timers and native listeners', async () => {
    const f = await fixture();
    const a = f.internal.handleListChange('A');
    await Promise.resolve();
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 2,
      timestamp: new Date(),
    });
    f.pending[0]({ Page: { activities: [feedActivity(1, 1)] } });
    await a;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    await f.module.destroy();
    document.querySelector('.button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[data-au-hijacked]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let the persistent Load More button hide an otherwise stalled feed', async () => {
    const f = await fixture();
    expect(document.querySelector('.au-persistent-load-more')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.activity.getMediaActivity).toHaveBeenCalledWith(10);
    await f.module.destroy();
    f.pending[0]({ activities: [{ id: 1 }], hasNextPage: false });
    await Promise.resolve();
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not render a Following response after switching to the native Global tab', async () => {
    const f = await fixture();
    const container = document.querySelector<HTMLElement>('.activity-feed')!;
    const waiting = f.internal.loadAstraFollowingFeed(container);
    const tabs = document.querySelectorAll('.button');
    tabs[0].classList.remove('active');
    tabs[1].classList.add('active');
    tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.pending[0]({ activities: [{ id: 1 }], hasNextPage: false });
    await waiting;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    expect(container.classList.contains('au-astra-following-active')).toBe(false);
    await f.module.destroy();
  });

  it('avoids concurrent tab initialization while the list service is loading', async () => {
    const f = await fixture();
    let release!: (value: boolean) => void;
    f.tab.inject.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await Promise.resolve();
    await Promise.resolve();
    f.internal.checkAndProcess();
    f.internal.checkAndProcess();
    expect(f.tab.inject).toHaveBeenCalledTimes(2);
    release(false);
    await Promise.resolve();
    await f.module.destroy();
  });

  it('preserves native entries replaced by AniList during a pending fallback', async () => {
    const f = await fixture();
    const container = document.querySelector<HTMLElement>('.activity-feed')!;
    f.renderer.showLoader.mockImplementation(() => {
      container.innerHTML = '<div class="owned-loader"></div>';
    });
    const waiting = f.internal.loadAstraFollowingFeed(container);
    const native = document.createElement('article');
    native.className = 'native-entry';
    container.replaceChildren(native);
    f.pending[0]({ activities: [{ id: 1 }], hasNextPage: false });
    await waiting;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    await f.module.destroy();
    expect(native.parentElement).toBe(container);
  });

  it('clears only its own fallback nodes when the account changes', async () => {
    const f = await fixture();
    const container = document.querySelector<HTMLElement>('.activity-feed')!;
    f.renderer.showLoader.mockImplementation(() => {
      container.innerHTML = '<div class="owned-loader"></div>';
    });
    const waiting = f.internal.loadAstraFollowingFeed(container);
    const native = document.createElement('article');
    container.append(native);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 2,
      timestamp: new Date(),
    });
    expect(container.querySelector('.owned-loader')).toBeNull();
    expect(native.parentElement).toBe(container);
    f.pending[0]({ activities: [{ id: 1 }], hasNextPage: false });
    await waiting;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled();
    await f.module.destroy();
  });
});
