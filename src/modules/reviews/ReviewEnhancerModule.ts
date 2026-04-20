/**
 * Review Enhancer Module
 * Adds numeric ratings to review cards using high-performance Alias Batching
 * UNIVERSAL VERSION: Supports Home, Global, and Media-specific pages with Infinite Scroll
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ReviewService } from './ReviewService';
import '../../styles/review-enhancer.css';

export class ReviewEnhancerModule extends BaseModule {
  private inFlightReviews: Set<number> = new Set();
  private reviewService!: ReviewService;

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing Universal Version');
    this.reviewService = ReviewService.getInstance();

    this.watchPageNavigation(() => {
      this.inFlightReviews.clear();
      this.cleanup();
      this.processReviews();
      this.startObservation();
    });

    this.startObservation();
  }

  private startObservation(): void {
    this.processReviews();

    // High frequency observation for infinite scroll
    this.registerObserver('reviews-continuous', document.body, { childList: true, subtree: true }, () => {
      this.processReviews();
    });
  }

  /**
   * Process all review cards with Alias Batching
   */
  private async processReviews(): Promise<void> {
    // Universal selectors for Home, Global Reviews, and Media pages
    const selectors = [
      '.review-card',             // Global & Home Sidebar
      '.media-review-card',      // Media page sidebars
      '.review-entry',           // Media dedicated reviews tab
      '.review-wrap',            // Generic AniList review wrapper
      'a[href*="/review/"]'      // Fallback for activities
    ];

    const cardsMap: Map<number, HTMLElement[]> = new Map();
    const pendingIds: number[] = [];

    // Identify unique review containers that DON'T have a badge yet
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const item = el as HTMLElement;
        const container = this.findReviewContainer(item);
        if (!container) return;

        // CRITICAL CHECK: Does it already have our UI badge?
        if (container.querySelector('.au-review-rating')) return;

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

    // Start Batching
    pendingIds.forEach(id => this.inFlightReviews.add(id));

    try {
      log.debug(`ReviewEnhancer: Batching ${pendingIds.length} cards across all sections...`);
      // We chunk in 50 inside the service
      const results = await this.reviewService.getReviewBatch(pendingIds);
      
      results.forEach(data => {
        const containers = cardsMap.get(data.id);
        if (containers) {
          containers.forEach(container => {
            this.injectRatingUI(container, data.score);
          });
        }
      });
    } catch (error) {
      log.error('ReviewEnhancer: Batch execution failed', error);
    } finally {
      // Clear in-flight status for all IDs in this wave
      pendingIds.forEach(id => this.inFlightReviews.delete(id));
    }
  }

  /**
   * Finds the best container for the rating badge based on the element type
   */
  private findReviewContainer(el: HTMLElement): HTMLElement | null {
    // If it's already a card, use it
    if (el.classList.contains('review-card') || 
        el.classList.contains('media-review-card') ||
        el.classList.contains('review-entry')) return el;

    // Sidebar reviews in media pages often have a specific structure
    const mediaReview = el.closest('.media-review-card');
    if (mediaReview) return mediaReview as HTMLElement;

    // Global review page cards
    const reviewCard = el.closest('.review-card');
    if (reviewCard) return reviewCard as HTMLElement;

    // Home sidebar fallback
    const wrap = el.closest('.review-wrap');
    if (wrap) return wrap as HTMLElement;

    // Activity entry
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
    // Double-check to prevent race-condition duplicates
    if (card.querySelector('.au-review-rating')) return;

    const badge = document.createElement('div');
    badge.className = `au-review-rating ${this.getColorClass(rating)}`;
    badge.textContent = `${rating}`;

    // Priority for positioning
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
    this.inFlightReviews.clear();
  }
}
