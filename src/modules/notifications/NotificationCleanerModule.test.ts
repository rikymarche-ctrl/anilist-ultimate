import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCleanerModule } from './NotificationCleanerModule';
import { NotificationGroupService } from './services/NotificationGroupService';
import { NotificationFilterService } from './services/NotificationFilterService';
import { EventBus } from '@core/events/EventBus';
import { storage } from '@/test/storage-fixtures';

describe('notification merge lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/notifications'); document.body.innerHTML = '<div class="notifications"><div class="notification"><a href="/user/Alice/">Alice</a><div class="details">liked your activity</div></div><div class="notification"><a href="/user/Alice/">Alice</a><div class="details">liked your activity reply</div></div></div>'; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
  function fixture() {
    let finish!: () => void;
    const pending = new Promise<Map<number, never>>(resolve => { finish = () => resolve(new Map<number, never>()); });
    const fetch = { extractActivityId: () => 7, fetchActivityDetails: vi.fn(() => pending) };
    const module = new NotificationCleanerModule(fetch as never, new NotificationGroupService(fetch as never), new NotificationFilterService(), new EventBus(), storage as never);
    const internal = module as unknown as { enabled: boolean; processNotifications(): Promise<void>; toggleGrouping(): Promise<void> };
    internal.enabled = true;
    return { module, internal, finish: () => finish() };
  }
  it('does not let an old grouping hide notifications again after unmerge', async () => {
    const { module, internal, finish } = fixture(); const grouping = internal.processNotifications();
    expect(document.querySelectorAll('.au-virtual-notification')).toHaveLength(1);
    await internal.toggleGrouping(); finish(); await grouping;
    expect(document.querySelectorAll('.au-virtual-notification,.au-hidden-notification')).toHaveLength(0);
    await module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('serializes rapid toggle writes and prevents late results after destruction', async () => {
    const { module, internal, finish } = fixture(); const grouping = internal.processNotifications();
    const off = internal.toggleGrouping(); const on = internal.toggleGrouping(); const offAgain = internal.toggleGrouping();
    await Promise.all([off, on, offAgain]); await module.destroy(); finish(); await grouping;
    expect(vi.mocked(storage.set).mock.calls.slice(-3).map(call => call[1])).toEqual([false, true, false]);
    expect(document.querySelectorAll('.au-virtual-notification,.au-hidden-notification')).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels startup waiters and never installs polling/observers after destruction', async () => {
    document.body.replaceChildren(); const { module } = fixture(); const initializing = module.init();
    await Promise.resolve(); await module.destroy(); await initializing;
    expect(vi.getTimerCount()).toBe(0);
  });
});
