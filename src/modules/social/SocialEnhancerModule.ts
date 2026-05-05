/**
 * @file SocialEnhancerModule.ts
 * @description Injects friend activity avatars onto media cards with intelligent caching
 *
 * Architecture:
 * - activityCache: LRU cache (max 100 entries) with TTL (5min) and page-change clearing
 * - pendingCards: cards waiting for first-time fetch
 * - On pref change: instantly re-apply cache to all tagged cards (no API call)
 * - On page change: cache cleared to prevent memory leak (PERF-002 fix)
 *
 * Caching Strategy:
 * - LRU eviction when cache reaches 100 entries
 * - TTL expiration after 5 minutes
 * - Auto-clear on navigation to prevent unbounded growth
 * - Instant re-injection on preference changes (socialEnabled toggle)
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @see docs/PERFORMANCE.md#perf-002 for memory leak prevention details
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { FriendActivity } from '@core/types';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { SocialService } from './SocialService';
import { SocialRenderer } from './SocialRenderer';
import { CalendarStore } from '../calendar/CalendarStore';

/** Attribute set on cards after first injection to track mediaId */
const PROCESSED_ATTR = 'data-au-social-processed';
const MEDIA_ID_ATTR = 'data-au-social-media-id';

@injectable()
export class SocialEnhancerModule extends BaseModule {
  /** Timer for batching API requests to avoid spamming GraphQL */
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  
  /** Track portal controllers to prevent duplicates and cleanup on page change */
  private portalControllers: Map<HTMLElement, AbortController> = new Map();

  /** Cards waiting for their first API fetch, keyed by mediaId */
  private pendingCards: Map<number, { elements: HTMLElement[], type: any }> = new Map();

  /** Cache of fetched activities, keyed by mediaId — used for instant re-inject */
  private activityCache: Map<number, FriendActivity[]> = new Map();

  /** PERF-002 fix: LRU tracking for cache eviction (max 100 entries) */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: number[] = [];

  /** BUG-030 fix: TTL for cache entries (5 minutes) to ensure data freshness */
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cacheTimestamps: Map<number, number> = new Map();

