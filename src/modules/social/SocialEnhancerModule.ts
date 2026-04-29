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
import { calendarStore } from '../calendar/CalendarStore';

/** Attribute set on cards after first injection to track mediaId */
const PROCESSED_ATTR = 'data-au-social-processed';
const MEDIA_ID_ATTR = 'data-au-social-media-id';

@injectable()
export class SocialEnhancerModule extends BaseModule {
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  
  /** Track portal controllers to prevent duplicates and cleanup on page change */
  private portalControllers: Map<HTMLElement, AbortController> = new Map();

  /** Cards waiting for their first API fetch, keyed by mediaId */
  private pendingCards: Map<number, { elements: HTMLElement[], type: any }> = new Map();

  /** Cache of fetched activities, keyed by mediaId — used for instant re-inject */
  private activityCache: Map<number, FriendActivity[]> = new Map();

  /** PERF-002 fix: LRU tracking for cache eviction */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: number[] = [];

  /** BUG-030 fix: TTL for cache entries (5 minutes) */
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cacheTimestamps: Map<number, number> = new Map();

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.info('SocialEnhancerModule: Initializing...');

    // Must wait for store initialization so we don't read default preferences
    await calendarStore.init();

    // BUG-030 fix: Clear cache on page navigation to prevent unbounded growth
    this.onPageChange(() => {
      const cacheSize = this.activityCache.size;
      
      // Cleanup DOM immediately on navigation to prevent orphaned bubbles
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

      // If we moved away from home, stop observation
      if (!this.isOnHomePage()) {
        this.stopObservation();
      } else {
        // If we moved to/stayed on home, ensure observation is active
        this.startObservation();
        this.processNewCards();
      }
    });

    // React immediately to social preference changes using cached data
    calendarStore.subscribeToSelector(
      state => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr, prev) => {
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

    const { socialEnabled } = calendarStore.getState().preferences;
    if (socialEnabled && this.isOnHomePage()) {
      this.startObservation();
      this.processNewCards();
    }
  }

  /**
   * Check if the current page is the AniList home page
   */
  private isOnHomePage(): boolean {
    const path = window.location.pathname;
    const isHome = path === '/' || path === '/home' || path === '/home/' || path.startsWith('/home?');
    log.debug(`[SocialEnhancer] Path check: ${path} -> isHome: ${isHome}`);
    return isHome;
  }

  public getName(): string {
    return 'socialEnhancer';
  }

  // ─── Observation ───────────────────────────────────────────────────────────

  private startObservation(): void {
    // BUG-007 fix: Use SharedGlobalObserver instead of individual observer
    this.sharedObserver.register('socialEnhancer', () => {
      this.processNewCards();
    });
  }

  private stopObservation(): void {
    this.sharedObserver.unregister('socialEnhancer');
  }

  // ─── Preference change handling ────────────────────────────────────────────

