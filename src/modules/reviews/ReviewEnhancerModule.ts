/**
 * Review Enhancer Module
 * Advanced Debounced Batching Version
 * Consolidates all discoveries into rare, high-volume batch calls to avoid API limits.
 * Includes a background fail-safe scanner for lazy-loaded content.
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ReviewService } from './ReviewService';
import '../../styles/review-enhancer.css';

export class ReviewEnhancerModule extends BaseModule {
  private inFlightReviews: Set<number> = new Set();
  private pendingQueue: Map<number, HTMLElement[]> = new Map();
  private reviewService!: ReviewService;
  
  private debounceTimer: number | null = null;
  private scanInterval: number | null = null;
  private isBatching: boolean = false;

  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing Debounced Batching Version');
    this.reviewService = ReviewService.getInstance();

    this.watchPageNavigation(() => {
      this.fullReset();
      this.startObservation();
    });

    this.startObservation();
  }

  private fullReset(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.scanInterval) window.clearInterval(this.scanInterval);
    this.debounceTimer = null;
    this.scanInterval = null;
    this.isBatching = false;
    
    this.cleanup();
    this.inFlightReviews.clear();
    this.pendingQueue.clear();
  }

  private startObservation(): void {
    // 1. Initial Scan
    this.scanAndQueue();

    // 2. Mutation Observer for rapid changes (Debounced)
    this.registerObserver('reviews-debounced', document.body, { childList: true, subtree: true }, () => {
      this.scanAndQueue();
    });

    // 3. Background Fail-safe Scanner (every 2 seconds)
    // Ensures lazy-loaded items that appeared silently are caught
    this.scanInterval = window.setInterval(() => {
      this.scanAndQueue();
    }, 2000);
  }

  /**
   * Scan the DOM for new review cards and add them to the pending queue
   */
  private scanAndQueue(): void {
    const selectors = [
      '.review-card',             // Global & Home Sidebar
      '.media-review-card',      // Media page sidebar
      '.review-entry',           // Media dedicated reviews tab
      '.review-wrap',            // Generic AniList review wrapper
      'a[href*="/review/"]'      // Fallback
    ];

    let foundNew = false;

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = el as HTMLElement;
        const container = this.findReviewContainer(item);
        
        // Physical check: Source of truth
        if (!container || container.querySelector('.au-review-rating')) return;

        const href = this.extractReviewHref(item);
        if (!href) return;

        const id = this.extractIdFromHref(href);
        if (id && !this.inFlightReviews.has(id)) {
          if (!this.pendingQueue.has(id)) {
            this.pendingQueue.set(id, []);
            foundNew = true;
          }
          this.pendingQueue.get(id)!.push(container);
          // IMMEDIATE LOCK to prevent other parallel scans from picking this up
          this.inFlightReviews.add(id);
        }
      });
    });

    if (foundNew) {
      this.triggerBatchWithDebounce();
    }
  }

  /**
   * Wait for 1 second of silence before executing the batch
   */
  private triggerBatchWithDebounce(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    
    this.debounceTimer = window.setTimeout(() => {
      this.executeBatchCycle();
    }, 1000);
  }

  /**
   * Flush the pending queue into an optimized Batch Alias call
   */
  private async executeBatchCycle(): Promise<void> {
    if (this.isBatching || this.pendingQueue.size === 0) return;

    this.isBatching = true;
    const batchMap = new Map(this.pendingQueue);
    const ids = Array.from(batchMap.keys());
    this.pendingQueue.clear(); // Clear so new ones can be queued while we fetch

    // Tuning based on page
    const path = window.location.pathname;
    const isMediaReviewsTab = (path.includes('/anime/') || path.includes('/manga/')) && path.endsWith('/reviews');
    const chunkSize = (isMediaReviewsTab || path.includes('/anime/')) ? 10 : 50;

    try {
      log.debug(`ReviewEnhancer: Executing Batch Cycle for ${ids.length} cards (chunkSize: ${chunkSize})`);
      const results = await this.reviewService.getReviewBatch(ids, chunkSize);
      
      results.forEach(data => {
        const containers = batchMap.get(data.id);
        if (containers) {
          containers.forEach(container => {
            this.injectRatingUI(container, data.score);
          });
        }
        this.inFlightReviews.delete(data.id);
      });
    } catch (error) {
      log.error('ReviewEnhancer: Batch Cycle failed', error);
    } finally {
      // Clear remaining in-flight status so they can be retried if needed
      ids.forEach(id => this.inFlightReviews.delete(id));
      this.isBatching = false;
      this.debounceTimer = null;
      
      // If new ones were added while we were fetching, trigger another cycle
      if (this.pendingQueue.size > 0) {
        this.triggerBatchWithDebounce();
      }
    }
  }

  private findReviewContainer(el: HTMLElement): HTMLElement | null {
    if (el.classList.contains('review-card') || 
        el.classList.contains('media-review-card') ||
        el.classList.contains('review-entry')) return el;

    const mediaReview = el.closest('.media-review-card');
    if (mediaReview) return mediaReview as HTMLElement;

    const reviewCard = el.closest('.review-card');
    if (reviewCard) return reviewCard as HTMLElement;

    const wrap = el.closest('.review-wrap');
    if (wrap) return wrap as HTMLElement;

    const activity = el.closest('.activity-entry');
    if (activity) return activity as HTMLElement;

    return null;
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
    if (rating >= 90) return 'au-review-rating--perfect';
    if (rating >= 80) return 'au-review-rating--excellent';
    if (rating >= 70) return 'au-review-rating--high';
    if (rating >= 60) return 'au-review-rating--good';
    if (rating >= 50) return 'au-review-rating--medium';
    if (rating >= 40) return 'au-review-rating--poor';
    return 'au-review-rating--terrible';
  }

  public destroy(): void {
    super.destroy();
    this.fullReset();
  }
}
