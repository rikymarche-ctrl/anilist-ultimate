/**
 * @file PageStateRestoreModule.ts
 * @description Restores filters, loaded content and scroll position on Back/Forward
 *
 * AniList forgets everything a page loaded on the way down whenever the user opens
 * something and comes back: Browse results, the Home and profile activity feeds,
 * social tabs, reviews... restart from their first page under the old scroll
 * offset, and media lists also lose their filters (kept in component state). This
 * module records the page while the user is on it and replays it when the user
 * returns via history. Any page whose content grows through AniList's scroll loader
 * is covered; media lists have their own adapter.
 *
 * Lifecycle:
 *   - Capture: while a page with growing content is shown, a "live" snapshot is refreshed on
 *     scroll (throttled), on every click (synchronously, so the state right before
 *     a link navigates away is exact) and after filter input.
 *   - Commit: on PAGE_CHANGED the live snapshot of the page being left is saved,
 *     keyed by its history entry. `pagehide` does the same for document unloads.
 *   - Restore: when PAGE_CHANGED reports a history traversal (Back/Forward), or the
 *     document itself was loaded by one, the snapshot of the destination entry is
 *     replayed by PageStateRestorer.
 *
 * Navigation detection is NavigationService's (via BaseModule.onPageChange and its
 * hasPendingTraversal() gate); this module adds no history hook of its own. After
 * a Back the URL changes before AniList's router renders the destination, so
 * neither capture nor restore reads the page until the router has caught up.
 * While a restore runs, capturing is suspended so intermediate positions never
 * overwrite what the user left (if the user leaves mid-restore, the original
 * snapshot is committed again); it resumes as soon as the user takes over.
 *
 * @see PageStateRestorer.ts for the replay and its user-input guard
 * @see docs/MODULES.md#13-page-state-restore-module
 */

import { injectable, inject } from 'tsyringe';
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { PageChangedEvent } from '@core/events/EventTypes';
import type { NavigationService } from '@core/navigation/NavigationService';
import type { PageStateSnapshot } from './PageStateTypes';
import { resolveCurrentPage } from './PageStateRoutes';
import { createPageStateAdapter } from './PageStateAdapters';
import type { PageStateStore } from './PageStateStore';
import type { PageStateRestorer } from './PageStateRestorer';

/** Throttle for scroll- and input-driven captures. */
export const CAPTURE_THROTTLE_MS = 300;

/** True when this document was loaded by a Back/Forward and is still on that URL. */
function isInitialBackForwardLoad(): boolean {
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry?.type === 'back_forward' && entry.name === window.location.href;
  } catch {
    return false;
  }
}

const currentUrl = (): string => `${window.location.pathname}${window.location.search}`;

@injectable()
export class PageStateRestoreModule extends BaseModule {
  private active = false;
  /** Latest state of the restorable page on screen (or the restore target while restoring). */
  private live: PageStateSnapshot | null = null;
  private restoring = false;
  /** Bumped on every page change and on destroy; stale async completions compare against it. */
  private generation = 0;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.NavigationService)
    private readonly navigation: Pick<NavigationService, 'hasPendingTraversal'>,
    @inject(TOKENS.PageStateStore) private readonly store: PageStateStore,
    @inject(TOKENS.PageStateRestorer) private readonly restorer: PageStateRestorer
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (this.active) return;
    this.active = true;
    logger.info('PageStateRestore: Initializing...');

    this.onPageChange((event) => this.handlePageChange(event));
    window.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('input', this.handleInput, true);
    window.addEventListener('pagehide', this.handlePageHide);

    if (isInitialBackForwardLoad()) this.restoreCurrentPage();
    this.scheduleCapture();
  }

  public getName(): string {
    return 'pageRestore';
  }

  public override async destroy(): Promise<void> {
    this.active = false;
    this.generation++;
    this.restorer.abort();
    this.restoring = false;
    this.clearCaptureTimer();
    window.removeEventListener('scroll', this.handleScroll);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('input', this.handleInput, true);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.live = null;
    await super.destroy();
  }

  private handlePageChange(event?: PageChangedEvent): void {
    if (!this.active) return;
    this.generation++;
    this.restorer.abort();
    this.restoring = false;
    this.clearCaptureTimer();
    if (this.live) this.store.save(this.live);
    this.live = null;

    if (event?.navigationType === 'traverse') {
      this.restoreCurrentPage();
    } else {
      // A new or replaced history entry starts clean: never restore an older
      // snapshot that happens to share its key (URL keys, replaced entries).
      this.store.delete(resolveCurrentPage().key);
    }
    this.scheduleCapture();
  }

  private restoreCurrentPage(): void {
    const page = resolveCurrentPage();
    const snapshot = this.store.get(page.key);
    if (!snapshot || snapshot.url !== page.url || snapshot.kind !== page.kind) return;

    const generation = this.generation;
    // Keep the target as the live state: leaving mid-restore must not lose it.
    this.live = snapshot;
    this.restoring = true;
    void this.restorer
      .restore(
        snapshot,
        createPageStateAdapter(page.kind, snapshot.loaderIndex),
        this.isRouterSettled
      )
      .catch((error) => logger.error('[PageState] Restore failed', error))
      .finally(() => {
        if (generation !== this.generation) return;
        this.restoring = false;
        this.capture();
      });
  }

  /** False while a Back/Forward has changed the URL but the previous page is still rendered. */
  private isRouterSettled = (): boolean => !this.navigation.hasPendingTraversal();

  /** Captures run unless a restore is driving the page and the user has not taken over. */
  private isTracking(): boolean {
    return this.active && (!this.restoring || this.restorer.hasUserTakenOver());
  }

  /** Refresh the live snapshot from the page on screen. */
  private capture(): void {
    if (!this.isTracking()) return;
    if (!this.isRouterSettled()) {
      this.scheduleCapture();
      return;
    }
    const page = resolveCurrentPage();
    const adapter = createPageStateAdapter(page.kind);
    // Not rendered yet, or nothing that grows on this page: keep the last good snapshot.
    if (!adapter.isReady()) return;
    this.live = {
      key: page.key,
      url: page.url,
      kind: page.kind,
      scrollY: Math.max(0, Math.round(window.scrollY)),
      loaded: adapter.measureLoaded(),
      loaderIndex: adapter.loaderIndex,
      filters: adapter.readFilters(),
      capturedAt: Date.now(),
    };
  }

  private scheduleCapture(): void {
    if (this.captureTimer !== null) return;
    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;
      this.capture();
    }, CAPTURE_THROTTLE_MS);
  }

  private clearCaptureTimer(): void {
    if (this.captureTimer !== null) clearTimeout(this.captureTimer);
    this.captureTimer = null;
  }

  private handleScroll = (): void => {
    if (!this.isTracking()) return;
    // Keep the offset exact between throttled captures.
    if (this.live?.url === currentUrl())
      this.live = { ...this.live, scrollY: Math.max(0, Math.round(window.scrollY)) };
    this.scheduleCapture();
  };

  private handleClick = (): void => {
    if (!this.isTracking()) return;
    // Capture phase: runs before a link click navigates away.
    this.capture();
    // A filter click applies after this handler; pick it up shortly after.
    this.scheduleCapture();
  };

  private handleInput = (): void => {
    if (!this.isTracking()) return;
    this.scheduleCapture();
  };

  private handlePageHide = (): void => {
    if (!this.active) return;
    this.capture();
    if (this.live) this.store.save(this.live);
  };
}
