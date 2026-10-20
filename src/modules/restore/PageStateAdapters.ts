/**
 * @file PageStateAdapters.ts
 * @description Per-page knowledge used to capture and replay page snapshots
 *
 * An adapter answers, for one kind of restorable page:
 *   - is the page rendered enough to read or restore it?
 *   - how much content is loaded right now?
 *   - which filters live only in component state, and how to re-apply them?
 *   - how to ask the page for more content?
 *
 * Media lists render the whole (already fetched) list 30 entries at a time, whenever
 * the viewport nears the end of a section: scrolling to the bottom always satisfies
 * that check, so loading them moves the window.
 *
 * Every other growing page (Browse, Home and profile activity feeds, social tabs,
 * reviews...) uses AniList's scroll loader: an empty `.scroller` sentinel rendered
 * after the content, which fetches the next page when it is inside the viewport during
 * a scroll event, and which some pages pause behind a "Load More" button every few
 * pages. After a Back navigation that content restarts from its first page, while the
 * router restores the old offset over a mostly empty column. The loader only checks
 * the sentinel's on-screen geometry, so the restore shifts the (hidden) sentinel into
 * the viewport with a transform and notifies a scroll: the next page loads in place,
 * without ever moving the window or the content the user is looking at.
 *
 * @see PageStateRestorer.ts for the loop that drives an adapter
 */

import type { MediaListFilterState, RestorablePageKind, RestoreRunControl } from './PageStateTypes';
import { applyMediaListFilters, readMediaListFilters } from './MediaListFilterControls';

export interface PageStateAdapter {
  readonly kind: RestorablePageKind;
  /** Upper bound of load-more rounds a restore may spend on this page. */
  readonly maxLoadSteps: number;
  /** True when requestMore() never moves the window, so loading may go on while the user scrolls. */
  readonly loadsInPlace: boolean;
  /** Scroll loader of the page this adapter measures (document order); null when not applicable. */
  readonly loaderIndex: number | null;
  isReady(): boolean;
  /** Monotonic measure of the loaded content (see PageStateSnapshot.loaded). */
  measureLoaded(): number;
  /** Filters held only in component state; null when the page has none to restore. */
  readFilters(): MediaListFilterState | null;
  /** Re-apply filters; resolves true when the page reads back the target state. */
  applyFilters(filters: MediaListFilterState, control: RestoreRunControl): Promise<boolean>;
  requestMore(): void;
  /** Undo any temporary DOM change made while loading. */
  release(): void;
}

const MEDIA_LIST_SELECTORS = {
  ready: '.medialist .filters-wrap',
  items: '.medialist .list-entries .entry, .medialist .list-entries .entry-card',
} as const;

/** The scroll-load component's root; AniList renders this class nowhere else. */
const LOADER_SENTINEL = '.scroller';
/** Rendered inside the sentinel while the loader is paused. */
const LOADER_RESUME = '.load-more';
/** Shift (px) the restore applied to a sentinel, so layout positions stay measurable. */
const SHIFT_ATTRIBUTE = 'data-au-restore-shift';

/** Local rendering steps are cheap: 80 × 30 entries. */
const MEDIA_LIST_MAX_STEPS = 80;
/** Each loader step is an AniList API request; the API budget is shared with the site. */
const SCROLL_LOADER_MAX_STEPS = 25;

/** Jump (never animate, whatever the page CSS says) to a vertical offset. */
export function scrollWindowTo(top: number): void {
  window.scrollTo({ top, left: 0, behavior: 'instant' });
}

/** Largest reachable vertical scroll offset of the document. */
export function maxScrollY(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/** Every AniList scroll loader of the page, in document order. */
function loaderSentinels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(LOADER_SENTINEL));
}

/** Document offset of an element's layout box, ignoring a shift the restore applied to it. */
function layoutTop(element: HTMLElement): number {
  const shift = Number(element.getAttribute(SHIFT_ATTRIBUTE)) || 0;
  return element.getBoundingClientRect().top + window.scrollY - shift;
}

/**
 * The loader whose content the viewport shows: a sentinel closes its content, so it is
 * the first one ending below the viewport top (or the last one, past every loader).
 */
function loaderNearViewport(sentinels: readonly HTMLElement[]): number | null {
  if (sentinels.length === 0) return null;
  const below = sentinels.findIndex((sentinel) => layoutTop(sentinel) >= window.scrollY);
  return below >= 0 ? below : sentinels.length - 1;
}

