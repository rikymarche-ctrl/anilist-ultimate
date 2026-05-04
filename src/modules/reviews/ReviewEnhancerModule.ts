/**
 * @file ReviewEnhancerModule.ts
 * @description Injects rating badges into review cards with fingerprint-based intelligent batching
 *
 * Scans the page for review cards, collects review IDs, and fetches
 * score data in a single consolidated batch request after a high
 * debounce window. Uses fingerprint comparison to skip API calls
 * when the same reviews are displayed (e.g., homepage 4 reviews).
 *
 * Fingerprint Strategy:
 *   - Track sorted review IDs from last successful batch
 *   - Compare with current batch IDs before API call
 *   - If identical, skip fetch (data already in ReviewService cache)
 *   - If different, fetch and update fingerprint
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @see ReviewService.ts for the GraphQL batch fetching with LRU+TTL cache
 * @see docs/MODULES.md#11-review-enhancer-module
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { ReviewService } from './ReviewService';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import '../../styles/review-enhancer.css';

@injectable()
export class ReviewEnhancerModule extends BaseModule {
  private inFlightReviews: Set<number> = new Set();
  private pendingQueue: Map<number, HTMLElement[]> = new Map();

  private debounceTimer: number | null = null;
  private scanInterval: number | null = null;
  private isBatching: boolean = false;

  /** Fingerprint of last fetched review IDs to avoid redundant API calls */
  private lastFingerprint: string = '';

  constructor(
    @inject(TOKENS.ReviewService) private reviewService: ReviewService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.info('[ReviewEnhancer] Initializing strategic version');

    this.onPageChange(() => {
      this.fullReset();
      this.startObservation();
    });

    this.startObservation();
  }

  public getName(): string {
    return 'reviewEnhancer';
  }

  private fullReset(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.scanInterval) window.clearInterval(this.scanInterval);
    this.debounceTimer = null;
    this.scanInterval = null;
    this.isBatching = false;

    // BUG-007 fix: Unregister from SharedGlobalObserver
    this.sharedObserver.unregister('reviews-one-shot');

    this.cleanup();
    this.inFlightReviews.clear();
    this.pendingQueue.clear();
    this.lastFingerprint = ''; // Clear fingerprint on page change
  }

  private startObservation(): void {
    this.scanAndQueue();

    // BUG-007 fix: Use SharedGlobalObserver instead of individual observer
    this.sharedObserver.register('reviews-one-shot', () => {
      this.scanAndQueue();
    });

    this.scanInterval = window.setInterval(() => {
      this.scanAndQueue();
    }, 2000);
  }

  private shouldRun(): boolean {
    const path = window.location.pathname;
    
    // Explicitly blacklist heavy pages or irrelevant ones
    if (path.includes('/character/') || path.includes('/staff/') || path.includes('/studio/')) {
      return false;
    }

    // Whitelist allowed contexts strictly following user requirements
    const isHome = path === '/' || path === '/home' || path === '/home/';
    const isMedia = !!path.match(/\/(anime|manga)\/\d+/);
    const isGlobalReviews = path === '/reviews';
    const isUserReviews = path.includes('/user/') && path.endsWith('/reviews');

    return isHome || isMedia || isGlobalReviews || isUserReviews;
  }

  private scanAndQueue(): void {
    if (!this.shouldRun()) return;

    const selectors = [
      '.review-card',
      '.media-review-card',
      '.review-entry',
      '.review-wrap',
      '.activity-entry',
      'a[href*="/review/"]'
    ];

    let newFoundCount = 0;

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = el as HTMLElement;
        const container = this.findReviewContainer(item);

        if (!container || container.querySelector('.au-review-rating')) {
          return;
        }

        const href = this.extractReviewHref(item);
        if (!href) return;

        const id = this.extractIdFromHref(href);
        if (!id) return;

        if (this.inFlightReviews.has(id)) return;

        if (!this.pendingQueue.has(id)) {
          this.pendingQueue.set(id, []);
          newFoundCount++;
        }
        this.pendingQueue.get(id)!.push(container);
        this.inFlightReviews.add(id);
      });
    });

    if (newFoundCount > 0) {
      this.triggerBatchWithDebounce();
    }
  }

  private triggerBatchWithDebounce(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);

    this.debounceTimer = window.setTimeout(() => {
      this.executeBatchCycle();
    }, 2000);
  }

  private async executeBatchCycle(): Promise<void> {
    if (this.isBatching || this.pendingQueue.size === 0) return;

    this.isBatching = true;
    const batchMap = new Map(this.pendingQueue);
    const ids = Array.from(batchMap.keys());
    this.pendingQueue.clear();

    const path = window.location.pathname;
    const isHome = path === '/home' || path === '/';
    const isGlobalReviews = path === '/reviews';
    const isMediaReviewsTab = (path.includes('/anime/') || path.includes('/manga/')) && path.endsWith('/reviews');
    const isMediaOverview = (path.includes('/anime/') || path.includes('/manga/')) && !path.endsWith('/reviews');

    let chunkSize: number;
    let pageType: string;

    if (isHome) {
      chunkSize = 25;
      pageType = 'Home';
    } else if (isGlobalReviews) {
      chunkSize = 100;
      pageType = 'Global Reviews';
    } else if (isMediaReviewsTab) {
      chunkSize = 10;
      pageType = 'Media Reviews Tab';
    } else if (isMediaOverview) {
      chunkSize = 30;
      pageType = 'Media Overview';
    } else {
      chunkSize = 30;
      pageType = 'Other';
    }

    // Fingerprint-based caching: skip API call if IDs haven't changed
    const currentFingerprint = ids.slice().sort((a, b) => a - b).join(',');
    if (currentFingerprint === this.lastFingerprint) {
      log.info(`%c[ReviewEnhancer] ✨ FINGERPRINT MATCH [${pageType}]: Skipping fetch for ${ids.length} reviews (using cache)`, 'color: #46d369; font-weight: bold;');
      // Data should already be in ReviewService cache - just mark as no longer in-flight
      ids.forEach(id => this.inFlightReviews.delete(id));
      this.isBatching = false;
      this.debounceTimer = null;
      return;
    }

    log.info(`%c[ReviewEnhancer] 🎯 BATCH START [${pageType}]: ${ids.length} reviews`, 'color: #3db4f2; font-weight: bold;');

    try {
      const results = await this.reviewService.getReviewBatch(ids, chunkSize);
      
      results.forEach(data => {
        const containers = batchMap.get(data.id);
        if (containers) {
          containers.forEach(container => {
            this.injectRatingUI(container, data.score);
          });
        }
      });

      // Update fingerprint after successful fetch
      this.lastFingerprint = currentFingerprint;
      log.debug(`[ReviewEnhancer] Fingerprint updated: ${currentFingerprint}`);
    } catch (error) {
      log.error('[ReviewEnhancer] One-shot batch failed', error);
    } finally {
      ids.forEach(id => this.inFlightReviews.delete(id));
      this.isBatching = false;
      this.debounceTimer = null;
      
      if (this.pendingQueue.size > 0) {
        this.triggerBatchWithDebounce();
      }
    }
  }

  private findReviewContainer(el: HTMLElement): HTMLElement | null {
    if (el.classList.contains('review-card') || 
        el.classList.contains('media-review-card') ||
        el.classList.contains('review-entry')) return el;

    return el.closest('.media-review-card, .review-card, .review-wrap, .activity-entry') as HTMLElement;
  }

  private extractReviewHref(el: HTMLElement): string | null {
    if (el.tagName === 'A' && el.getAttribute('href')?.includes('/review/')) {
      return el.getAttribute('href');
    }
    return el.querySelector('a[href*="/review/"]')?.getAttribute('href') || null;
  }

  private extractIdFromHref(href: string): number | null {
    const match = href.match(/\/review\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private injectRatingUI(card: HTMLElement, rating: number): void {
    if (card.querySelector('.au-review-rating')) return;

    const badge = document.createElement('div');
    badge.className = `au-review-rating ${this.getColorClass(rating)}`;
    badge.textContent = `${rating}`;

    const cover = card.querySelector('.cover, .image, .banner, [class*="image"], [class*="cover"]');
    if (cover) {
      (cover as HTMLElement).style.position = 'relative';
      cover.appendChild(badge);
    } else {
      card.style.position = 'relative';
      card.appendChild(badge);
    }
  }

  private getColorClass(rating: number): string {
    return `au-review-rating--${ScoreFormatter.getLabel(rating)}`;
  }

  public override async destroy(): Promise<void> {
    this.fullReset();
    await super.destroy();
  }
}
