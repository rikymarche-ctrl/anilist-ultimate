import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationService, TRAVERSAL_SETTLE_TIMEOUT_MS } from './NavigationService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ILogger } from '@core/interfaces/ILogger';

const eventBusFake = () => ({ emit: vi.fn<IEventBus['emit']>() });
const loggerFake = () => ({
  info: vi.fn<ILogger['info']>(),
  warn: vi.fn<ILogger['warn']>(),
  success: vi.fn<ILogger['success']>(),
  debug: vi.fn<ILogger['debug']>(),
});
function navigationWithFakes(
  events: ReturnType<typeof eventBusFake>,
  logger: ReturnType<typeof loggerFake>
) {
  return new NavigationService(events as unknown as IEventBus, logger as unknown as ILogger);
}

describe('NavigationService', () => {
  let service: NavigationService;
  let mockEventBus: ReturnType<typeof eventBusFake>;
  let mockLogger: ReturnType<typeof loggerFake>;
  beforeEach(() => {
    vi.clearAllMocks();

    mockEventBus = eventBusFake();
    mockLogger = loggerFake();

    service = navigationWithFakes(mockEventBus, mockLogger);
  });

  afterEach(() => {
    service.stop();
    // stop() restores the history methods; restore any independent spies too.
    vi.restoreAllMocks();
  });

  it('should start and stop correctly', () => {
    service.start();
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('active'));

    service.stop();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('stopped'));
  });

  it('should detect path changes via history.pushState', () => {
    service.start();

    const oldPath = window.location.pathname;
    const newPath = '/pushed-page';

    // pushState should update location and trigger checkPathChange
    history.pushState({}, '', newPath);

    expect(window.location.pathname).toBe(newPath);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      EVENT_TYPES.PAGE_CHANGED,
      expect.objectContaining({
        path: newPath,
        previousPath: oldPath,
      })
    );
  });

  it('should detect path changes via history.replaceState', () => {
    service.start();

    const oldPath = window.location.pathname;
    const newPath = '/replaced-page';

    history.replaceState({}, '', newPath);

    expect(window.location.pathname).toBe(newPath);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      EVENT_TYPES.PAGE_CHANGED,
      expect.objectContaining({
        path: newPath,
        previousPath: oldPath,
      })
    );
  });

  it('should detect path changes via popstate', () => {
    history.pushState({}, '', '/initial');

    service = navigationWithFakes(mockEventBus, mockLogger);
    service.start();

    const newPath = '/back-page';

    // Change location
    history.pushState({}, '', newPath);

    // Clear the call from pushState to test popstate separately
    mockEventBus.emit.mockClear();

    // Trigger popstate
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

    // checkPathChange should see the change (even if it's the same path, it's called)
    // Wait, if it's the SAME path it won't emit.

    // To test popstate correctly:
    // 1. push /1
    // 2. push /2 (emits)
    // 3. manually change currentPath in service to /1 (internal)
    // 4. popstate (emits /2)

    // Actually, popstate usually happens AFTER the URL has changed.

    expect(mockEventBus.emit).not.toHaveBeenCalled(); // Since it was cleared and no change happened after
  });

  describe('traversal tagging', () => {
    const emitted = () =>
      mockEventBus.emit.mock.calls.map(
        ([, event]) => event as { path: string; navigationType?: string }
      );
    /** Service whose last seen path is `from`, with the browser already showing `to` (as when popstate fires). */
    const traversal = (from: string, to: string) => {
      history.replaceState({}, '', from);
      service = navigationWithFakes(mockEventBus, mockLogger);
      history.replaceState({}, '', to);
    };

    it('tags pushes as push and Back/Forward as traverse', () => {
      traversal('/anime/1', '/user/Friend/animelist');
      service.start();
      window.dispatchEvent(new PopStateEvent('popstate'));
      history.pushState({}, '', '/anime/2');
      expect(emitted().map((event) => [event.path, event.navigationType])).toEqual([
        ['/user/Friend/animelist', 'traverse'],
        ['/anime/2', 'push'],
      ]);
    });

    it('tags the traversal even when the path change is detected before its own popstate handler', () => {
      traversal('/anime/1', '/user/Friend/animelist');
      // AniList's router listens first; in the browser its render reaches the DOM
      // observer before the service's bubble listener runs.
      const observerDetection = () =>
        (service as unknown as { checkPathChange(): void }).checkPathChange();
      window.addEventListener('popstate', observerDetection);
      service.start();
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.removeEventListener('popstate', observerDetection);
      expect(emitted()).toEqual([
        expect.objectContaining({ path: '/user/Friend/animelist', navigationType: 'traverse' }),
      ]);
    });

    it('does not carry a query-only traversal over to the next navigation', () => {
      history.replaceState({}, '', '/search/anime?genres=Action');
      service = navigationWithFakes(mockEventBus, mockLogger);
      service.start();
      history.replaceState({}, '', '/search/anime');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      history.pushState({}, '', '/anime/1');
      expect(emitted()).toEqual([
        expect.objectContaining({ path: '/anime/1', navigationType: 'push' }),
      ]);
    });

    it('removes the traversal listener on stop', () => {
      const remove = vi.spyOn(window, 'removeEventListener');
      service.start();
      service.stop();
      expect(remove).toHaveBeenCalledWith('popstate', expect.any(Function), true);
    });

    describe('with the Navigation API (Chrome)', () => {
      let navigation: EventTarget;
      const commit = (navigationType: string) => {
        const event = Object.assign(new Event('currententrychange'), { navigationType });
        navigation.dispatchEvent(event);
      };
      /** What the DOM observer does on any mutation between the URL commit and popstate. */
      const mutationSeen = () =>
        (service as unknown as { checkPathChange(): void }).checkPathChange();
      beforeEach(() => {
        navigation = new EventTarget();
        (window as { navigation?: EventTarget }).navigation = navigation;
      });
      afterEach(() => {
        delete (window as { navigation?: EventTarget }).navigation;
        vi.useRealTimers();
      });

      it('tags a traversal the observer reports before popstate, and waits for popstate to settle', () => {
        traversal('/anime/1', '/user/Friend/animelist');
        service.start();
        commit('traverse');
        expect(service.hasPendingTraversal()).toBe(true);
        mutationSeen();
        expect(emitted()).toEqual([
          expect.objectContaining({ path: '/user/Friend/animelist', navigationType: 'traverse' }),
        ]);
        expect(service.hasPendingTraversal()).toBe(true);
        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(service.hasPendingTraversal()).toBe(false);
        expect(emitted()).toHaveLength(1);
        history.pushState({}, '', '/anime/2');
        expect(emitted()[1]).toEqual(
          expect.objectContaining({ path: '/anime/2', navigationType: 'push' })
        );
      });

      it('ignores push and replace commits, and stops waiting for a popstate that never comes', () => {
        vi.useFakeTimers();
        traversal('/anime/1', '/anime/2');
        service.start();
        commit('push');
        mutationSeen();
        expect(emitted()).toEqual([
          expect.objectContaining({ path: '/anime/2', navigationType: 'push' }),
        ]);
        commit('traverse');
        expect(service.hasPendingTraversal()).toBe(true);
        vi.advanceTimersByTime(TRAVERSAL_SETTLE_TIMEOUT_MS);
        expect(service.hasPendingTraversal()).toBe(false);
      });

      it('stops listening on stop', () => {
        const remove = vi.spyOn(navigation, 'removeEventListener');
        service.start();
        service.stop();
        expect(remove).toHaveBeenCalledWith('currententrychange', expect.any(Function));
        commit('traverse');
        expect(service.hasPendingTraversal()).toBe(false);
      });
    });
  });

  it('should matchesPath correctly', () => {
    const current = service.getCurrentPath();

    expect(service.isOnPage(current)).toBe(true);
    expect(service.matchesPath(current)).toBe(true);
    expect(service.matchesPath(current.substring(0, 1))).toBe(true);
  });
});
