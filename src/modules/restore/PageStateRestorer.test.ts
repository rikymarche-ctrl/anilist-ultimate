import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStateRestorer, RESTORE_TIMING, type RestoreOutcome } from './PageStateRestorer';
import type { PageStateAdapter } from './PageStateAdapters';
import type { PageStateSnapshot } from './PageStateTypes';

const VIEWPORT = 800;
const ROW_HEIGHT = 100;
const filters = {
  view: null,
  title: '',
  format: 'OVA',
  status: null,
  genres: [],
  country: null,
  year: null,
  sort: null,
};
const snapshot = (overrides: Partial<PageStateSnapshot> = {}): PageStateSnapshot => ({
  key: 'entry:1',
  url: '/search/anime?search=gundam',
  kind: 'scrollLoader',
  scrollY: 4000,
  loaded: 60,
  loaderIndex: 0,
  filters: null,
  capturedAt: 1,
  ...overrides,
});

/**
 * Page that renders `pageSize` more items a little after each request, up to `total`.
 * `inPlace` pages load without moving the window (scroll loaders), others scroll (lists).
 */
function fakePage({
  total = 200,
  pageSize = 20,
  ready = true,
  maxLoadSteps = 25,
  inPlace = false,
} = {}) {
  let items = 0;
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => items * ROW_HEIGHT,
  });
  const adapter = {
    kind: 'scrollLoader' as const,
    maxLoadSteps,
    loadsInPlace: inPlace,
    loaderIndex: 0,
    isReady: vi.fn(() => ready),
    measureLoaded: () => items,
    readFilters: () => null,
    applyFilters: vi.fn(async () => true),
    requestMore: vi.fn(() => {
      setTimeout(() => {
        items = Math.min(total, items + pageSize);
      }, 10);
    }),
    release: vi.fn(),
  } satisfies PageStateAdapter;
  return { adapter, items: () => items };
}

