/**
 * Review Enhancer Module
 * One-Shot Strategic Batching Version
 * Concentrates all API effort into a single, consolidated request using a high debounce.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import type { IEventBus } from '@core/interfaces/IEventBus';
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

  constructor(
    @inject(TOKENS.ReviewService) private reviewService: ReviewService,
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
    
    this.cleanup();
    this.inFlightReviews.clear();
    this.pendingQueue.clear();
  }

  private startObservation(): void {
    this.scanAndQueue();

    this.registerObserver('reviews-one-shot', document.body, { childList: true, subtree: true }, () => {
      this.scanAndQueue();
    });

    this.scanInterval = window.setInterval(() => {
      this.scanAndQueue();
    }, 2000);
  }

  private scanAndQueue(): void {
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
