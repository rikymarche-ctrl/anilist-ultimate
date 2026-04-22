/**
 * Navigation Service
 * Centralized navigation tracking with event emission
 * Eliminates need for individual module URL polling
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ILogger } from '@core/interfaces/ILogger';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { PageChangedEvent } from '@core/events/GlobalEvents';

/**
 * NavigationService
 * Watches for SPA navigation changes and emits PAGE_CHANGED events
 */
@injectable()
export class NavigationService {
  private currentPath: string;
  private observer: MutationObserver | null = null;
  private isActive = false;

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.Logger) private logger: ILogger
  ) {
    this.currentPath = window.location.pathname;
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

    // Also watch for popstate (browser back/forward)
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

    window.removeEventListener('popstate', this.handlePopState);

    this.logger.info('[Navigation] Navigation watcher stopped');
  }

  /**
   * Get current path
   */
  public getCurrentPath(): string {
    return this.currentPath;
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
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      this.checkPathChange();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      this.checkPathChange();
    };
  }

  /**
   * Handle browser back/forward navigation
   */
  private handlePopState = (): void => {
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

      this.logger.debug(`[Navigation] Path changed: ${previousPath} → ${newPath}`);

      // Emit PAGE_CHANGED event
      const event: PageChangedEvent = {
        path: newPath,
        previousPath,
        timestamp: new Date(),
      };

      this.eventBus.emit(EVENT_TYPES.PAGE_CHANGED, event);
    }
  }
}
