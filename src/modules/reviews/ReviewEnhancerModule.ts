/**
 * @file ReviewEnhancerModule.ts
 * @description Injects rating badges into review cards using cached batch requests
 *
 * Scans the page for review cards, collects review IDs, and fetches
 * score data in a single consolidated batch request after a high
 * debounce window. ReviewService caches scores; recreated cards still need
 * their badges rendered even when the IDs have not changed.
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
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { mutationsMatchSelector, type SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { ReviewService } from './ReviewService';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { parseWebUrl } from '@core/utils/WebUrl';
import '../../styles/review-enhancer.css';

const REVIEW_CANDIDATES = '.review-card, .media-review-card, .review-entry, .review-wrap, .activity-entry, a[href*="/review/"]';
/** Batch attempts per review ID per page visit. A failed or badge-less attempt is retried once, then stops. */
const MAX_REVIEW_ATTEMPTS = 2;
interface ReviewCardBinding {
  id: number; queued: boolean; badge: HTMLElement | null;
  position: { target: HTMLElement; value: string; priority: string } | null;
}
interface ReviewCardRequest { card: HTMLElement; binding: ReviewCardBinding; }

@injectable()
export class ReviewEnhancerModule extends BaseModule {
  private cards = new Map<HTMLElement, ReviewCardBinding>();
  private pendingQueue = new Map<number, ReviewCardRequest[]>();
  // Counts batch sends per ID; a rendered badge resets it. No separate negative cache: ReviewService
  // swallows failed chunks, so a missing ID cannot be told apart from a transient failure.
  private attemptCounts = new Map<number, number>();

  private debounceTimer: number | null = null;
  private scanInterval: number | null = null;
  private isBatching: boolean = false;

  private initialized = false;
  private generation = 0;

  constructor(
    @inject(TOKENS.ReviewService) private reviewService: ReviewService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    logger.info('[ReviewEnhancer] Initializing strategic version');

    this.onPageChange(() => {
      if (!this.initialized) return;
      this.fullReset();
      this.startObservation();
    });

    this.startObservation();
  }

  public getName(): string {
    return 'reviewEnhancer';
  }

  private fullReset(): void {
    this.generation++;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    if (this.scanInterval !== null) window.clearInterval(this.scanInterval);
    this.debounceTimer = null;
    this.scanInterval = null;
    this.isBatching = false;

    // BUG-007 fix: Unregister from SharedGlobalObserver
    this.sharedObserver.unregister('reviews-one-shot');

    this.cleanup();
    this.pendingQueue.clear();
    this.attemptCounts.clear();
    for (const [card, binding] of this.cards) this.releaseCard(card, binding);
  }

  private startObservation(): void {
    const generation = this.generation;
    const currentScan = () => { if (this.initialized && generation === this.generation) this.scanAndQueue(); };
    currentScan();
    this.sharedObserver.register('reviews-one-shot', currentScan, undefined, mutationsMatchSelector(REVIEW_CANDIDATES));
    // This also observes href-only reuse, which the shared childList observer does not deliver.
    this.scanInterval = window.setInterval(currentScan, 2000);
  }

  private shouldRun(): boolean {
    const path = window.location.pathname;
    const route = getMediaRoute(path);
    const mediaPage = route !== null && route.id <= 2147483647;
    return path === '/' || /^\/home\/?$/.test(path) || /^\/reviews\/?$/.test(path)
      || /^\/user\/[^/]+\/reviews\/?$/.test(path)
      || (mediaPage && !!document.querySelector(REVIEW_CANDIDATES));
  }

  private scanAndQueue(): void {
    if (!this.initialized) return;
    const allowed = this.shouldRun();
    for (const [card, binding] of this.cards) {
      const href = this.extractReviewHref(card);
      if (!allowed || !card.isConnected || !href || this.extractIdFromHref(href) !== binding.id
        || (binding.badge !== null && (!binding.badge.isConnected || !card.contains(binding.badge)))) {
        this.releaseCard(card, binding);
      }
    }
    if (!allowed) return;

    const candidates = new Set<HTMLElement>();
    document.querySelectorAll<HTMLElement>(REVIEW_CANDIDATES).forEach(item => {
      const card = this.findReviewContainer(item);
      if (card) candidates.add(card);
    });
    let found = false;
    for (const card of candidates) {
      const href = this.extractReviewHref(card);
      const id = href && this.extractIdFromHref(href);
      if (!id) continue;
      let binding = this.cards.get(card);
      if (!binding) {
        binding = { id, queued: false, badge: null, position: null };
        this.cards.set(card, binding);
      }
      if (binding.queued || binding.badge || card.querySelector('.au-review-rating') || this.hasExhaustedAttempts(id)) continue;
      const requests = this.pendingQueue.get(id) ?? [];
      requests.push({ card, binding });
      this.pendingQueue.set(id, requests);
      binding.queued = true;
      found = true;
    }
    if (found) this.triggerBatchWithDebounce();
  }

