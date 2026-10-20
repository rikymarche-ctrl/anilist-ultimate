import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaListPageAdapter,
  ScrollLoaderPageAdapter,
  createPageStateAdapter,
} from './PageStateAdapters';

const VIEWPORT = 900;
let documentHeight = 0;

/**
 * jsdom has no layout: give an element a document offset, honouring the translateY a
 * restore applies, as a browser's getBoundingClientRect would.
 */
function place(element: Element, layoutTop: number): void {
  element.getBoundingClientRect = () => {
    const shift = Number(
      /translateY\((-?\d+(?:\.\d+)?)px\)/.exec((element as HTMLElement).style.transform)?.[1] ?? 0
    );
    const top = layoutTop - window.scrollY + shift;
    return { top, bottom: top, height: 0, left: 0, right: 0, width: 0 } as DOMRect;
  };
}

/** Two AniList scroll loaders, e.g. a feed column and a threads column. */
function twoLoaders(): HTMLElement[] {
  document.body.innerHTML = `
    <div class="activity-feed-wrap"><div class="activity-feed"></div><div class="scroller"><div class="load-more">Load More</div></div></div>
    <div class="threads"><div class="thread"></div><div class="scroller"></div></div>`;
  const [feed, threads] = Array.from(document.querySelectorAll<HTMLElement>('.scroller'));
  place(feed.parentElement!, 200);
  place(feed, 1200);
  place(threads.parentElement!, 1500);
  place(threads, 5000);
  return [feed, threads];
}

describe('page state adapters', () => {
  let scrolled: ReturnType<typeof vi.fn>;
  let nudges: number;
  const countNudges = () => {
    nudges++;
  };
  beforeEach(() => {
    nudges = 0;
    documentHeight = 8000;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: VIEWPORT,
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => documentHeight,
    });
    scrolled = vi.fn((options: ScrollToOptions) => {
      window.scrollY = options.top ?? 0;
    });
    window.scrollTo = scrolled as unknown as typeof window.scrollTo;
    window.addEventListener('scroll', countNudges);
  });
  afterEach(() => {
    window.removeEventListener('scroll', countNudges);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('picks the adapter for a page kind', () => {
    twoLoaders();
    expect(createPageStateAdapter('mediaList')).toBeInstanceOf(MediaListPageAdapter);
    expect(createPageStateAdapter('scrollLoader')).toBeInstanceOf(ScrollLoaderPageAdapter);
    expect(createPageStateAdapter('scrollLoader', 1).loaderIndex).toBe(1);
  });

  describe('AniList scroll loaders (Browse, Home and profile feeds, social tabs...)', () => {
    it('measures the loader whose content the viewport is showing', () => {
      twoLoaders();
      expect(new ScrollLoaderPageAdapter().loaderIndex).toBe(0);
      window.scrollY = 2000;
      expect(new ScrollLoaderPageAdapter().loaderIndex).toBe(1);
      window.scrollY = 6000;
      expect(new ScrollLoaderPageAdapter().loaderIndex).toBe(1);
    });

    it('is not ready on a page without a loader', () => {
      document.body.innerHTML = '<div class="media-page"></div>';
      const adapter = new ScrollLoaderPageAdapter();
      expect(adapter.loaderIndex).toBeNull();
      expect(adapter.isReady()).toBe(false);
      expect(adapter.measureLoaded()).toBe(0);
      expect(adapter.loadsInPlace).toBe(true);
      expect(adapter.readFilters()).toBeNull();
    });

    it('measures how far the content reaches inside its container, ignoring content above it', () => {
      const [feed] = twoLoaders();
      const adapter = new ScrollLoaderPageAdapter(0);
      expect(adapter.isReady()).toBe(true);
      expect(adapter.measureLoaded()).toBe(1000);
      // A calendar rendered above the feed pushes the whole column down.
      place(feed.parentElement!, 500);
      place(feed, 1500);
      expect(adapter.measureLoaded()).toBe(1000);
    });

    it('resumes a paused loader and shows it the sentinel without moving the window', () => {
      const [feed] = twoLoaders();
      const resumed = vi.fn();
      feed.querySelector('.load-more')!.addEventListener('click', resumed);
      window.scrollY = 3000;
      const adapter = new ScrollLoaderPageAdapter(0);
      adapter.requestMore();
      expect(resumed).toHaveBeenCalledTimes(1);
      expect(scrolled).not.toHaveBeenCalled();
      expect(window.scrollY).toBe(3000);
      expect(nudges).toBe(1);
      expect(feed.getBoundingClientRect().top).toBe(VIEWPORT / 2);
      expect(feed.style.visibility).toBe('hidden');
      // The layout position (and so the measure) is unaffected by the shift.
      expect(adapter.measureLoaded()).toBe(1000);
      expect(new ScrollLoaderPageAdapter().loaderIndex).toBe(1);
      // Content grew: the next request re-aims from the new layout position.
      place(feed, 1800);
      adapter.requestMore();
      expect(feed.getBoundingClientRect().top).toBe(VIEWPORT / 2);
      expect(adapter.measureLoaded()).toBe(1600);
    });

    it('restores the sentinel exactly as it was, also when AniList re-rendered it', () => {
      const [feed] = twoLoaders();
      feed.style.transform = 'scale(1)';
      const adapter = new ScrollLoaderPageAdapter(0);
      adapter.requestMore();
      adapter.release();
      expect(feed.style.transform).toBe('scale(1)');
      expect(feed.style.visibility).toBe('');
      expect(feed.hasAttribute('data-au-restore-shift')).toBe(false);
      adapter.release();

      adapter.requestMore();
      const fresh = document.createElement('div');
      fresh.className = 'scroller';
      feed.replaceWith(fresh);
      place(fresh, 1300);
      adapter.requestMore();
      expect(feed.style.transform).toBe('scale(1)');
      expect(fresh.style.visibility).toBe('hidden');
      adapter.release();
      expect(fresh.style.transform).toBe('');
    });
  });

  describe('media list', () => {
    const adapter = new MediaListPageAdapter();
    beforeEach(() => {
      document.body.innerHTML = `<div class="medialist"><div class="filters-wrap"></div>
        <div class="list-section"><div class="list-entries"><div class="entry row"></div><div class="entry row"></div></div></div>
        <div class="list-section"><div class="list-entries"><div class="entry-card row"></div></div></div></div>`;
    });

    it('counts rendered rows and cards across sections', () => {
      expect(adapter.isReady()).toBe(true);
      expect(adapter.measureLoaded()).toBe(3);
      expect(adapter.loadsInPlace).toBe(false);
      expect(adapter.loaderIndex).toBeNull();
    });

    it('scrolls to the bottom, where every partially rendered section asks for more', () => {
      documentHeight = 5000;
      adapter.requestMore();
      expect(window.scrollY).toBe(5000 - VIEWPORT);
      adapter.requestMore();
      expect(nudges).toBe(1);
    });
  });
});