  /**
   * Called when a social preference changes.
   * Re-applies injection to ALL currently-tagged cards using the cache — no API call.
   * Untagged cards will be picked up by the normal observer path.
   */
  private applyPreferencesToAllCards(): void {
    const tagged = document.querySelectorAll<HTMLElement>(`[${MEDIA_ID_ATTR}]`);

    tagged.forEach(card => {
      const mediaId = parseInt(card.getAttribute(MEDIA_ID_ATTR)!, 10);
      const activities = this.getCachedActivities(mediaId) ?? []; // PERF-002 fix: use LRU cache

      // Cleanup existing portal if any
      this.portalControllers.get(card)?.abort();

      const titleEl = card.querySelector('.title');
      const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';

      // Extract type for portal
      const link = (card as any)?.href || card.querySelector<HTMLAnchorElement>('a.cover')?.href || card.querySelector<HTMLAnchorElement>('a')?.href;
      const typeMatch = link?.match(/\/(anime|manga)\//);
      const type = (typeMatch ? typeMatch[1].toUpperCase() : 'ANIME') as any;

      // Re-inject with current preferences (SocialRenderer checks prefs internally)
      const controller = SocialRenderer.attachPortal(card, mediaId, title, activities, type);
      this.portalControllers.set(card, controller);
    });

    // Also ensure observer is running and pick up any new cards
    this.startObservation();
    this.processNewCards();
  }

  /**
   * Remove all social wrappers from the DOM (when social is fully disabled).
   */
  private removeAllWrappers(): void {
    this.portalControllers.forEach(controller => controller.abort());
    this.portalControllers.clear();

    // Remove processed marks so cards can be re-picked if social is re-enabled later
    document.querySelectorAll<HTMLElement>(`[${PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(PROCESSED_ATTR);
    });
    this.pendingCards.clear();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }

  // ─── Normal first-injection path ───────────────────────────────────────────

  /**
   * Scan for new, unprocessed cards and queue them for batch fetch.
   */
  private processNewCards(): void {
    const { socialEnabled } = calendarStore.getState().preferences;
    if (!socialEnabled || !this.isOnHomePage()) return;

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.media-preview-card, .media-card'));

    let added = false;
    cards.forEach(card => {
      // Skip already-processed cards
      if (card.hasAttribute(PROCESSED_ATTR)) return;

      const extracted = this.extractMediaInfo(card);
      if (!extracted) return;
      const { mediaId, type } = extracted;

      // Tag the card so we can find it later by mediaId
      card.setAttribute(PROCESSED_ATTR, 'true');
      card.setAttribute(MEDIA_ID_ATTR, String(mediaId));

      // If we already have cached data, inject immediately — no fetch needed
      const cachedActivities = this.getCachedActivities(mediaId); // PERF-002 fix: use LRU cache
      if (cachedActivities) {
        const activities = cachedActivities;
        const titleEl = card.querySelector('.title');
        const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';
        
        // We know the type from extraction above
        const controller = SocialRenderer.attachPortal(card, mediaId, title, activities, type);
        this.portalControllers.set(card, controller);
        return;
      }

      // Otherwise queue for batch fetch
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

  private scheduleBatchFetch(): void {
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.batchTimeout = setTimeout(() => { this.flushBatch(); }, 800);
  }

  private async flushBatch(): Promise<void> {
    const { socialEnabled } = calendarStore.getState().preferences;
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

        // Store in cache for instant re-apply on future pref changes
        this.setCachedActivities(mediaId, activities); // PERF-002 fix: use LRU cache

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

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public override async destroy(): Promise<void> {
    // BUG-007 fix: Unregister from SharedGlobalObserver
    this.stopObservation();

    super.destroy();
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.pendingCards.clear();
    this.activityCache.clear();
    this.cacheTimestamps.clear(); // BUG-030 fix: clear timestamps
    this.cacheOrder = []; // PERF-002 fix: clear LRU order
  }

  // ─── PERF-002 Fix: LRU Cache Helpers ──────────────────────────────────────

  /** Get from cache with LRU tracking and TTL validation */
  private getCachedActivities(mediaId: number): FriendActivity[] | undefined {
    if (!this.activityCache.has(mediaId)) return undefined;

    // BUG-030 fix: Check if entry is still fresh
    const timestamp = this.cacheTimestamps.get(mediaId);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      // Expired - evict and return undefined
      this.activityCache.delete(mediaId);
      this.cacheTimestamps.delete(mediaId);
      this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
      log.debug(`[SocialEnhancer] Cache expired for mediaId ${mediaId}`);
      return undefined;
    }

    // Move to end (most recently used)
    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);

    return this.activityCache.get(mediaId);
  }

  /** Set cache with LRU eviction and TTL tracking */
  private setCachedActivities(mediaId: number, activities: FriendActivity[]): void {
    // Evict oldest if at capacity
    if (this.activityCache.size >= this.MAX_CACHE_SIZE && !this.activityCache.has(mediaId)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.activityCache.delete(oldest);
        this.cacheTimestamps.delete(oldest); // BUG-030 fix: also delete timestamp
        log.debug(`[SocialEnhancer] LRU evicted mediaId ${oldest} (cache size: ${this.activityCache.size})`);
      }
    }

    this.activityCache.set(mediaId, activities);
    this.cacheTimestamps.set(mediaId, Date.now()); // BUG-030 fix: store timestamp

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);
  }
}
