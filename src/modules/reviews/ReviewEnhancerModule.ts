/**
 * Review Enhancer Module
 * Adds numeric ratings to review cards using high-performance Alias Batching
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ReviewService } from './ReviewService';
import '../../styles/review-enhancer.css';

export class ReviewEnhancerModule extends BaseModule {
  private processedReviews: Set<string> = new Set();
  private inFlightReviews: Set<number> = new Set();
  private reviewService!: ReviewService;
  private isProcessing: boolean = false;

  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing');
    this.reviewService = ReviewService.getInstance();

    this.watchPageNavigation(() => {
      this.processedReviews.clear();
      this.inFlightReviews.clear();
      this.cleanup();
      this.startObservation();
    });

    this.startObservation();
  }

  private startObservation(): void {
    this.processReviews();
    this.registerObserver('reviews-continuous', document.body, { childList: true, subtree: true }, () => {
      this.processReviews();
    });
  }

  /**
   * Process review cards with Alias Batching
   */
  private async processReviews(): Promise<void> {
    if (this.isProcessing) return;

    // Detect all possible review containers or links
    const selectors = [
      '.review-card',
      'a[href*="/review/"]',
      '.activity-entry .review',
      '[class*="ReviewCard"]'
    ];

    const cardsMap: Map<number, HTMLElement[]> = new Map();
    const pendingIds: number[] = [];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = el as HTMLElement;
        const href = this.extractReviewHref(item);
        if (!href || this.processedReviews.has(href)) return;

        const id = this.extractIdFromHref(href);
        if (id && !this.inFlightReviews.has(id)) {
          const container = this.findCardContainer(item);
          if (container) {
            if (!cardsMap.has(id)) {
              cardsMap.set(id, []);
              pendingIds.push(id);
            }
            cardsMap.get(id)!.push(container);
          }
        }
      });
    });

    if (pendingIds.length === 0) return;

    // Execution
    this.isProcessing = true;
    pendingIds.forEach(id => this.inFlightReviews.add(id));

    try {
      log.debug(`ReviewEnhancer: Batching ${pendingIds.length} cards...`);
      const results = await this.reviewService.getReviewBatch(pendingIds);
      
      results.forEach(data => {
        const containers = cardsMap.get(data.id);
        if (containers) {
          containers.forEach(container => {
            this.injectRatingUI(container, data.score);
            const href = this.extractReviewHref(container);
            if (href) this.processedReviews.add(href);
          });
        }
        this.inFlightReviews.delete(data.id);
      });
    } catch (error) {
      log.error('ReviewEnhancer: Batch failed', error);
    } finally {
      // Clear any IDs that failed or didn't return data so they can be retried
      pendingIds.forEach(id => this.inFlightReviews.delete(id));
      this.isProcessing = false;
    }
  }

  private findCardContainer(el: HTMLElement): HTMLElement | null {
    if (el.classList.contains('review-card') || el.className.includes('ReviewCard')) return el;
    const activity = el.closest('.activity-entry');
    if (activity) return activity as HTMLElement;
    return el.parentElement;
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
    this.processedReviews.clear();
    this.inFlightReviews.clear();
  }
}
