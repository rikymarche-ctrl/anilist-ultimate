import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { ActivityScoreModule } from './ActivityScoreModule';
import type { ActivityScoreData, ActivityService } from './ActivityService';
import { EVENT_TYPES } from '@core/events/EventTypes';

type ScoreMap = Map<string, ActivityScoreData | null>;
interface Internals {
  checkAndProcess(): void;
  processBatch(): Promise<void>;
  stopObservation(): void;
  startObservation(): Promise<void>;
  waitForElement(selector: string, timeout?: number): Promise<HTMLElement | null>;
  registerObserver(...args: unknown[]): void;
}

describe('ActivityScoreModule async lifecycle', () => {
  let module: ActivityScoreModule;
  let internals: Internals;
  let bus: EventBus;
  let clearCache = vi.fn(async () => {});
  let scores = vi.fn(async (): Promise<ScoreMap> => new Map());
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/home');
    document.body.innerHTML = '<div class="activity-entry"><a href="/user/Friend/">Friend</a><a href="/anime/10/title">Title</a></div>';
    scores = vi.fn(async (): Promise<ScoreMap> => new Map());
    bus = new EventBus(); clearCache = vi.fn(async () => {});
    module = new ActivityScoreModule({ getScoresBatch: scores, clearCache } as unknown as ActivityService, bus);
    internals = module as unknown as Internals;
  });
  afterEach(async () => { await module.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('allows retrying a score lookup after a transient failure', async () => {
    internals.checkAndProcess();
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('.activity-entry')!.hasAttribute('data-au-score-enhanced')).toBe(false);
    scores.mockResolvedValue(new Map([['Friend-10', { score: 85, format: 'POINT_100' }]]));
    internals.checkAndProcess();
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('85');
  });

  it('resets the batching timer after stopping so later scans can schedule requests', async () => {
    internals.checkAndProcess();
    internals.stopObservation();
    internals.checkAndProcess();
    await vi.advanceTimersByTimeAsync(1500);
    expect(scores).toHaveBeenCalledTimes(1);
  });

  it('does not register an observer after destroy while waiting for a feed', async () => {
    let resolve!: (value: HTMLElement | null) => void;
    vi.spyOn(internals, 'waitForElement').mockReturnValue(new Promise(r => { resolve = r; }));
    const register = vi.spyOn(internals, 'registerObserver');
    const pending = internals.startObservation();
    await module.destroy();
    resolve(null);
    await pending;
    expect(register).not.toHaveBeenCalled();
  });

  it('ignores an in-flight score response after destroy', async () => {
    let resolve!: (value: ScoreMap) => void;
    scores.mockReturnValue(new Promise(r => { resolve = r; }));
    internals.checkAndProcess();
    const pending = internals.processBatch();
    await module.destroy();
    resolve(new Map([['Friend-10', { score: 90, format: 'POINT_100' }]]));
    await pending;
    expect(document.querySelector('.au-activity-rating')).toBeNull();
  });

  it('can process reused entries after navigation while ignoring an older in-flight batch', async () => {
    let resolve!: (value: ScoreMap) => void;
    scores.mockReturnValueOnce(new Promise(r => { resolve = r; }))
      .mockResolvedValueOnce(new Map([['Friend-10', { score: 80, format: 'POINT_100' }]]));
    internals.checkAndProcess();
    const oldBatch = internals.processBatch();
    internals.stopObservation();
    internals.checkAndProcess();
    await internals.processBatch();
    resolve(new Map([['Friend-10', { score: 90, format: 'POINT_100' }]]));
    await oldBatch;
    expect(scores).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('80');
  });

  it.each(['/character/1/social', '/staff/2/social', '/search/user/Friend', '/social', '/homework', '/activity/10evil', '/activity/2147483648', '/anime/2147483648/social'])('excludes unrelated routes: %s', async path => {
    history.replaceState({}, '', path);
    internals.checkAndProcess(); await vi.advanceTimersByTimeAsync(2000);
    expect(scores).not.toHaveBeenCalled();
  });

  it.each(['/', '/home/', '/user/Friend/', '/anime/10/title/social', '/manga/10/social', '/activity/99'])('processes supported feed routes: %s', async path => {
    history.replaceState({}, '', path);
    scores.mockResolvedValue(new Map([['Friend-10', { score: 85, format: 'POINT_100' }]]));
    internals.checkAndProcess(); await vi.advanceTimersByTimeAsync(1500);
    expect(scores).toHaveBeenCalledExactlyOnceWith([{ userName: 'Friend', mediaId: 10 }]);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('85');
  });

  it('decodes a profile username and rejects malformed media IDs', async () => {
    const user = document.querySelector('a[href^="/user/"]')!;
    const media = document.querySelector('a[href^="/anime/"]')!;
    user.setAttribute('href', '/user/Friend%20Name/');
    internals.checkAndProcess(); await internals.processBatch();
    expect(scores).toHaveBeenLastCalledWith([{ userName: 'Friend Name', mediaId: 10 }]);
    for (const href of ['/anime/10evil', '/anime/2147483648/title', '/anime/0/title']) {
      internals.stopObservation(); media.setAttribute('href', href);
      internals.checkAndProcess(); await internals.processBatch();
    }
    expect(scores).toHaveBeenCalledTimes(1);
  });

  it('processes nested selectors once and rescans entries whose identity changed', async () => {
    document.body.innerHTML = '<div class="activity-entry"><div class="list small"><a href="/user/Friend/">Friend</a><a href="/anime/10/title">Title</a></div></div>';
    scores.mockResolvedValueOnce(new Map([['Friend-10', { score: 85, format: 'POINT_100' }]]))
      .mockResolvedValueOnce(new Map([['Friend-20', { score: 70, format: 'POINT_100' }]]));
    internals.checkAndProcess(); await internals.processBatch();
    expect(document.querySelectorAll('.au-activity-rating')).toHaveLength(1);
    document.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    internals.checkAndProcess();
    expect(document.querySelector('.au-activity-rating')).toBeNull();
    await internals.processBatch();
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('70');
    expect(scores).toHaveBeenCalledTimes(2);
  });

  it('does not apply a response to a node reused for another media before a rescan', async () => {
    let resolve!: (value: ScoreMap) => void;
    scores.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(new Map([['Friend-20', { score: 70, format: 'POINT_100' }]]));
    internals.checkAndProcess(); const pending = internals.processBatch();
    document.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    resolve(new Map([['Friend-10', { score: 90, format: 'POINT_100' }]])); await pending;
    expect(document.querySelector('.au-activity-rating')).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('70');
  });

  it('preserves the latest token when a pending node changes A to B to A', async () => {
    let resolve!: (value: ScoreMap) => void;
    scores.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(new Map([['Friend-10', { score: 75, format: 'POINT_100' }]]));
    internals.checkAndProcess(); const pending = internals.processBatch();
    const link = document.querySelector('a[href^="/anime/"]')!;
    link.setAttribute('href', '/anime/20/title'); internals.checkAndProcess();
    link.setAttribute('href', '/anime/10/title'); internals.checkAndProcess();
    resolve(new Map([['Friend-10', { score: 90, format: 'POINT_100' }]])); await pending;
    expect(document.querySelector('.au-activity-rating')).toBeNull();
    await internals.processBatch();
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('75');
  });

  it('removes old account badges immediately and refetches after cache invalidation', async () => {
    document.body.firstElementChild!.classList.add('activity-feed');
    scores.mockResolvedValueOnce(new Map([['Friend-10', { score: 85, format: 'POINT_100' }]]))
      .mockResolvedValueOnce(new Map([['Friend-10', { score: 70, format: 'POINT_100' }]]));
    await module.init(); await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('85');
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(document.querySelector('.au-activity-rating')).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('70');
  });

  it('retries entries previously marked as no score after the media changes', async () => {
    scores.mockResolvedValueOnce(new Map([['Friend-10', null]]))
      .mockResolvedValueOnce(new Map([['Friend-20', { score: 80, format: 'POINT_100' }]]));
    internals.checkAndProcess(); await internals.processBatch();
    document.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    internals.checkAndProcess(); await internals.processBatch();
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('80');
  });

  it('requeues a row changed before its batch begins without querying the old media', async () => {
    scores.mockResolvedValue(new Map([['Friend-20', { score: 80, format: 'POINT_100' }]]));
    internals.checkAndProcess();
    document.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    await vi.advanceTimersByTimeAsync(3000);
    expect(scores).toHaveBeenCalledExactlyOnceWith([{ userName: 'Friend', mediaId: 20 }]);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('80');
  });

  it('observes actual href changes and clears timers and observers on destruction', async () => {
    document.body.innerHTML = `<div class="activity-feed">${document.body.innerHTML}</div>`;
    scores.mockResolvedValueOnce(new Map([['Friend-10', { score: 85, format: 'POINT_100' }]]))
      .mockResolvedValueOnce(new Map([['Friend-20', { score: 70, format: 'POINT_100' }]]));
    await module.init(); await vi.advanceTimersByTimeAsync(1500);
    document.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.au-activity-rating')?.textContent).toBe('70');
    await module.destroy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.au-activity-rating')).toBeNull();
  });

  it('does not restart an obsolete account handler after navigation or destroy', async () => {
    document.body.innerHTML = `<div class="activity-feed">${document.body.innerHTML}</div>`;
    let resolve!: () => void; clearCache.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await module.init();
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    history.replaceState({}, '', '/character/1/social');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/character/1/social', previousPath: '/home', timestamp: new Date() });
    await module.destroy(); resolve(); await vi.advanceTimersByTimeAsync(2000);
    expect(scores).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
