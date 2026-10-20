import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

// Keep lifecycle tests independent from the full dashboard/DI graph.
vi.mock('./AstraService', () => ({ AstraService: class {} }));
vi.mock('./ui/AstraRatingModal', () => ({ AstraRatingModal: class {} }));
vi.mock('./services/AstraEnhancementService', () => ({ AstraEnhancementService: class {} }));
vi.mock('./services/AstraNavigationService', () => ({ AstraNavigationService: class {} }));
vi.mock('./services/AstraPillManager', () => ({ AstraPillManager: class {} }));
vi.mock('./services/AstraUIBridge', () => ({ AstraUIBridge: class {} }));
vi.mock('./ui/AstraDashboard', () => ({ AstraDashboard: class {} }));
vi.mock('@core/services/PreferencesService', () => ({ PreferencesService: class {} }));
vi.mock('@core/services/SocialMaskingService', () => ({ SocialMaskingService: class {} }));

import { AstraModule } from './AstraModule';

describe('AstraModule lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function setup() {
    const bus = new EventBus();
    const module = new AstraModule(bus);
    const refresh = vi.fn();
    const disposeModal = vi.fn();
    const unsubscribe = vi.fn();
    const dashboard = { activate: vi.fn(), preloadAiringData: vi.fn(), deactivate: vi.fn(), dispose: vi.fn() };
    const observer = { register: vi.fn((_name: string, _callback: () => void) => {}), unregister: vi.fn() };
    const service = { init: vi.fn(async () => {}) };
    const bridge = { initGlobalListeners: vi.fn(), deactivate: vi.fn() };
    const pill = { start: vi.fn(), stop: vi.fn() };
    const preferences = { onChanges: vi.fn((_callback: () => void) => unsubscribe) };
    const enhancement = { enhanceCards: vi.fn(), refreshAllPills: refresh };
    const navigation = { activate: vi.fn(), deactivate: vi.fn(), injectNavbarButton: vi.fn(), hijackMediaButton: vi.fn(), enhanceBrowseDropdown: vi.fn() };
    vi.spyOn(module as unknown as { resolveDependencies(): void }, 'resolveDependencies').mockImplementation(() => {
      Object.assign(module, {
        service,
        ratingModal: { dispose: disposeModal },
        bridge, dashboard,
        maskingService: { sync: vi.fn() },
        enhancementService: enhancement,
        pillManager: pill,
        navService: navigation,
        sharedObserver: observer,
        preferences,
      });
    });
    return { bus, module, refresh, unsubscribe, disposeModal, dashboard, observer, service, bridge, pill, preferences, enhancement, navigation };
  }

  it('releases reactive listeners and intervals when destroyed', async () => {
    const { bus, module, refresh, unsubscribe } = setup();
    await module.init();
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
    expect(refresh).toHaveBeenCalledTimes(1);
    await module.destroy();
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
    bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 2, previousProgress: 1, userId: 42 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes the rating view during module teardown', async () => {
    const { module, disposeModal } = setup(); await module.init(); await module.destroy();
    expect(disposeModal).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate refresh callbacks after destroy and reinitialization', async () => {
    const { bus, module, refresh, unsubscribe } = setup();
    await module.init();
    await module.destroy();
    await module.init();
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount(EVENT_TYPES.ASTRA_DATA_UPDATED)).toBe(1);
    await module.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('deactivates the reusable dashboard on OFF and activates it on ON without disposing its singleton', async () => {
    const f = setup(); await f.module.init(); await f.module.destroy(); await f.module.init();
    expect(f.dashboard.activate).toHaveBeenCalledTimes(2); expect(f.dashboard.deactivate).toHaveBeenCalledOnce();
    expect(f.dashboard.preloadAiringData).toHaveBeenCalledTimes(2);
    expect(f.dashboard.dispose).not.toHaveBeenCalled(); expect(f.bridge.deactivate).toHaveBeenCalledOnce();
    expect(f.navigation.activate).toHaveBeenCalledTimes(2); expect(f.navigation.deactivate).toHaveBeenCalledOnce();
    expect(f.bridge.initGlobalListeners).toHaveBeenCalledTimes(2); await f.module.destroy();
  });
  it('does not resume module initialization after destruction during service initialization', async () => {
    const f = setup(); let release!: () => void;
    f.service.init.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const pending = f.module.init(); await f.module.destroy(); release(); await pending;
    expect(f.pill.start).not.toHaveBeenCalled(); expect(f.observer.register).not.toHaveBeenCalled();
    expect(f.preferences.onChanges).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps old observer and preference callbacks inert after reactivation', async () => {
    const f = setup(); await f.module.init();
    const obsolete = f.observer.register.mock.calls.map(call => call[1] as () => void);
    const stalePreference = f.preferences.onChanges.mock.calls[0][0] as () => void;
    await f.module.destroy(); await f.module.init();
    f.enhancement.enhanceCards.mockClear(); f.navigation.injectNavbarButton.mockClear(); f.refresh.mockClear();
    obsolete.forEach(callback => callback()); stalePreference();
    expect(f.enhancement.enhanceCards).not.toHaveBeenCalled(); expect(f.navigation.injectNavbarButton).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled(); await f.module.destroy();
  });
  it('does not duplicate intervals or reactive subscriptions for repeated initialization', async () => {
    const f = setup(); await f.module.init(); await f.module.init();
    expect(f.service.init).toHaveBeenCalledOnce(); expect(f.preferences.onChanges).toHaveBeenCalledOnce();
    expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_DATA_UPDATED)).toBe(1); expect(vi.getTimerCount()).toBe(1);
    await f.module.destroy();
  });
  it('keeps an older initialization completion from installing resources for a newer activation', async () => {
    const f = setup(); let release!: () => void;
    f.service.init.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const old = f.module.init(); await f.module.destroy(); await f.module.init(); release(); await old;
    expect(f.pill.start).toHaveBeenCalledOnce(); expect(f.preferences.onChanges).toHaveBeenCalledOnce();
    expect(f.bus.listenerCount(EVENT_TYPES.ASTRA_DATA_UPDATED)).toBe(1); expect(vi.getTimerCount()).toBe(1);
    await f.module.destroy();
  });
});
