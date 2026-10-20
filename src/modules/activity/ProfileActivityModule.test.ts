import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileActivityModule } from './ProfileActivityModule';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

describe('profile feed lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/user/First/'); document.body.replaceChildren(); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });
  function fixture() {
    const bus = new EventBus();
    const renderer = { configure: vi.fn(), applyFilters: vi.fn() };
    const filter = { configure: vi.fn(), create: () => document.createElement('div'), reset: vi.fn(), destroy: vi.fn(), getActiveFilters: () => [], getSearchQuery: () => '' };
    const module = new ProfileActivityModule(logger, filter as never, renderer as never, bus);
    return { module, bus, renderer, internal: module as unknown as { checkAndProcess(): Promise<void>; observers: Map<string, MutationObserver> } };
  }

  it('applies active filters again to entries added after the filter bar exists', async () => {
    document.body.innerHTML = '<div class="content container"><div class="activity-feed"></div></div>';
    const f = fixture(); await f.module.init();
    document.querySelector('.activity-feed')!.append(document.createElement('article'));
    await f.internal.checkAndProcess();
    expect(f.renderer.applyFilters).toHaveBeenCalledTimes(2);
    await f.module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not register a late observer on a different page', async () => {
    const f = fixture(); const initializing = f.module.init(); await Promise.resolve();
    history.replaceState({}, '', '/home');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/home', previousPath: '/user/First/', timestamp: new Date() });
    document.body.innerHTML = '<div class="content container"></div>';
    await initializing;
    expect(f.internal.observers.size).toBe(0);
    await f.module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its old bar during navigation and cannot restart after destruction', async () => {
    document.body.innerHTML = '<div class="content container"><div class="activity-feed"></div></div>';
    const f = fixture(); await f.module.init();
    expect(document.querySelector('.au-profile-activity-bar')).not.toBeNull();
    history.replaceState({}, '', '/home');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/home', previousPath: '/user/First/', timestamp: new Date() });
    expect(document.querySelector('.au-profile-activity-bar')).toBeNull();
    await f.module.destroy(); history.replaceState({}, '', '/user/First/');
    await f.internal.checkAndProcess();
    expect(document.querySelector('.au-profile-activity-bar')).toBeNull();
  });
});
