/**
 * Review Enhancer Module
 * Adds numeric ratings to review cards
 * Optimized Parallel Version
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ReviewService } from './ReviewService';
import '../../styles/review-enhancer.css';

export class ReviewEnhancerModule extends BaseModule {
  private processedReviews: Set<string> = new Set();
  private reviewService!: ReviewService;

  public async init(): Promise<void> {
    log.info('ReviewEnhancer: Initializing');
    this.reviewService = ReviewService.getInstance();

    this.watchPageNavigation(() => {
      this.processedReviews.clear();
      this.fullReset();
      this.processReviews();
    });

    this.startObservation();
  }

  private fullReset(): void {
    this.cleanup();
  }

  private startObservation(): void {
    this.processReviews();

    this.registerObserver('reviews-continuous', document.body, { childList: true, subtree: true }, () => {
      this.processReviews();
    });
  }

  private async processReviews(): Promise<void> {
    // Select any possible review card or link
    const cards = document.querySelectorAll('.review-card, a[href*="/review/"], .activity-entry .title a[href*="/review/"], [class*="ReviewCard"]');
    
    const pendingTasks: Promise<void>[] = [];

    cards.forEach(el => {
      const card = el as HTMLElement;
      const href = this.extractReviewHref(card);
      
      if (href && !this.processedReviews.has(href)) {
        // Find the "true" container to avoid badging small inline links
        const container = this.findCardContainer(card);
        if (container) {
          this.processedReviews.add(href);
          pendingTasks.push(this.enhanceCard(container, href));
        }
      }
    });

    if (pendingTasks.length > 0) {
      log.debug(`ReviewEnhancer: Processing ${pendingTasks.length} cards...`);
      await Promise.all(pendingTasks);
    }
  }

  private async enhanceCard(container: HTMLElement, href: string): Promise<void> {
    const id = this.extractIdFromHref(href);
    if (!id) return;

    try {
      const data = await this.reviewService.getReview(id);
      if (data && data.score) {
        this.injectRatingUI(container, data.score);
      }
    } catch (e) {
      log.error(`Failed to enhance card ${id}`, e);
    }
  }

  private findCardContainer(el: HTMLElement): HTMLElement | null {
    // If it's a dedicated review card, use it
    if (el.classList.contains('review-card') || el.className.includes('ReviewCard')) return el;
    
    // If it's an activity entry, use the whole entry
    const activity = el.closest('.activity-entry');
    if (activity) return activity as HTMLElement;

    // Fallback: if it's a link, use its parent container if it looks like a card
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
  }
}