  private releaseCard(card: HTMLElement, binding: ReviewCardBinding): void {
    binding.badge?.remove();
    const position = binding.position;
    if (position && position.target.style.getPropertyValue('position') === 'relative'
      && position.target.style.getPropertyPriority('position') === '') {
      if (position.value) position.target.style.setProperty('position', position.value, position.priority);
      else position.target.style.removeProperty('position');
    }
    if (this.cards.get(card) === binding) this.cards.delete(card);
  }

  private hasExhaustedAttempts(id: number): boolean {
    return (this.attemptCounts.get(id) ?? 0) >= MAX_REVIEW_ATTEMPTS;
  }

  private triggerBatchWithDebounce(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);

    const generation = this.generation;
    const timer = window.setTimeout(() => {
      if (!this.initialized || generation !== this.generation || this.debounceTimer !== timer) return;
      this.debounceTimer = null;
      void this.executeBatchCycle();
    }, 2000);
    this.debounceTimer = timer;
  }

  private async executeBatchCycle(): Promise<void> {
    if (!this.initialized || this.isBatching || this.pendingQueue.size === 0) return;

    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const generation = this.generation;
    this.isBatching = true;
    const batchMap = new Map(this.pendingQueue);
    this.pendingQueue.clear();
    for (const [id, requests] of batchMap) {
      const current = requests.filter(({ card, binding }) => this.cards.get(card) === binding && card.isConnected
        && this.extractIdFromHref(this.extractReviewHref(card) ?? '') === id);
      if (current.length) batchMap.set(id, current); else batchMap.delete(id);
    }
    const ids = Array.from(batchMap.keys());
    if (!ids.length) { this.isBatching = false; return; }
    for (const id of ids) this.attemptCounts.set(id, (this.attemptCounts.get(id) ?? 0) + 1);

    const path = window.location.pathname;
    const isCurrent = () => this.initialized && this.generation === generation && window.location.pathname === path;
    const isHome = /^\/home\/?$/.test(path) || path === '/';
    const isGlobalReviews = /^\/reviews\/?$/.test(path);
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
      // One request usually covers the visible media-review page; smaller chunks
      // multiplied API calls during quick tab switches.
      chunkSize = 25;
      pageType = 'Media Reviews Tab';
    } else if (isMediaOverview) {
      chunkSize = 30;
      pageType = 'Media Overview';
    } else {
      chunkSize = 30;
      pageType = 'Other';
    }

    logger.info(`%c[ReviewEnhancer] 🎯 BATCH START [${pageType}]: ${ids.length} reviews`, 'color: #3db4f2; font-weight: bold;');

    try {
      const results = await this.reviewService.getReviewBatch(ids, chunkSize);
      if (!isCurrent()) return;
      
      results.forEach(data => {
        const containers = batchMap.get(data.id);
        if (containers) {
          this.attemptCounts.delete(data.id);
          containers.forEach(({ card, binding }) => {
            const href = this.extractReviewHref(card);
            if (this.cards.get(card) === binding && card.isConnected && href && this.extractIdFromHref(href) === data.id) {
              this.injectRatingUI(card, data.score, binding);
            }
          });
        }
      });

    } catch (error) {
      logger.error('[ReviewEnhancer] One-shot batch failed', error);
    } finally {
      if (isCurrent()) {
        batchMap.forEach(requests => requests.forEach(({ card, binding }) => {
          if (this.cards.get(card) === binding) binding.queued = false;
        }));
        this.isBatching = false;
        if (this.pendingQueue.size > 0) this.triggerBatchWithDebounce();
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
    if (el.tagName === 'A' && this.extractIdFromHref(el.getAttribute('href') ?? '') !== null) return el.getAttribute('href');
    return Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .find(link => this.extractIdFromHref(link.getAttribute('href') ?? '') !== null)?.getAttribute('href') ?? null;
  }

  private extractIdFromHref(href: string): number | null {
    const url = parseWebUrl(href, window.location.href);
    if (!url || url.origin !== window.location.origin || url.hostname !== 'anilist.co' || url.username || url.password) return null;
    const match = /^\/review\/([1-9]\d*)\/?$/.exec(url.pathname);
    const id = match ? Number(match[1]) : NaN;
    return Number.isInteger(id) && id <= 2147483647 ? id : null;
  }

  private injectRatingUI(card: HTMLElement, rating: number, binding: ReviewCardBinding): void {
    if (card.querySelector('.au-review-rating')) return;
    const badge = document.createElement('div');
    badge.className = `au-review-rating ${this.getColorClass(rating)}`;
    badge.textContent = `${rating}`;
    const target = card.querySelector<HTMLElement>('.cover, .image, .banner, [class*="image"], [class*="cover"]') ?? card;
    binding.position = { target, value: target.style.getPropertyValue('position'), priority: target.style.getPropertyPriority('position') };
    target.style.setProperty('position', 'relative');
    binding.badge = badge;
    target.appendChild(badge);
  }

  private getColorClass(rating: number): string {
    return `au-review-rating--${ScoreFormatter.getLabel(rating)}`;
  }

  public override async destroy(): Promise<void> {
    this.initialized = false;
    this.fullReset();
    await super.destroy();
  }
}