  /** Unsubscribe function for the calendar store to prevent memory leaks */
  private storeUnsubscribe: (() => void) | null = null;

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.CalendarStore) private calendarStore: CalendarStore
  ) {
    super(eventBus);
  }

  /**
   * Initialize the social enhancer module.
   * Sets up page change listeners and store subscriptions.
   */
  public async init(): Promise<void> {
    log.info('SocialEnhancerModule: Initializing...');

    await this.calendarStore.init();

    this.onPageChange(() => {
      const cacheSize = this.activityCache.size;
      
      this.removeAllWrappers();
      this.pendingCards.clear();
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
        this.batchTimeout = null;
      }

      if (cacheSize > 0) {
        this.activityCache.clear();
        this.cacheTimestamps.clear();
        this.cacheOrder = [];
        log.debug(`[SocialEnhancer] Cache cleared on page change (was ${cacheSize} entries)`);
      }

      if (!this.isOnHomePage()) {
        this.stopObservation();
      } else {
        this.startObservation();
        this.processNewCards();
      }
    });

    this.storeUnsubscribe = this.calendarStore.subscribeToSelector(
      (state: any) => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr: any, prev: any) => {
        if (curr.socialEnabled !== prev.socialEnabled || curr.socialShowAvatars !== prev.socialShowAvatars) {
          if (curr.socialEnabled) {
            this.applyPreferencesToAllCards();
          } else {
            this.stopObservation();
            this.removeAllWrappers();
          }
        }
      }
    );

    const { socialEnabled } = this.calendarStore.getState().preferences;
    if (socialEnabled && this.isOnHomePage()) {
      this.startObservation();
      this.processNewCards();
    }
  }

  /**
   * Check if the current page is a valid home page for social injection.
   */
  private isOnHomePage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path === '/home/' || path.startsWith('/home?');
  }

  public getName(): string {
    return 'socialEnhancer';
  }

  /**
   * Registers the module with the SharedGlobalObserver.
   */
  private startObservation(): void {
    this.sharedObserver.register('socialEnhancer', () => {
      this.processNewCards();
    });
  }

  /**
   * Unregisters the module from the SharedGlobalObserver.
   */
  private stopObservation(): void {
    this.sharedObserver.unregister('socialEnhancer');
  }

  /**
   * Re-applies preferences to all currently tagged cards.
   * Uses the cache to avoid redundant API calls.
   */
  private applyPreferencesToAllCards(): void {
    const tagged = document.querySelectorAll<HTMLElement>(`[${MEDIA_ID_ATTR}]`);

    tagged.forEach(card => {
      const mediaId = parseInt(card.getAttribute(MEDIA_ID_ATTR)!, 10);
      const activities = this.getCachedActivities(mediaId) ?? [];

      this.portalControllers.get(card)?.abort();

      const titleEl = card.querySelector('.title');
      const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';

      const link = (card as any)?.href || card.querySelector<HTMLAnchorElement>('a.cover')?.href || card.querySelector<HTMLAnchorElement>('a')?.href;
      const typeMatch = link?.match(/\/(anime|manga)\//);
      const type = (typeMatch ? typeMatch[1].toUpperCase() : 'ANIME') as any;

      const controller = SocialRenderer.attachPortal(card, mediaId, title, activities, type);
      this.portalControllers.set(card, controller);
    });

    this.startObservation();
    this.processNewCards();
  }

  /**
   * Removes all social bubbles and resets card processing state.
   */
  private removeAllWrappers(): void {
    this.portalControllers.forEach(controller => controller.abort());
    this.portalControllers.clear();

    document.querySelectorAll<HTMLElement>(`[${PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(PROCESSED_ATTR);
    });
    this.pendingCards.clear();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }

  /**
   * Scans the DOM for new media cards and triggers activity processing.
   */
  private processNewCards(): void {
    const { socialEnabled } = this.calendarStore.getState().preferences;
    if (!socialEnabled || !this.isOnHomePage()) return;

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.media-preview-card, .media-card'));

    let added = false;
    cards.forEach(card => {
      if (card.hasAttribute(PROCESSED_ATTR)) return;

      const extracted = this.extractMediaInfo(card);
      if (!extracted) return;
      const { mediaId, type } = extracted;

      card.setAttribute(PROCESSED_ATTR, 'true');
      card.setAttribute(MEDIA_ID_ATTR, String(mediaId));

      const cachedActivities = this.getCachedActivities(mediaId);
      if (cachedActivities) {
        const activities = cachedActivities;
        const titleEl = card.querySelector('.title');
        const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';
        
        const controller = SocialRenderer.attachPortal(card, mediaId, title, activities, type);
        this.portalControllers.set(card, controller);
        return;
      }

      if (!this.pendingCards.has(mediaId)) {
        this.pendingCards.set(mediaId, { elements: [], type });
      }
      this.pendingCards.get(mediaId)!.elements.push(card);
      added = true;
    });

    if (added) {
      this.scheduleBatchFetch();
    }
  }

  /**
   * Extracts media ID and type from a card element's URL.
   */
  private extractMediaInfo(card: HTMLElement): { mediaId: number, type: any } | null {
    const link = (card as any).href ||
      card.querySelector<HTMLAnchorElement>('a.cover')?.href ||
      card.querySelector<HTMLAnchorElement>('a')?.href;

    if (!link) return null;

    const match = link.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return null;
    
    return {
      mediaId: parseInt(match[2], 10),
      type: match[1].toUpperCase()
    };
  }

  /**
   * Schedules a debounced batch fetch for all pending cards.
   */
  private scheduleBatchFetch(): void {
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.batchTimeout = setTimeout(() => { this.flushBatch(); }, 800);
  }

  /**
   * Executes the GraphQL batch query for all pending media IDs.
   */
  private async flushBatch(): Promise<void> {
    const { socialEnabled } = this.calendarStore.getState().preferences;
    if (!socialEnabled) return;

    const ids = Array.from(this.pendingCards.keys());
    if (ids.length === 0) return;

    const currentBatch = new Map(this.pendingCards);
    this.pendingCards.clear();

    log.debug(`[SocialEnhancer] Fetching social for ${ids.length} cards`);

    try {
      const results = await this.socialService.getFriendActivityBatch(ids);

      currentBatch.forEach((data, mediaId) => {
        const activities = results.get(mediaId) ?? [];

        this.setCachedActivities(mediaId, activities);

        data.elements.forEach(card => {
          const titleEl = card.querySelector('.title');
          const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';
          
          const controller = SocialRenderer.attachPortal(card, mediaId, title, activities, data.type);
          this.portalControllers.set(card, controller);
        });
      });
    } catch (e) {
      log.error('[SocialEnhancer] Batch fetch failed', e);
    }
  }

  /**
   * Cleans up all resources and subscriptions.
   */
  public override async destroy(): Promise<void> {
    this.stopObservation();

    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }

    await super.destroy();
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.pendingCards.clear();
    this.activityCache.clear();
    this.cacheTimestamps.clear();
    this.cacheOrder = [];
  }

  /**
   * Retrieves activities from LRU cache if fresh.
   */
  private getCachedActivities(mediaId: number): FriendActivity[] | undefined {
    if (!this.activityCache.has(mediaId)) return undefined;

    const timestamp = this.cacheTimestamps.get(mediaId);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      this.activityCache.delete(mediaId);
      this.cacheTimestamps.delete(mediaId);
      this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
      log.debug(`[SocialEnhancer] Cache expired for mediaId ${mediaId}`);
      return undefined;
    }

    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);

    return this.activityCache.get(mediaId);
  }

  /**
   * Adds results to LRU cache and handles eviction if capacity exceeded.
   */
  private setCachedActivities(mediaId: number, activities: FriendActivity[]): void {
    if (this.activityCache.size >= this.MAX_CACHE_SIZE && !this.activityCache.has(mediaId)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.activityCache.delete(oldest);
        this.cacheTimestamps.delete(oldest);
        log.debug(`[SocialEnhancer] LRU evicted mediaId ${oldest} (cache size: ${this.activityCache.size})`);
      }
    }

    this.activityCache.set(mediaId, activities);
    this.cacheTimestamps.set(mediaId, Date.now());

    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);
  }
}
