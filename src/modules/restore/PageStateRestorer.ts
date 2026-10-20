/**
 * @file PageStateRestorer.ts
 * @description Replays a page snapshot: filters, then loaded content, then scroll
 *
 * Restore sequence:
 *   1. Wait until the page has rendered (adapter.isReady).
 *   2. Re-apply the filters that only live in component state.
 *   3. Ask the page for more content until it holds as much as the snapshot recorded
 *      and the saved offset is reachable, or until it stops growing.
 *   4. Jump to the saved scroll offset, and once more after late layout shifts.
 *
 * Never fighting the user:
 *   A run listens (capture phase, passive) for trusted wheel, touch, pointer and
 *   key input. From the first one on, the restore never moves the window and never
 *   touches a filter again: a user who scrolls, clicks or types keeps full control.
 *   Content keeps loading only where the adapter loads it in place (scroll loaders),
 *   which changes nothing on screen except the content appearing as it was left.
 *   Events the restore dispatches itself are untrusted and never count. Navigation
 *   away cancels the run through abort().
 *
 * Bounded: page readiness, every load step and the whole run have timeouts, and
 * each adapter caps how many load rounds a restore may spend.
 *
 * @see PageStateAdapters.ts for the per-page operations
 * @see PageStateRestoreModule.ts for when a restore starts
 */

import { injectable } from 'tsyringe';
import { logger } from '@core/logger';
import type { PageStateSnapshot, RestoreRunControl } from './PageStateTypes';
import { maxScrollY, scrollWindowTo, type PageStateAdapter } from './PageStateAdapters';

/**
 * - restored: filters, content and offset are back
 * - partial: the page could not grow (or filter) as far as recorded; offset restored as far as it goes
 * - interrupted: the user took over; content loaded in place where possible, offset left alone
 * - aborted: cancelled (navigation away, newer run)
 * - not-ready: the page never rendered
 */
export type RestoreOutcome = 'restored' | 'partial' | 'interrupted' | 'aborted' | 'not-ready';

export const RESTORE_TIMING = {
  POLL_MS: 50,
  SETTLE_MS: 30,
  READY_TIMEOUT_MS: 10_000,
  /** One scroll-loader step is an API round trip; leave room for a slow response. */
  STEP_TIMEOUT_MS: 6_000,
  /** Re-aim at the loader this often while a step has not grown the page yet. */
  NUDGE_MS: 1_000,
  RUN_TIMEOUT_MS: 45_000,
  /** Second scroll pass after images and late rows have taken their space. */
  LAYOUT_SETTLE_MS: 250,
  /** Minimum spacing between scroll-loader steps: back-to-back requests exhaust the API rate limit. */
  SCROLL_LOADER_MIN_INTERVAL_MS: 1_500,
} as const;

/** Trusted input that means "the user took over". */
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown'] as const;
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A touchpad swipe-back gesture is a horizontal wheel stream whose momentum keeps
 * arriving after the navigation; it is not a request to scroll the restored page.
 */
function isHorizontalWheel(event: Event): boolean {
  if (event.type !== 'wheel') return false;
  const { deltaX = 0, deltaY = 0 } = event as Partial<WheelEvent>;
  return Math.abs(deltaX) >= Math.abs(deltaY);
}

/** One restore attempt: cancellation, user takeover, deadline. */
class RestoreRun implements RestoreRunControl {
  private cancelledFlag = false;
  private userActiveFlag = false;
  private readonly deadline = Date.now() + RESTORE_TIMING.RUN_TIMEOUT_MS;
  private readonly expectedLocation: string;

  constructor(expectedLocation: string) {
    this.expectedLocation = expectedLocation;
    USER_INPUT_EVENTS.forEach((type) =>
      window.addEventListener(type, this.handleUserInput, LISTENER_OPTIONS)
    );
  }

  /** Stop driving page controls: the run was cancelled or the user took over. */
  public get aborted(): boolean {
    return this.cancelledFlag || this.userActiveFlag;
  }

  public get cancelled(): boolean {
    return this.cancelledFlag;
  }

  public get userActive(): boolean {
    return this.userActiveFlag;
  }

  public get expired(): boolean {
    return Date.now() > this.deadline;
  }

  public cancel(): void {
    this.cancelledFlag = true;
  }

  /** Cancels the run once the window left the snapshot's pathname and query (Back/Forward, in-page route change). */
  public checkLocation(): boolean {
    if (`${window.location.pathname}${window.location.search}` !== this.expectedLocation) this.cancelledFlag = true;
    return !this.cancelledFlag;
  }

  /** Loading may go on: still on the snapshot's location, not cancelled, and invisible to a user who took over. */
  public canLoad(adapter: PageStateAdapter): boolean {
    return this.checkLocation() && (!this.userActiveFlag || adapter.loadsInPlace);
  }

  /** Cancellable sleep: returns early when the run is cancelled or the user takes over. */
  public async pause(ms: number): Promise<void> {
    await this.waitFor(() => false, ms, () => !this.aborted);
  }

