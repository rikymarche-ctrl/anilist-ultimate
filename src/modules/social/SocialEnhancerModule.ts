/**
 * @file SocialEnhancerModule.ts
 * @description Injects friend activity avatars onto media cards with intelligent caching.
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
import { PreferencesService } from '@core/services/PreferencesService';

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

  /** LRU tracking for cache eviction (max 100 entries) */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: number[] = [];

  /** TTL for cache entries (5 minutes) to ensure data freshness */
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cacheTimestamps: Map<number, number> = new Map();

  /** Unsubscribe function for preferences */
  private prefsUnsubscribe: (() => void) | null = null;

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.SocialRenderer) private renderer: SocialRenderer,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.PreferencesService) private preferences: PreferencesService
  ) {
    super(eventBus);
  }

  /**
   * Initialize the social enhancer module.
   */
  public async init(): Promise<void> {
    log.info('SocialEnhancerModule: Initializing...');

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

    this.prefsUnsubscribe = this.preferences.onChanges((curr) => {
      if (curr.socialEnabled) {
        this.applyPreferencesToAllCards();
      } else {
        this.stopObservation();
        this.removeAllWrappers();
      }
    });

    if (this.preferences.isSocialEnabled() && this.isOnHomePage()) {
      this.startObservation();
      this.processNewCards();
    }
  }

  private isOnHomePage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path === '/home/' || path.startsWith('/home?');
  }

  public getName(): string {
    return 'socialEnhancer';
  }

  private startObservation(): void {
    this.sharedObserver.register('socialEnhancer', () => {
      this.processNewCards();
    });
  }

  private stopObservation(): void {
    this.sharedObserver.unregister('socialEnhancer');
  }

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

      const controller = this.renderer.attachPortal(card, mediaId, title, activities, type);
      this.portalControllers.set(card, controller);
    });

    this.startObservation();
    this.processNewCards();
  }

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

  private processNewCards(): void {
    if (!this.preferences.isSocialEnabled() || !this.isOnHomePage()) return;

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
        const titleEl = card.querySelector('.title');
        const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';
        
        const controller = this.renderer.attachPortal(card, mediaId, title, cachedActivities, type);
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
    if (!this.preferences.isSocialEnabled()) return;

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
          
          const controller = this.renderer.attachPortal(card, mediaId, title, activities, data.type);
          this.portalControllers.set(card, controller);
        });
      });
    } catch (e) {
      log.error('[SocialEnhancer] Batch fetch failed', e);
    }
  }

  public override async destroy(): Promise<void> {
    this.stopObservation();

    if (this.prefsUnsubscribe) {
      this.prefsUnsubscribe();
      this.prefsUnsubscribe = null;
    }

    await super.destroy();
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.pendingCards.clear();
    this.activityCache.clear();
    this.cacheTimestamps.clear();
    this.cacheOrder = [];
  }

  private getCachedActivities(mediaId: number): FriendActivity[] | undefined {
    if (!this.activityCache.has(mediaId)) return undefined;

    const timestamp = this.cacheTimestamps.get(mediaId);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      this.activityCache.delete(mediaId);
      this.cacheTimestamps.delete(mediaId);
      this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
      return undefined;
    }

    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);

    return this.activityCache.get(mediaId);
  }

  private setCachedActivities(mediaId: number, activities: FriendActivity[]): void {
    if (this.activityCache.size >= this.MAX_CACHE_SIZE && !this.activityCache.has(mediaId)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.activityCache.delete(oldest);
        this.cacheTimestamps.delete(oldest);
      }
    }

    this.activityCache.set(mediaId, activities);
    this.cacheTimestamps.set(mediaId, Date.now());

    this.cacheOrder = this.cacheOrder.filter(id => id !== mediaId);
    this.cacheOrder.push(mediaId);
  }
}
