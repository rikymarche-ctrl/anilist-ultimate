import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES, type PageNavigationType } from '@core/events/EventTypes';
import { CAPTURE_THROTTLE_MS, PageStateRestoreModule } from './PageStateRestoreModule';
import { PageStateStore } from './PageStateStore';
import type { PageStateRestorer, RestoreOutcome } from './PageStateRestorer';
import type { PageStateSnapshot } from './PageStateTypes';

const LIST_URL = '/user/Friend/animelist/Planning';
const HOME_URL = '/home';
const ROW_HEIGHT = 100;

function listPage(entries = 3, format = 'OVA'): void {
  document.body.innerHTML = `
    <div class="medialist"><div class="filters-wrap"><div class="filters"><div class="filter-group"><div class="group-header">Filters</div>
      <div class="el-select"><div class="el-input"><input class="el-input__inner" placeholder="Format" value="${format}"></div></div></div></div></div>
      <div class="list-section"><div class="list-entries">${'<div class="entry row"><a href="/anime/1">Entry</a></div>'.repeat(entries)}</div></div></div>`;
}

/** Home feed driven by AniList's scroll loader; jsdom gets the layout a browser would compute. */
function feedPage(entries = 40): void {
  document.body.innerHTML = `<div class="activity-feed-wrap"><div class="activity-feed">${'<div class="activity-entry"><a href="/anime/2">Entry</a></div>'.repeat(entries)}</div><div class="scroller"></div></div>`;
  const wrap = document.querySelector('.activity-feed-wrap')!;
  wrap.getBoundingClientRect = () => ({ top: -window.scrollY }) as DOMRect;
  document.querySelector('.scroller')!.getBoundingClientRect = () =>
    ({ top: entries * ROW_HEIGHT - window.scrollY }) as DOMRect;
}