  public waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    return this.waitFor(predicate, timeoutMs, () => !this.aborted);
  }

  /** Poll until the predicate holds; false on timeout or as soon as `keepGoing` fails. */
  public async waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    keepGoing: () => boolean
  ): Promise<boolean> {
    const until = Math.min(Date.now() + timeoutMs, this.deadline);
    while (keepGoing()) {
      if (predicate()) return true;
      if (Date.now() >= until) return false;
      await delay(RESTORE_TIMING.POLL_MS);
    }
    return false;
  }

  public settle(): Promise<void> {
    return delay(RESTORE_TIMING.SETTLE_MS);
  }

  public dispose(): void {
    USER_INPUT_EVENTS.forEach((type) =>
      window.removeEventListener(type, this.handleUserInput, LISTENER_OPTIONS)
    );
  }

  private handleUserInput = (event: Event): void => {
    if (!event.isTrusted || this.userActiveFlag || isHorizontalWheel(event)) return;
    this.userActiveFlag = true;
    logger.debug(`[PageState] User took over the restore (${event.type})`);
  };
}

@injectable()
export class PageStateRestorer {
  private current: RestoreRun | null = null;

  /** True while a restore run is in progress. */
  public isRunning(): boolean {
    return this.current !== null;
  }

  /** True when the user has interacted since the current run started. */
  public hasUserTakenOver(): boolean {
    return this.current?.userActive ?? false;
  }

  /** Cancel the run in progress, if any. Safe to call at any time. */
  public abort(): void {
    this.current?.cancel();
  }

  /**
   * Restore a snapshot on the page the adapter drives.
   * Starting a new run cancels the previous one.
   *
   * @param isPageCurrent extra readiness condition, e.g. "the router has rendered
   *   the destination" (the previous page may still be on screen after a Back)
   */
  public async restore(
    snapshot: PageStateSnapshot,
    adapter: PageStateAdapter,
    isPageCurrent: () => boolean = () => true
  ): Promise<RestoreOutcome> {
    this.abort();
    const run = new RestoreRun(snapshot.url);
    this.current = run;
    try {
      const outcome = await this.execute(run, snapshot, adapter, isPageCurrent);
      logger.debug(`[PageState] Restore ${outcome}: ${snapshot.url}`);
      return outcome;
    } finally {
      adapter.release();
      run.dispose();
      if (this.current === run) this.current = null;
    }
  }

  private async execute(
    run: RestoreRun,
    snapshot: PageStateSnapshot,
    adapter: PageStateAdapter,
    isPageCurrent: () => boolean
  ): Promise<RestoreOutcome> {
    const stopped = (): RestoreOutcome => (run.cancelled ? 'aborted' : 'interrupted');
    // A route reusing the same component (list → list) still shows the previous
    // render here; let the framework flush before reading the page.
    await run.settle();
    const ready = await run.waitFor(
      () => isPageCurrent() && adapter.isReady(),
      RESTORE_TIMING.READY_TIMEOUT_MS,
      () => run.canLoad(adapter)
    );
    if (!ready) return run.canLoad(adapter) ? 'not-ready' : stopped();
    const filtersApplied =
      snapshot.filters && !run.aborted ? await adapter.applyFilters(snapshot.filters, run) : true;
    const contentLoaded = await this.loadContent(run, snapshot, adapter);
    if (run.aborted || !run.checkLocation()) return stopped();
    await this.restoreScroll(run, snapshot.scrollY);
    if (run.aborted) return stopped();
    return filtersApplied && contentLoaded ? 'restored' : 'partial';
  }

  /** Grow the page until it holds the recorded content and the saved offset is reachable. */
  private async loadContent(
    run: RestoreRun,
    snapshot: PageStateSnapshot,
    adapter: PageStateAdapter
  ): Promise<boolean> {
    const reached = () =>
      adapter.measureLoaded() >= snapshot.loaded && maxScrollY() >= snapshot.scrollY;
    let lastStepAt = 0;
    for (let step = 0; !reached(); step++) {
      if (!run.canLoad(adapter) || run.expired || step >= adapter.maxLoadSteps) return false;
      // Space steps out: back-to-back loader requests exhaust the API's rate limit.
      const spacing = lastStepAt + RESTORE_TIMING.SCROLL_LOADER_MIN_INTERVAL_MS - Date.now();
      if (spacing > 0) {
        await run.pause(spacing);
        if (!run.canLoad(adapter) || run.expired) return false;
      }
      lastStepAt = Date.now();
      const before = adapter.measureLoaded();
      adapter.requestMore();
      // The page stopped growing (end of content, request failed): keep what is there.
      if (!(await this.waitForGrowth(run, adapter, before))) return reached();
    }
    return true;
  }

  /**
   * Wait for the page to grow past `before`, asking again every NUDGE_MS: a layout
   * change (loading placeholders swapped for results, a paused loader) can leave the
   * loader idle with nothing to wake it up.
   */
  private async waitForGrowth(
    run: RestoreRun,
    adapter: PageStateAdapter,
    before: number
  ): Promise<boolean> {
    const until = Date.now() + RESTORE_TIMING.STEP_TIMEOUT_MS;
    const keepGoing = () => run.canLoad(adapter);
    while (keepGoing() && Date.now() < until) {
      const wait = Math.min(RESTORE_TIMING.NUDGE_MS, until - Date.now());
      if (await run.waitFor(() => adapter.measureLoaded() > before, wait, keepGoing)) return true;
      if (keepGoing() && Date.now() < until) adapter.requestMore();
    }
    return false;
  }

  private async restoreScroll(run: RestoreRun, scrollY: number): Promise<void> {
    const target = () => Math.min(scrollY, maxScrollY());
    scrollWindowTo(target());
    await delay(RESTORE_TIMING.LAYOUT_SETTLE_MS);
    if (!run.aborted && run.checkLocation() && Math.abs(window.scrollY - target()) > 1) scrollWindowTo(target());
  }
}