describe('PageStateRestorer', () => {
  let restorer: PageStateRestorer;
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', snapshot().url);
    restorer = new PageStateRestorer();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: VIEWPORT,
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    scrollTo = vi.fn((options: ScrollToOptions) => {
      window.scrollY = options.top ?? 0;
    });
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    restorer.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const run = async (
    page: ReturnType<typeof fakePage>,
    target = snapshot()
  ): Promise<RestoreOutcome> => {
    const outcome = restorer.restore(target, page.adapter);
    await vi.runAllTimersAsync();
    return outcome;
  };

  it('loads until the recorded items are back, then restores the scroll offset', async () => {
    const page = fakePage();
    await expect(run(page)).resolves.toBe('restored');
    expect(page.items()).toBe(60);
    expect(page.adapter.requestMore).toHaveBeenCalledTimes(3);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 4000, behavior: 'instant' })
    );
    expect(window.scrollY).toBe(4000);
    expect(restorer.isRunning()).toBe(false);
    expect(page.adapter.release).toHaveBeenCalledTimes(1);
  });

  it('re-applies filters before asking for more items', async () => {
    const page = fakePage();
    await run(page, snapshot({ kind: 'mediaList', filters }));
    expect(page.adapter.applyFilters).toHaveBeenCalledWith(filters, expect.anything());
    expect(page.adapter.applyFilters.mock.invocationCallOrder[0]).toBeLessThan(
      page.adapter.requestMore.mock.invocationCallOrder[0]
    );
  });

  it('keeps loading past the recorded count until the saved offset is reachable', async () => {
    const page = fakePage();
    await expect(run(page, snapshot({ loaded: 20, scrollY: 5000 }))).resolves.toBe('restored');
    expect(page.items()).toBeGreaterThanOrEqual((5000 + VIEWPORT) / ROW_HEIGHT);
    expect(window.scrollY).toBe(5000);
  });

  it('settles for what the page has when it stops growing', async () => {
    const page = fakePage({ total: 40 });
    await expect(run(page)).resolves.toBe('partial');
    expect(window.scrollY).toBe(40 * ROW_HEIGHT - VIEWPORT);
  });

  it('never spends more load rounds than the adapter allows', async () => {
    const page = fakePage({ maxLoadSteps: 2 });
    await expect(run(page)).resolves.toBe('partial');
    expect(page.adapter.requestMore).toHaveBeenCalledTimes(2);
  });

  it('spaces scroll-loader steps by the minimum interval', async () => {
    const page = fakePage();
    const load = page.adapter.requestMore.getMockImplementation()!;
    const requests: number[] = [];
    page.adapter.requestMore.mockImplementation(() => { requests.push(Date.now()); load(); });
    await run(page);
    expect(requests.length).toBeGreaterThan(1);
    for (let index = 1; index < requests.length; index++) {
      expect(requests[index] - requests[index - 1]).toBeGreaterThanOrEqual(RESTORE_TIMING.SCROLL_LOADER_MIN_INTERVAL_MS);
    }
  });
  it('cancels a running restore when the query string changes before the final scroll', async () => {
    const page = fakePage();
    const load = page.adapter.requestMore.getMockImplementation()!;
    page.adapter.requestMore.mockImplementationOnce(() => {
      window.history.replaceState({}, '', '/search/anime?search=other');
      load();
    });
    expect(await run(page)).toBe('aborted');
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('waits until the destination replaced the previous page on screen', async () => {
    const page = fakePage();
    let routed = false;
    const outcome = restorer.restore(snapshot(), page.adapter, () => routed);
    await vi.advanceTimersByTimeAsync(500);
    expect(page.adapter.applyFilters).not.toHaveBeenCalled();
    expect(page.adapter.requestMore).not.toHaveBeenCalled();
    routed = true;
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('restored');
  });

  it('does nothing on a page that never renders', async () => {
    const page = fakePage({ ready: false });
    await expect(run(page)).resolves.toBe('not-ready');
    expect(page.adapter.requestMore).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('hands the window back on the first trusted user input', async () => {
    const listeners = new Map<string, EventListener>();
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        listeners.set(type, listener as EventListener);
        add(type, listener, options);
      }
    );
    const remove = vi.spyOn(window, 'removeEventListener');
    const page = fakePage();
    const load = page.adapter.requestMore.getMockImplementation()!;
    page.adapter.requestMore
      .mockImplementationOnce(() => {
        // Momentum of a touchpad swipe-back gesture is not a scroll request…
        listeners.get('wheel')!({
          isTrusted: true,
          type: 'wheel',
          deltaX: -40,
          deltaY: 3,
        } as unknown as Event);
        load();
      })
      .mockImplementationOnce(() => {
        // …a vertical wheel is.
        listeners.get('wheel')!({
          isTrusted: true,
          type: 'wheel',
          deltaX: 0,
          deltaY: 120,
        } as unknown as Event);
      });
    // A list loads by scrolling: once the user scrolls, nothing moves any more.
    await expect(run(page)).resolves.toBe('interrupted');
    expect(page.adapter.requestMore).toHaveBeenCalledTimes(2);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(page.adapter.release).toHaveBeenCalledTimes(1);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown']) {
      expect(remove).toHaveBeenCalledWith(
        type,
        listeners.get(type),
        expect.objectContaining({ capture: true })
      );
    }
  });

  it('keeps loading content in place after the user took over, but leaves the offset alone', async () => {
    const listeners = new Map<string, EventListener>();
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        listeners.set(type, listener as EventListener);
        add(type, listener, options);
      }
    );
    const page = fakePage({ inPlace: true });
    const load = page.adapter.requestMore.getMockImplementation()!;
    page.adapter.requestMore.mockImplementationOnce(() => {
      listeners.get('keydown')!({ isTrusted: true, type: 'keydown' } as unknown as Event);
      expect(restorer.hasUserTakenOver()).toBe(true);
      load();
    });
    await expect(run(page)).resolves.toBe('interrupted');
    expect(page.items()).toBe(60);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(restorer.hasUserTakenOver()).toBe(false);
  });

  it('never touches filters once the user took over', async () => {
    const page = fakePage({ inPlace: true });
    const outcome = restorer.restore(snapshot({ kind: 'mediaList', filters }), page.adapter);
    // Trusted input cannot be synthesized in jsdom: drive the guard like a browser would.
    const guard = (restorer as unknown as { current: { handleUserInput(event: Event): void } })
      .current;
    guard.handleUserInput({ isTrusted: true, type: 'pointerdown' } as unknown as Event);
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('interrupted');
    expect(page.adapter.applyFilters).not.toHaveBeenCalled();
  });

  it('asks again when a request did not wake the loader (sentinel carried out of view)', async () => {
    const page = fakePage();
    page.adapter.requestMore.mockImplementationOnce(() => {});
    await expect(run(page)).resolves.toBe('restored');
    expect(page.items()).toBe(60);
    expect(page.adapter.requestMore).toHaveBeenCalledTimes(4);
  });

  it('ignores synthetic input, including events it dispatches itself', async () => {
    const page = fakePage();
    const load = page.adapter.requestMore.getMockImplementation()!;
    page.adapter.requestMore.mockImplementation(() => {
      window.dispatchEvent(new WheelEvent('wheel'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      load();
    });
    await expect(run(page)).resolves.toBe('restored');
    expect(window.scrollY).toBe(4000);
  });

  it('stops on abort() and lets a new run supersede the previous one', async () => {
    const first = fakePage();
    const pending = restorer.restore(snapshot(), first.adapter);
    expect(restorer.isRunning()).toBe(true);
    restorer.abort();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('aborted');
    expect(restorer.isRunning()).toBe(false);

    const older = restorer.restore(snapshot(), fakePage().adapter);
    const newer = restorer.restore(snapshot({ loaded: 20, scrollY: 100 }), fakePage().adapter);
    await vi.runAllTimersAsync();
    await expect(older).resolves.toBe('aborted');
    await expect(newer).resolves.toBe('restored');
  });
});
