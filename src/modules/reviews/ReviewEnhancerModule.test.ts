import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ReviewEnhancerModule } from './ReviewEnhancerModule';

const originalUrl = location.href;
const testDom = (globalThis as typeof globalThis & { jsdom: { reconfigure(options: { url: string }): void } }).jsdom;

describe('review cards lifecycle', () => {
  let module: ReviewEnhancerModule;
  let bus: EventBus;
  let resolve: (value: { id: number; score: number }[]) => void;
  let service: { getReviewBatch: ReturnType<typeof vi.fn> };
  let observer: { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
  const card = () => {
    document.body.innerHTML = '<div class="review-card"><a href="/review/7">Review</a><div class="cover"></div></div>';
  };
  const run = () => (module as unknown as { executeBatchCycle(): Promise<void> }).executeBatchCycle();
  const scan = () => (module as unknown as { scanAndQueue(): void }).scanAndQueue();
  beforeEach(() => {
    vi.useFakeTimers();
    testDom.reconfigure({ url: 'https://anilist.co/home' });
    history.replaceState({}, '', '/home');
    card();
    bus = new EventBus();
    service = { getReviewBatch: vi.fn(async () => [{ id: 7, score: 80 }]) };
    observer = { register: vi.fn(), unregister: vi.fn() };
    module = new ReviewEnhancerModule(service as never, observer as never, bus);
  });
  afterEach(async () => { await module.destroy(); vi.useRealTimers(); document.body.innerHTML = ''; testDom.reconfigure({ url: originalUrl }); });

  it('renders cached scores into replacement cards with the same IDs', async () => {
    await module.init();
    await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
    card();
    scan();
    await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
  });
  it.each(['destroy', 'navigate'] as const)('discards a late batch after %s', async action => {
    service.getReviewBatch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await module.init();
    const pending = run();
    if (action === 'destroy') await module.destroy();
    else {
      history.replaceState({}, '', '/user/other/reviews');
      bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath: '/home', timestamp: new Date() });
    }
    resolve([{ id: 7, score: 80 }]);
    await pending;
    expect(document.querySelector('.au-review-rating')).toBeNull();
  });
  it('does not attach a previous review score to a reused card', async () => {
    service.getReviewBatch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await module.init();
    const pending = run();
    document.querySelector('a')!.setAttribute('href', '/review/8');
    resolve([{ id: 7, score: 80 }]);
    await pending;
    expect(document.querySelector('.au-review-rating')).toBeNull();
  });
  it('replaces a settled badge when the same card changes review identity', async () => {
    service.getReviewBatch.mockImplementation(async (ids: number[]) => ids.map(id => ({ id, score: id === 7 ? 80 : 20 })));
    await module.init(); await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
    document.querySelector('a')!.setAttribute('href', '/review/8');
    scan();
    expect(document.querySelector('.au-review-rating')).toBeNull();
    await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('20');
  });
  it('renders every simultaneous card for the same review with one batch ID', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="review-card"><a href="/review/7">B</a></div>');
    await module.init(); await run();
    expect(service.getReviewBatch).toHaveBeenCalledExactlyOnceWith([7], 25);
    expect(document.querySelectorAll('.au-review-rating')).toHaveLength(2);
  });
  it('does not reuse an old A response after observed A to B to A reuse', async () => {
    service.getReviewBatch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await module.init(); const pending = run();
    document.querySelector('a')!.setAttribute('href', '/review/8'); scan();
    document.querySelector('a')!.setAttribute('href', '/review/7'); scan();
    resolve([{ id: 7, score: 80 }]); await pending;
    expect(document.querySelector('.au-review-rating')).toBeNull();
    service.getReviewBatch.mockResolvedValueOnce([{ id: 7, score: 30 }]);
    await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('30');
  });
  it('recovers a badge removed from a still current card', async () => {
    await module.init(); await run();
    document.querySelector('.au-review-rating')!.remove(); scan(); await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
  });
  it.each(['removed', 'navigate', 'destroy'] as const)('restores position owned by the badge on %s', async action => {
    const cover = document.querySelector<HTMLElement>('.cover')!;
    cover.style.setProperty('position', 'absolute', 'important');
    await module.init(); await run();
    expect(cover.style.position).toBe('relative');
    if (action === 'removed') { document.querySelector('.review-card')!.remove(); scan(); }
    else if (action === 'destroy') await module.destroy();
    else { history.replaceState({}, '', '/user/other/reviews'); bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath: '/home', timestamp: new Date() }); }
    expect(cover.style.position).toBe('absolute');
    expect(cover.style.getPropertyPriority('position')).toBe('important');
    expect(cover.querySelector('.au-review-rating')).toBeNull();
  });
  it('preserves later native position changes and foreign badges at teardown', async () => {
    const cover = document.querySelector<HTMLElement>('.cover')!;
    await module.init(); await run();
    cover.style.setProperty('position', 'sticky', 'important');
    document.body.insertAdjacentHTML('beforeend', '<div class="au-review-rating" id="foreign">native</div>');
    await module.destroy();
    expect(cover.style.position).toBe('sticky');
    expect(cover.style.getPropertyPriority('position')).toBe('important');
    expect(document.getElementById('foreign')).not.toBeNull();
  });
  it.each(['/review/0', '/review/07', '/review/2147483648', '/review/7oops', '/review/7/other', '/character/3/review/7',
    'http://anilist.co/review/7', 'https://user:secret@anilist.co/review/7', 'https://anilist.co:444/review/7', 'https://evil.test/review/7', '//evil.test/review/7', 'https://anilist.co.evil.test/review/7', 'javascript:alert("/review/7")'])('rejects foreign or inexact review href %s', async href => {
    document.querySelector('a')!.setAttribute('href', href);
    await module.init(); await run();
    expect(service.getReviewBatch).not.toHaveBeenCalled();
    expect(document.querySelector('.au-review-rating')).toBeNull();
  });
  it.each(['/review/2147483647', 'https://anilist.co/review/7?view=full#top'])('accepts canonical same-origin review href %s', async href => {
    document.querySelector('a')!.setAttribute('href', href);
    service.getReviewBatch.mockImplementation(async (ids: number[]) => ids.map(id => ({ id, score: 0 })));
    await module.init(); await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('0');
  });
  it.each(['/notuser/name/reviews', '/character/1/reviews', '/anime/7oops/reviews'])('does not fetch on excluded route %s', async path => {
    history.replaceState({}, '', path);
    await module.init(); await run();
    expect(service.getReviewBatch).not.toHaveBeenCalled();
  });
  it('discards a detached pending card and restores a replacement card independently', async () => {
    service.getReviewBatch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await module.init(); const pending = run();
    const oldCard = document.querySelector('.review-card')!;
    card(); scan();
    resolve([{ id: 7, score: 80 }]); await pending;
    expect(oldCard.querySelector('.au-review-rating')).toBeNull();
    expect(document.querySelector('.au-review-rating')).toBeNull();
    await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
  });
  it('releases a badge when the card stops linking a valid review', async () => {
    await module.init(); await run();
    document.querySelector('a')!.setAttribute('href', '/character/7'); scan(); await run();
    expect(document.querySelector('.au-review-rating')).toBeNull();
    expect(document.querySelector<HTMLElement>('.cover')!.style.position).toBe('');
  });
  it('filters unrelated child-list changes but accepts nested card additions and owned badge removal', async () => {
    await module.init(); await run();
    const filter = observer.register.mock.calls[0][3] as (mutations: MutationRecord[]) => boolean;
    const irrelevant = document.createElement('div'); document.body.appendChild(irrelevant);
    const change = (target: Node, added: Node[] = [], removed: Node[] = []) => ({ target, addedNodes: added, removedNodes: removed } as unknown as MutationRecord);
    expect(filter([change(irrelevant, [document.createElement('p')])])).toBe(false);
    const nested = document.createElement('section'); nested.innerHTML = '<div class="review-card"><a href="/review/8">B</a></div>';
    expect(filter([change(document.body, [nested])])).toBe(true);
    const badge = document.querySelector('.au-review-rating')!;
    const parent = badge.parentElement!; badge.remove();
    expect(filter([change(parent, [], [badge])])).toBe(true);
  });
  it('retries a failed batch without publishing a badge or retaining a pending binding', async () => {
    service.getReviewBatch.mockRejectedValueOnce(new Error('provider unavailable'));
    await module.init(); await run();
    expect(document.querySelector('.au-review-rating')).toBeNull();
    scan(); await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
  });
  it('stops re-queuing a review that never yields a badge after the attempt cap', async () => {
    service.getReviewBatch.mockResolvedValue([]);
    await module.init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getReviewBatch).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.au-review-rating')).toBeNull();
  });
  it('stops retrying a batch that keeps failing after the attempt cap', async () => {
    service.getReviewBatch.mockRejectedValue(new Error('provider unavailable'));
    await module.init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getReviewBatch).toHaveBeenCalledTimes(2);
  });
  it('restores the attempt budget for a review after page change', async () => {
    service.getReviewBatch.mockResolvedValue([]);
    await module.init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getReviewBatch).toHaveBeenCalledTimes(2);
    history.replaceState({}, '', '/reviews');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/reviews', previousPath: '/home', timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getReviewBatch).toHaveBeenCalledTimes(4);
  });
  it('keeps a copied debounce callback inert after destroy and reinitialization', async () => {
    const timers = vi.spyOn(window, 'setTimeout');
    try {
      await module.init();
      const obsolete = timers.mock.calls.find(call => call[1] === 2000)?.[0];
      expect(typeof obsolete).toBe('function');
      await module.destroy(); await module.init();
      (obsolete as () => void)();
      expect(service.getReviewBatch).not.toHaveBeenCalled();
      await run();
      expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
    } finally { timers.mockRestore(); }
  });
  it('keeps captured callbacks inert after navigation and reinitialization', async () => {
    await module.init();
    const obsolete = observer.register.mock.calls[0][1] as () => void;
    await module.destroy(); await module.init();
    await run();
    document.querySelector('.au-review-rating')!.remove();
    obsolete(); await run();
    expect(document.querySelector('.au-review-rating')).toBeNull();
    scan(); await run();
    expect(document.querySelector('.au-review-rating')?.textContent).toBe('80');
  });
});
