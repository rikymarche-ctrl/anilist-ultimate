/**
 * @file NavigationService.ts
 * @description Centralized SPA navigation tracking for AniList
 *
 * AniList is a Vue.js single-page application. Page navigation does not trigger
 * full page reloads, so traditional approaches (DOMContentLoaded, etc.) don't work.
 * This service detects URL changes through three mechanisms:
 *
 *   1. MutationObserver on document.body - catches DOM changes from Vue Router
 *   2. popstate event - catches browser back/forward navigation
 *   3. history.pushState/replaceState interception - catches programmatic navigation
 *
 * When a path change is detected, emits PAGE_CHANGED via the EventBus.
 * All modules subscribe to this event instead of individually polling the URL.
 *
 * Traversal tagging:
 *   PAGE_CHANGED carries `navigationType: 'traverse'` when the path change was
 *   caused by browser Back/Forward. In Chrome the URL of a same-document traversal
 *   is committed (Navigation API `currententrychange`, type "traverse") a few
 *   hundred milliseconds before `popstate` fires, and any DOM mutation in between
 *   lets the observer detect the new path first. The commit event therefore marks
 *   the traversal; a capture-phase popstate listener is the fallback where the
 *   Navigation API is missing. Emission timing is unchanged: the marker only
 *   labels whichever detection fires.
 *
 *   AniList's router renders the destination only when `popstate` arrives, so
 *   until then the previous page is still on screen. hasPendingTraversal() lets
 *   features wait for that before reading or driving the page.
 *
 * @warning This service monkey-patches history.pushState and history.replaceState.
 *          See docs/SECURITY.md#sec-006 for implications.
 *
 * @see docs/ARCHITECTURE.md#43-navigation-service
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ILogger } from '@core/interfaces/ILogger';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { PageChangedEvent, PageNavigationType } from '@core/events/EventTypes';

/** Upper bound for the commit → popstate gap; past it the router is assumed done. */
export const TRAVERSAL_SETTLE_TIMEOUT_MS = 1500;

/** Minimal Navigation API surface (not yet in the TypeScript DOM lib). */
interface NavigationEventTarget {
  addEventListener(type: 'currententrychange', listener: (event: Event) => void): void;
  removeEventListener(type: 'currententrychange', listener: (event: Event) => void): void;
}

/**
 * NavigationService
 * Watches for SPA navigation changes and emits PAGE_CHANGED events
 */
@injectable()
export class NavigationService {
  private currentPath: string;
  private observer: MutationObserver | null = null;
  private isActive = false;
  /** Originals of the monkey-patched history methods, restored in stop() (SEC-006). */
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;
  /** Path a Back/Forward traversal landed on, until the matching PAGE_CHANGED is emitted. */
  private pendingTraversalPath: string | null = null;
  /** When the last traversal committed its URL; null once its popstate arrived. */
  private traversalCommittedAt: number | null = null;
  private navigationApi: NavigationEventTarget | null = null;

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.Logger) private logger: ILogger
  ) {
    this.currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  }

  /**
   * Start watching for navigation changes
   */
  public start(): void {
    if (this.isActive) {
      this.logger.warn('[Navigation] Service already active');
      return;
    }

    this.logger.info('[Navigation] Starting navigation watcher');
    this.isActive = true;

    // Watch for URL changes via MutationObserver (SPA navigation)
    this.setupMutationObserver();

    // Also watch for popstate (browser back/forward). The traversal markers only
    // tag the next path change; see "Traversal tagging" above.
    this.navigationApi =
      (window as Window & { navigation?: NavigationEventTarget }).navigation ?? null;
    this.navigationApi?.addEventListener('currententrychange', this.handleEntryChange);
    window.addEventListener('popstate', this.markTraversal, true);
    window.addEventListener('popstate', this.handlePopState);

    // Also watch for pushState/replaceState (intercept)
    this.interceptHistoryMethods();

    this.logger.success('[Navigation] Navigation watcher active');
  }

  /**
   * Stop watching for navigation changes
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    this.logger.info('[Navigation] Stopping navigation watcher');
    this.isActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.navigationApi?.removeEventListener('currententrychange', this.handleEntryChange);
    this.navigationApi = null;
    window.removeEventListener('popstate', this.markTraversal, true);
    window.removeEventListener('popstate', this.handlePopState);
    this.pendingTraversalPath = null;
    this.traversalCommittedAt = null;

    // SEC-006: restore the original history methods we monkey-patched.
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }

    this.logger.info('[Navigation] Navigation watcher stopped');
  }

  /**
   * Get current path
   */
  public getCurrentPath(): string {
    return this.currentPath;
  }

  /**
   * True between a Back/Forward URL commit and its popstate, i.e. while the page
   * router has not rendered the destination yet (bounded by TRAVERSAL_SETTLE_TIMEOUT_MS).
   */
  public hasPendingTraversal(): boolean {
    return (
      this.traversalCommittedAt !== null &&
      Date.now() - this.traversalCommittedAt < TRAVERSAL_SETTLE_TIMEOUT_MS
    );
  }

  /**
   * Check if on specific page
   */
  public isOnPage(path: string): boolean {
    return this.currentPath === path;
  }

  /**
   * Check if path matches pattern
   */
  public matchesPath(pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return this.currentPath === pattern || this.currentPath.startsWith(pattern);
    }
    return pattern.test(this.currentPath);
  }

  /**
   * Setup MutationObserver to detect DOM changes (SPA navigation)
   */
  private setupMutationObserver(): void {
    this.observer = new MutationObserver(() => {
      this.checkPathChange();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Intercept pushState and replaceState for immediate detection
   */
  private interceptHistoryMethods(): void {
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      this.originalPushState!(...args);
      this.checkPathChange();
    };

    history.replaceState = (...args) => {
      this.originalReplaceState!(...args);
      this.checkPathChange();
    };
  }

  /**
   * Navigation API: a traversal has just committed its URL (popstate comes later).
   */
  private handleEntryChange = (event: Event): void => {
    if ((event as Event & { navigationType?: string }).navigationType !== 'traverse') return;
    this.pendingTraversalPath = window.location.pathname;
    this.traversalCommittedAt = Date.now();
  };

  /**
   * Fallback marker (capture phase, runs before the page router's listener).
   * Skipped when the path change was already reported from the commit marker.
   */
  private markTraversal = (): void => {
    if (window.location.pathname !== this.currentPath)
      this.pendingTraversalPath = window.location.pathname;
  };

  /**
   * Handle browser back/forward navigation
   */
  private handlePopState = (): void => {
    // Bubble phase: the page router has handled this traversal by now.
    this.traversalCommittedAt = null;
    this.checkPathChange();
  };

  /**
   * Check if path has changed and emit event
   */
  private checkPathChange(): void {
    const newPath = window.location.pathname;

    if (newPath !== this.currentPath) {
      const previousPath = this.currentPath;
      this.currentPath = newPath;
      // A traversal that only changed the query never reaches this point, so the
      // marker is consumed (or discarded) by the first path change after it.
      const navigationType: PageNavigationType =
        this.pendingTraversalPath === newPath ? 'traverse' : 'push';
      this.pendingTraversalPath = null;

      this.logger.debug(
        `[Navigation] Path changed (${navigationType}): ${previousPath} → ${newPath}`
      );

      // Emit PAGE_CHANGED event
      const event: PageChangedEvent = {
        path: newPath,
        previousPath,
        timestamp: new Date(),
        navigationType,
      };

      this.eventBus.emit(EVENT_TYPES.PAGE_CHANGED, event);
    }
  }
}