/** The SPA router owns link clicks on AniList; jsdom would attempt a document navigation. */
const keepDocument = (event: Event) => event.preventDefault();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('PageStateRestoreModule', () => {
  let bus: EventBus;
  let store: PageStateStore;
  let restorer: {
    restore: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    hasUserTakenOver: ReturnType<typeof vi.fn<() => boolean>>;
  };
  let navigation: { hasPendingTraversal: ReturnType<typeof vi.fn<() => boolean>> };
  let module: PageStateRestoreModule;

  const navigate = (url: string, navigationType: PageNavigationType) => {
    const previousPath = location.pathname;
    history.replaceState({}, '', url);
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath,
      timestamp: new Date(),
      navigationType,
    });
  };
  const scrollTo = (y: number) => {
    window.scrollY = y;
    window.dispatchEvent(new Event('scroll'));
  };
  const leaveByClick = () => {
    document.querySelector<HTMLElement>('a')!.click();
    document.body.innerHTML = '<div class="media-page"></div>';
    navigate('/anime/1/Title', 'push');
  };
  const stored = (url: string) => store.get(`url:${url}`);

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.addEventListener('click', keepDocument);
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    history.replaceState({}, '', LIST_URL);
    listPage();
    bus = new EventBus();
    store = new PageStateStore();
    restorer = {
      restore: vi.fn(async (): Promise<RestoreOutcome> => 'restored'),
      abort: vi.fn(),
      isRunning: vi.fn(() => false),
      hasUserTakenOver: vi.fn(() => false),
    };
    navigation = { hasPendingTraversal: vi.fn(() => false) };
    module = new PageStateRestoreModule(
      bus,
      navigation,
      store,
      restorer as unknown as PageStateRestorer
    );
  });
  afterEach(async () => {
    await module.destroy();
    document.removeEventListener('click', keepDocument);
    document.body.innerHTML = '';
    delete (window as { navigation?: unknown }).navigation;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records the list the user leaves: filters, rendered entries and scroll offset', async () => {
    await module.init();
    scrollTo(1200);
    leaveByClick();
    expect(stored(LIST_URL)).toMatchObject({
      kind: 'mediaList',
      url: LIST_URL,
      scrollY: 1200,
      loaded: 3,
      filters: { format: 'OVA', status: null, genres: [], year: null, view: null },
    });
  });

  it('replays that snapshot when Back returns to the list', async () => {
    await module.init();
    scrollTo(1200);
    leaveByClick();
    listPage(0, '');
    navigate(LIST_URL, 'traverse');
    expect(restorer.restore).toHaveBeenCalledTimes(1);
    const [snapshot, adapter, isPageCurrent] = restorer.restore.mock.calls[0];
    expect(snapshot).toEqual(stored(LIST_URL));
    expect(adapter.kind).toBe('mediaList');
    // The restore waits for AniList's router to render the destination.
    navigation.hasPendingTraversal.mockReturnValue(true);
    expect(isPageCurrent()).toBe(false);
    navigation.hasPendingTraversal.mockReturnValue(false);
    expect(isPageCurrent()).toBe(true);
  });

  it('does not read the page while the previous one is still rendered after Back', async () => {
    const otherList = '/user/Other/animelist';
    history.replaceState({}, '', otherList);
    await module.init();
    await vi.advanceTimersByTimeAsync(CAPTURE_THROTTLE_MS);
    // Back to Friend's list: URL committed, router still showing Other's list.
    navigation.hasPendingTraversal.mockReturnValue(true);
    navigate(LIST_URL, 'traverse');
    await vi.advanceTimersByTimeAsync(CAPTURE_THROTTLE_MS * 3);
    document.querySelector<HTMLElement>('a')!.click();
    navigate('/anime/1/Title', 'push');
    expect(stored(otherList)).toMatchObject({ loaded: 3 });
    expect(stored(LIST_URL)).toBeNull();

    navigation.hasPendingTraversal.mockReturnValue(false);
    listPage(7);
    history.replaceState({}, '', LIST_URL);
    navigate(LIST_URL, 'push');
    await vi.advanceTimersByTimeAsync(CAPTURE_THROTTLE_MS);
    navigate('/anime/1/Title', 'push');
    expect(stored(LIST_URL)).toMatchObject({ kind: 'mediaList', loaded: 7 });
  });

  it('records how far a scroll-loaded feed reached, with the offset exact between captures', async () => {
    history.replaceState({}, '', HOME_URL);
    feedPage(40);
    await module.init();
    await vi.advanceTimersByTimeAsync(CAPTURE_THROTTLE_MS);
    scrollTo(900);
    navigate('/anime/2/Entry', 'push');
    expect(stored(HOME_URL)).toMatchObject({
      kind: 'scrollLoader',
      scrollY: 900,
      loaded: 40 * ROW_HEIGHT,
      loaderIndex: 0,
      filters: null,
    });
  });

  it('replays a feed with the loader it recorded', async () => {
    history.replaceState({}, '', HOME_URL);
    feedPage(60);
    await module.init();
    scrollTo(2500);
    leaveByClick();
    feedPage(20);
    navigate(HOME_URL, 'traverse');
    const [snapshot, adapter] = restorer.restore.mock.calls[0];
    expect(snapshot).toMatchObject({ loaded: 60 * ROW_HEIGHT, scrollY: 2500 });
    expect(adapter).toMatchObject({ kind: 'scrollLoader', loaderIndex: 0, loadsInPlace: true });
  });

  it('records nothing on a page without growing content', async () => {
    history.replaceState({}, '', '/anime/5/Title');
    document.body.innerHTML = '<div class="media-page"><a href="/anime/6">Next</a></div>';
    await module.init();
    scrollTo(700);
    leaveByClick();
    expect(stored('/anime/5/Title')).toBeNull();
  });

  it('tracks the real state again as soon as the user takes over a restore', async () => {
    await module.init();
    scrollTo(1200);
    leaveByClick();
    restorer.restore.mockReturnValueOnce(deferred<RestoreOutcome>().promise);
    listPage(30);
    navigate(LIST_URL, 'traverse');
    scrollTo(9000);
    restorer.hasUserTakenOver.mockReturnValue(true);
    scrollTo(300);
    navigate('/anime/9/Other', 'push');
    expect(stored(LIST_URL)).toMatchObject({ scrollY: 300 });
  });

  it('starts fresh on a new visit: no restore, and an older snapshot for the key is dropped', async () => {
    await module.init();
    scrollTo(1200);
    leaveByClick();
    listPage();
    navigate(LIST_URL, 'push');
    expect(restorer.restore).not.toHaveBeenCalled();
    expect(stored(LIST_URL)).toBeNull();
  });

  it('ignores a snapshot recorded for another URL of the same history entry', async () => {
    (window as { navigation?: unknown }).navigation = { currentEntry: { key: 'entry-1' } };
    await module.init();
    store.save({
      ...stored(LIST_URL)!,
      key: 'entry:entry-1',
      url: '/user/Friend/animelist',
      kind: 'mediaList',
      scrollY: 1,
      loaded: 1,
      loaderIndex: null,
      filters: null,
      capturedAt: 1,
    } as PageStateSnapshot);
    navigate(LIST_URL, 'traverse');
    expect(restorer.restore).not.toHaveBeenCalled();
  });

  it('keeps what the user left when they navigate away mid-restore', async () => {
    await module.init();
    scrollTo(1200);
    leaveByClick();
    const original = stored(LIST_URL);
    const pending = deferred<RestoreOutcome>();
    restorer.restore.mockReturnValueOnce(pending.promise);
    listPage(30);
    navigate(LIST_URL, 'traverse');
    // Programmatic loading scrolls and clicks: none of it is the user's state.
    scrollTo(9000);
    document.querySelector<HTMLElement>('a')!.click();
    await vi.advanceTimersByTimeAsync(CAPTURE_THROTTLE_MS);
    navigate('/anime/9/Other', 'push');
    expect(restorer.abort).toHaveBeenCalled();
    expect(stored(LIST_URL)).toEqual(original);
    pending.resolve('aborted');
  });

  it('tracks the real state again once a restore has finished', async () => {
    await module.init();
    leaveByClick();
    listPage(5);
    navigate(LIST_URL, 'traverse');
    await vi.advanceTimersByTimeAsync(0);
    scrollTo(450);
    navigate('/anime/1/Title', 'push');
    expect(stored(LIST_URL)).toMatchObject({ scrollY: 450, loaded: 5 });
  });

  it('persists the live state when the document is unloaded', async () => {
    await module.init();
    scrollTo(700);
    window.dispatchEvent(new Event('pagehide'));
    expect(new PageStateStore().get(`url:${LIST_URL}`)).toMatchObject({
      scrollY: 700,
      loaded: 3,
    });
  });

  it('restores on start-up when the document itself was loaded by Back', async () => {
    store.save({
      key: `url:${LIST_URL}`,
      url: LIST_URL,
      kind: 'mediaList',
      scrollY: 800,
      loaded: 30,
      loaderIndex: null,
      filters: null,
      capturedAt: 1,
    });
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'back_forward', name: location.href } as unknown as PerformanceEntry,
    ]);
    await module.init();
    expect(restorer.restore).toHaveBeenCalledWith(
      expect.objectContaining({ scrollY: 800 }),
      expect.objectContaining({ kind: 'mediaList' }),
      expect.any(Function)
    );
  });

  it('stops tracking and restoring after destroy', async () => {
    await module.init();
    await module.destroy();
    expect(restorer.abort).toHaveBeenCalled();
    scrollTo(1200);
    leaveByClick();
    window.dispatchEvent(new Event('pagehide'));
    expect(stored(LIST_URL)).toBeNull();
    navigate(LIST_URL, 'traverse');
    expect(restorer.restore).not.toHaveBeenCalled();
  });
});
