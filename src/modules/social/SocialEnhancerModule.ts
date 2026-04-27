/**
 * @file SocialEnhancerModule.ts
 * @description Injects friend activity avatars and buttons onto native AniList media cards
 *
 * Architecture:
 * - activityCache: stores fetched activities per mediaId for instant re-inject on pref change
 * - pendingCards: cards waiting for first-time fetch
 * - On pref change: immediately re-apply cache to all tagged cards, no extra API call
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { FriendActivity } from '@core/types';
import { SocialService } from './SocialService';
import { SocialRenderer } from './SocialRenderer';
import { calendarStore } from '../calendar/CalendarStore';

/** Attribute set on cards after first injection to track mediaId */
const PROCESSED_ATTR = 'data-au-social-processed';
const MEDIA_ID_ATTR = 'data-au-social-media-id';

@injectable()
export class SocialEnhancerModule extends BaseModule {
  private observerName = 'global-social-enhancer';
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Cards waiting for their first API fetch, keyed by mediaId */
  private pendingCards: Map<number, HTMLElement[]> = new Map();

  /** Cache of fetched activities, keyed by mediaId — used for instant re-inject */
  private activityCache: Map<number, FriendActivity[]> = new Map();

  /** PERF-002 fix: LRU tracking for cache eviction */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: number[] = [];

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.info('SocialEnhancerModule: Initializing...');

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
    if (socialEnabled) {
      this.startObservation();
      this.processNewCards();
    }
  }

  public getName(): string {
    return 'socialEnhancer';
  }

  // ─── Observation ───────────────────────────────────────────────────────────

  private startObservation(): void {
    this.registerObserver(this.observerName, document.body, { childList: true, subtree: true }, () => {
      this.processNewCards();
    });
  }

  private stopObservation(): void {
    this.disconnectObserver(this.observerName);
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

      // Remove existing wrapper first
      card.querySelector('.au-social-wrapper')?.remove();

      // Re-inject with current preferences (SocialRenderer checks prefs internally)
      SocialRenderer.injectIntoCard(card, mediaId, activities);
    });

    // Also ensure observer is running and pick up any new cards
    this.startObservation();
    this.processNewCards();
  }

  /**
   * Remove all social wrappers from the DOM (when social is fully disabled).
   */
  private removeAllWrappers(): void {
    document.querySelectorAll('.au-social-wrapper').forEach(el => el.remove());
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
    if (!socialEnabled) return;

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.media-preview-card, .media-card'));

    let added = false;
    cards.forEach(card => {
      // Skip already-processed cards
      if (card.hasAttribute(PROCESSED_ATTR)) return;

      const mediaId = this.extractMediaId(card);
      if (!mediaId) return;

      // Tag the card so we can find it later by mediaId
      card.setAttribute(PROCESSED_ATTR, 'true');
      card.setAttribute(MEDIA_ID_ATTR, String(mediaId));

      // If we already have cached data, inject immediately — no fetch needed
      const cachedActivities = this.getCachedActivities(mediaId); // PERF-002 fix: use LRU cache
      if (cachedActivities) {
        const activities = cachedActivities;
        SocialRenderer.injectIntoCard(card, mediaId, activities);
        return;
      }

      // Otherwise queue for batch fetch
      if (!this.pendingCards.has(mediaId)) {
        this.pendingCards.set(mediaId, []);
      }
      this.pendingCards.get(mediaId)!.push(card);
      added = true;
    });

    if (added) {
      this.scheduleBatchFetch();
    }
  }

  private extractMediaId(card: HTMLElement): number | null {
    const link = (card as any).href ||
                 card.querySelector<HTMLAnchorElement>('a.cover')?.href ||
                 card.querySelector<HTMLAnchorElement>('a')?.href;

    if (!link) return null;

    const match = link.match(/\/(anime|manga)\/(\d+)/);
    return match ? parseInt(match[2], 10) : null;
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

      currentBatch.forEach((elements, mediaId) => {
        const activities = results.get(mediaId) ?? [];

        // Store in cache for instant re-apply on future pref changes
        this.setCachedActivities(mediaId, activities); // PERF-002 fix: use LRU cache

        elements.forEach(card => {
          SocialRenderer.injectIntoCard(card, mediaId, activities);
        });
      });
    } catch (e) {
      log.error('[SocialEnhancer] Batch fetch failed', e);
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public override async destroy(): Promise<void> {
    super.destroy();
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.pendingCards.clear();
    this.activityCache.clear();
    this.cacheOrder = []; // PERF-002 fix: clear LRU order
  }

  // ─── PERF-002 Fix: LRU Cache Helpers ──────────────────────────────────────

  /** Get from cache with LRU tracking */
  private getCachedActivities(mediaId: number): FriendActivity[] | undefined {
    if (!this.activityCache.has(mediaId)) return undefined;

    // Move to end (most recently used)
    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);

    return this.activityCache.get(mediaId);
  }

  /** Set cache with LRU eviction */
  private setCachedActivities(mediaId: number, activities: FriendActivity[]): void {
    // Evict oldest if at capacity
    if (this.activityCache.size >= this.MAX_CACHE_SIZE && !this.activityCache.has(mediaId)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.activityCache.delete(oldest);
        log.debug(`[SocialEnhancer] LRU evicted mediaId ${oldest} (cache size: ${this.activityCache.size})`);
      }
    }

    this.activityCache.set(mediaId, activities);

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);
  }
}