export class MediaListPageAdapter implements PageStateAdapter {
  public readonly kind = 'mediaList' as const;
  public readonly maxLoadSteps = MEDIA_LIST_MAX_STEPS;
  public readonly loadsInPlace = false;
  public readonly loaderIndex = null;

  public isReady(): boolean {
    return !!document.querySelector(MEDIA_LIST_SELECTORS.ready);
  }

  public measureLoaded(): number {
    return document.querySelectorAll(MEDIA_LIST_SELECTORS.items).length;
  }

  public readFilters(): MediaListFilterState | null {
    return readMediaListFilters(document);
  }

  public applyFilters(filters: MediaListFilterState, control: RestoreRunControl): Promise<boolean> {
    return applyMediaListFilters(filters, control, document);
  }

  public requestMore(): void {
    const before = window.scrollY;
    scrollWindowTo(maxScrollY());
    // Already at the bottom: no scroll event would fire, so nudge one.
    if (window.scrollY === before) window.dispatchEvent(new Event('scroll'));
  }

  public release(): void {
    // Nothing temporary: list rendering is driven by real scrolling.
  }
}

/** Inline styles of a sentinel before the restore shifted it. */
interface PulledSentinel {
  readonly element: HTMLElement;
  readonly transform: string;
  readonly visibility: string;
  readonly pointerEvents: string;
}

export class ScrollLoaderPageAdapter implements PageStateAdapter {
  public readonly kind = 'scrollLoader' as const;
  public readonly maxLoadSteps = SCROLL_LOADER_MAX_STEPS;
  public readonly loadsInPlace = true;
  public readonly loaderIndex: number | null;
  private pulled: PulledSentinel | null = null;

  /** @param loaderIndex loader to drive; null picks the one the viewport is showing. */
  constructor(loaderIndex: number | null = null) {
    this.loaderIndex = loaderIndex ?? loaderNearViewport(loaderSentinels());
  }

  public isReady(): boolean {
    return this.sentinel() !== null;
  }

  /**
   * How far the loader's content reaches: the sentinel's layout offset from the top of
   * its container, so content appearing above the feed (calendar, banners) never counts.
   */
  public measureLoaded(): number {
    const sentinel = this.sentinel();
    if (!sentinel) return 0;
    const container = sentinel.parentElement;
    const origin = container ? container.getBoundingClientRect().top + window.scrollY : 0;
    return Math.max(0, Math.round(layoutTop(sentinel) - origin));
  }

  public readFilters(): MediaListFilterState | null {
    return null;
  }

  public async applyFilters(): Promise<boolean> {
    // Filters of these pages live in the URL or in AniList's global store.
    return true;
  }

  public requestMore(): void {
    const sentinel = this.sentinel();
    if (!sentinel) return;
    // Resume a paused loader first; it re-checks the sentinel on its next tick.
    sentinel.querySelector<HTMLElement>(LOADER_RESUME)?.click();
    this.pullIntoView(sentinel);
    window.dispatchEvent(new Event('scroll'));
  }

  public release(): void {
    if (!this.pulled) return;
    const { element, transform, visibility, pointerEvents } = this.pulled;
    element.style.transform = transform;
    element.style.visibility = visibility;
    element.style.pointerEvents = pointerEvents;
    element.removeAttribute(SHIFT_ATTRIBUTE);
    this.pulled = null;
  }

  private sentinel(): HTMLElement | null {
    return this.loaderIndex === null ? null : (loaderSentinels()[this.loaderIndex] ?? null);
  }

  /** Shift the hidden sentinel to the middle of the viewport, where the loader looks for it. */
  private pullIntoView(sentinel: HTMLElement): void {
    if (this.pulled && this.pulled.element !== sentinel) this.release();
    if (!this.pulled) {
      const { transform, visibility, pointerEvents } = sentinel.style;
      this.pulled = { element: sentinel, transform, visibility, pointerEvents };
    }
    const shift = Math.round(window.innerHeight / 2 - (layoutTop(sentinel) - window.scrollY));
    sentinel.style.transform = `translateY(${shift}px)`;
    sentinel.style.visibility = 'hidden';
    sentinel.style.pointerEvents = 'none';
    sentinel.setAttribute(SHIFT_ATTRIBUTE, String(shift));
  }
}

/**
 * Adapter for a page kind.
 * @param loaderIndex scroll loader recorded in a snapshot; null picks the one on screen
 */
export function createPageStateAdapter(
  kind: RestorablePageKind,
  loaderIndex: number | null = null
): PageStateAdapter {
  return kind === 'mediaList'
    ? new MediaListPageAdapter()
    : new ScrollLoaderPageAdapter(loaderIndex);
}
