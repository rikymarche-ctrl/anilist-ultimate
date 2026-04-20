/**
 * Review Enhancer Module
 * Strategic Batching Version: Optimized for AniList rate limits
 * Uses Alias Batching with Dynamic Tuning based on the current page section
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ReviewService } from './ReviewService';
import '../../styles/review-enhancer.css';

export class ReviewEnhancerModule extends BaseModule {
  private inFlightReviews: Set<number> = new Set();
  private reviewService!: ReviewService;
  private processingTimeout: number | null = null;

  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing Strategic Version');
    this.reviewService = ReviewService.getInstance();

    this.watchPageNavigation(() => {
      this.fullReset();
      this.startObservation();
    });

    this.startObservation();
  }

  private fullReset(): void {
    if (this.processingTimeout) {
      window.clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    this.cleanup();
    this.inFlightReviews.clear();
  }

  private startObservation(): void {
    // Initial strategic delay to gather all page-load cards
    this.queueProcessing(800);

    // Register observer with strategic debounce (500ms)
    // This ensures that waves of cards (Infinite Scroll) are collected together
    this.registerObserver('reviews-strategic', document.body, { childList: true, subtree: true }, () => {
      this.queueProcessing(500);
    });
  }

  /**
   * Queue a processing cycle with debounce
   */
  private queueProcessing(ms: number): void {
    if (this.processingTimeout) window.clearTimeout(this.processingTimeout);
    this.processingTimeout = window.setTimeout(() => {
      this.processReviews();
      this.processingTimeout = null;
    }, ms);
  }

  /**
   * Process review cards across all sections using optimized batching
   */
  private async processReviews(): Promise<void> {
    const selectors = [
      '.review-card',             // Global & Home Sidebar
      '.media-review-card',      // Media page sidebar
      '.review-entry',           // Media dedicated reviews tab
      '.review-wrap',            // Generic AniList review wrapper
      'a[href*="/review/"]'      // Fallback/Activity
    ];

    const cardsMap: Map<number, HTMLElement[]> = new Map();
    const pendingIds: number[] = [];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = el as HTMLElement;
        const container = this.findReviewContainer(item);
        if (!container || container.querySelector('.au-review-rating')) return;

        const href = this.extractReviewHref(item);
        if (!href) return;

        const id = this.extractIdFromHref(href);
        if (id && !this.inFlightReviews.has(id)) {
          if (!cardsMap.has(id)) {
            cardsMap.set(id, []);
            pendingIds.push(id);
          }
          cardsMap.get(id)!.push(container);
        }
      });
    });

    if (pendingIds.length === 0) return;

    // Detect Page Context for dynamic tuning
    const path = window.location.pathname;
    const isGlobalReviews = path.endsWith('/reviews') && !path.includes('/anime/') && !path.includes('/manga/');
    const isMediaReviewsTab = (path.includes('/anime/') || path.includes('/manga/')) && path.endsWith('/reviews');
    
    // Chunk Tuning
    // Global page: 50 (high volume)
    // Media Subpage: 10 (as requested for stability)
    // Others (Home/Sidebar): 25 (default)
    const chunkSize = isGlobalReviews ? 50 : (isMediaReviewsTab ? 10 : 25);

    pendingIds.forEach(id => this.inFlightReviews.add(id));

    try {
      log.debug(`ReviewEnhancer: Strategic batching ${pendingIds.length} cards (chunkSize: ${chunkSize})`);
      const results = await this.reviewService.getReviewBatch(pendingIds, chunkSize);
      
      results.forEach(data => {
        const containers = cardsMap.get(data.id);
        if (containers) {
          containers.forEach(container => {
            this.injectRatingUI(container, data.score);
          });
        }
      });
    } catch (error) {
      log.error('ReviewEnhancer: Strategic processing failed', error);
    } finally {
      pendingIds.forEach(id => this.inFlightReviews.delete(id));
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
