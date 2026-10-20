import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEnhancerModule } from './ActivityEnhancerModule';
import { EventBus } from '@core/events/EventBus';
import { logger } from '@core/logger';
import { feedActivity } from '@/test/activity-fixtures';
describe('home activity async lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/home'); document.body.innerHTML = '<div class="activity-feed"></div>'; });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });
  function fixture() {
    const renderer = { hideNativeActivities: vi.fn(), showNativeActivities: vi.fn(), showLoader: vi.fn(), renderCustomActivities: vi.fn(), showEmptyMessage: vi.fn(), showErrorMessage: vi.fn(), clear: vi.fn(), configure: vi.fn(), applyFilters: vi.fn() };
    const pending: Array<(value: unknown) => void> = [];
    const api = { query: vi.fn((_query: string, _variables: unknown) => new Promise(r => pending.push(r))) };
    const module = new ActivityEnhancerModule(logger, { destroy: vi.fn(), getActiveFilters: () => [], getSearchQuery: () => '' } as never, renderer as never, { destroy: vi.fn(), isActive: () => false } as never, { getLists: () => ({ A: [{ id: 1 }, { id: 1 }], B: [{ id: 2 }], Empty: [] }) } as never, api as never, new EventBus());
    return { module, renderer, pending, api, internal: module as unknown as { handleListChange(name: string | null): Promise<void>; startObservation(): Promise<void>; loadMoreReconcileInterval: number | null } };
  }
  it('keeps the latest selection when responses arrive in reverse order', async () => {
    const { module, renderer, pending, internal } = fixture();
    const a = internal.handleListChange('A'); await Promise.resolve();
    const b = internal.handleListChange('B'); await Promise.resolve();
    pending[1]({ Page: { activities: [feedActivity(2, 2)] } }); await b;
    pending[0]({ Page: { activities: [feedActivity(1, 1)] } }); await a;
    expect(renderer.renderCustomActivities).toHaveBeenCalledTimes(1);
    expect(renderer.renderCustomActivities.mock.calls[0][0]).toEqual([feedActivity(2, 2)]); await module.destroy();
  });
  it('ignores results after destruction and clears its reconciliation interval', async () => {
    const { module, renderer, pending, internal } = fixture(); const waiting = internal.handleListChange('A');
    await Promise.resolve();
    internal.loadMoreReconcileInterval = window.setInterval(() => undefined, 2000);
    await module.destroy(); pending[0]({ Page: { activities: [feedActivity(1, 1)] } }); await waiting;
    expect(renderer.renderCustomActivities).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('shows failure with retry rather than a confirmed empty feed and makes old retries inert', async () => {
    const f = fixture(); const first = f.internal.handleListChange('A'); await Promise.resolve();
    f.pending[0]({ Page: {} }); await first;
    expect(f.renderer.showEmptyMessage).not.toHaveBeenCalled(); expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
    const retry = f.renderer.showErrorMessage.mock.calls[0][1] as () => void;
    retry(); await Promise.resolve();
    expect(f.api.query).toHaveBeenCalledTimes(2);
    expect(f.api.query.mock.calls[0][1]).toMatchObject({ userIds: [1] });
    f.pending[1]({ Page: { activities: [feedActivity(3, 1)] } });
    await vi.waitFor(() => expect(f.renderer.renderCustomActivities).toHaveBeenCalledOnce());
    await f.internal.handleListChange(null); retry(); await Promise.resolve();
    expect(f.api.query).toHaveBeenCalledTimes(2); await f.module.destroy();
  });

  it('rejects a list response for a nonmember and avoids a request for an empty selection', async () => {
    const f = fixture(); const request = f.internal.handleListChange('A'); await Promise.resolve();
    f.pending[0]({ Page: { activities: [feedActivity(1, 2)] } }); await request;
    expect(f.renderer.renderCustomActivities).not.toHaveBeenCalled(); expect(f.renderer.showErrorMessage).toHaveBeenCalledOnce();
    await f.internal.handleListChange('Empty'); expect(f.api.query).toHaveBeenCalledOnce();
    expect(f.renderer.renderCustomActivities).toHaveBeenLastCalledWith([], expect.any(HTMLElement)); await f.module.destroy();
  });

  it('does not send a stale selection after account context initialization finishes', async () => {
    const f = fixture(); let resolve!: (value: unknown) => void;
    Object.assign(f.api, { ensureContext: () => new Promise(r => { resolve = r; }) });
    const request = f.internal.handleListChange('A'); await f.internal.handleListChange(null);
    resolve({ userId: 1, sessionId: 'one' }); await request;
    expect(f.api.query).not.toHaveBeenCalled(); expect(f.renderer.showErrorMessage).not.toHaveBeenCalled(); await f.module.destroy();
  });
});
