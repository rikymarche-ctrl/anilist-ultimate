/**
 * @file SocialEnhancerModule.ts
 * @description Injects friend activity avatars onto media cards with intelligent caching.
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { FriendActivity, MediaType } from '@core/types';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { SocialService } from './SocialService';
import { SocialRenderer } from './SocialRenderer';
import { PreferencesService } from '@core/services/PreferencesService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { getMediaRoute } from '@core/navigation/MediaRoute';

/** Attribute set on cards after first injection to track mediaId */
const PROCESSED_ATTR = 'data-au-social-processed';
const MEDIA_ID_ATTR = 'data-au-social-media-id';

@injectable()
export class SocialEnhancerModule extends BaseModule {
  /** Timer for batching API requests to avoid spamming GraphQL */
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private active = false;
  private observing = false;
  private processedCards = new Set<HTMLElement>();
  private cardVersions = new WeakMap<HTMLElement, number>();
  
  /** Track portal controllers to prevent duplicates and cleanup on page change */
  private portalControllers: Map<HTMLElement, AbortController> = new Map();

  /** Cards waiting for their first API fetch, keyed by mediaId */
  private pendingCards: Map<number, { elements: Map<HTMLElement, number>, type: MediaType }> = new Map();

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
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.onPageChange(() => this.restart(true));
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => this.restart(true));
    const generation = this.generation;
    this.prefsUnsubscribe = this.preferences.onChanges(curr => {
      // A captured callback from a previous mount cannot restart this instance.
      if (!this.active || this.prefsUnsubscribe === null || generation !== this.mountGeneration) return;
      if (curr.socialEnabled && this.isOnHomePage()) this.applyPreferencesToAllCards();
      else this.restart(false);
    });
    this.mountGeneration = generation;
    if (this.isOnHomePage() && this.preferences.isSocialEnabled()) {
      this.startObservation();
      this.processNewCards();
    }
  }

  private mountGeneration = 0;

  private restart(clearCache: boolean): void {
    if (!this.active) return;
    this.generation++;
    this.stopObservation();
    this.removeAllWrappers();
    if (clearCache) this.clearCache();
    if (this.isOnHomePage() && this.preferences.isSocialEnabled()) {
      this.startObservation();
      this.processNewCards();
    }
  }

  private clearCache(): void {
    this.activityCache.clear();
    this.cacheTimestamps.clear();
    this.cacheOrder = [];
  }

  private isOnHomePage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path === '/home/' || path.startsWith('/home?');
  }

  public getName(): string {
    return 'socialEnhancer';
  }

  private startObservation(): void {
    if (this.observing || !this.active || !this.isOnHomePage() || !this.preferences.isSocialEnabled()) return;
    this.observing = true;
    const generation = this.generation;
    this.sharedObserver.register('socialEnhancer', () => {
      if (this.active && this.generation === generation) this.processNewCards();
    });
  }

  private stopObservation(): void {
    if (this.observing) this.sharedObserver.unregister('socialEnhancer');
    this.observing = false;
  }

  private applyPreferencesToAllCards(): void {
    if (!this.active || !this.isOnHomePage() || !this.preferences.isSocialEnabled()) return;
    for (const card of [...this.portalControllers.keys()]) {
      const info = this.extractMediaInfo(card);
      if (!info || !this.matches(card, info.mediaId, info.type)) { this.releaseCard(card); continue; }
      const activities = this.getCachedActivities(info.mediaId);
      if (!activities) { this.releaseCard(card); continue; }
      this.attach(card, info.mediaId, activities, info.type);
    }
    this.startObservation();
    this.processNewCards();
  }

  private releaseCard(card: HTMLElement): void {
    this.cardVersions.set(card, (this.cardVersions.get(card) ?? 0) + 1);
    this.portalControllers.get(card)?.abort();
    this.portalControllers.delete(card);
    this.processedCards.delete(card);
    card.removeAttribute(PROCESSED_ATTR);
    card.removeAttribute(MEDIA_ID_ATTR);
  }

  private removeAllWrappers(): void {
    for (const card of [...this.processedCards]) this.releaseCard(card);
    this.pendingCards.clear();
    if (this.batchTimeout !== null) clearTimeout(this.batchTimeout);
    this.batchTimeout = null;
  }

  private attach(card: HTMLElement, mediaId: number, activities: FriendActivity[], type: MediaType): void {
    this.portalControllers.get(card)?.abort();
    const title = card.querySelector('.title')?.textContent?.trim() || 'Anime';
    this.portalControllers.set(card, this.renderer.attachPortal(card, mediaId, title, activities, type));
  }

  private matches(card: HTMLElement, mediaId: number, type: MediaType, version?: number): boolean {
    const info = this.extractMediaInfo(card);
    return (version === undefined || version === this.cardVersions.get(card))
      && card.isConnected && this.processedCards.has(card) && card.hasAttribute(PROCESSED_ATTR)
      && card.getAttribute(MEDIA_ID_ATTR) === String(mediaId) && info?.mediaId === mediaId && info.type === type;
  }

  private processNewCards(): void {
    if (!this.active || !this.preferences.isSocialEnabled() || !this.isOnHomePage()) return;
    for (const card of [...this.processedCards]) {
      if (!card.isConnected) this.releaseCard(card);
    }
    let added = false;
    for (const card of document.querySelectorAll<HTMLElement>('.media-preview-card, .media-card')) {
      const info = this.extractMediaInfo(card);
      if (!info) { if (this.processedCards.has(card)) this.releaseCard(card); continue; }
      const { mediaId, type } = info;
      if (this.matches(card, mediaId, type)) continue;
      this.releaseCard(card);
      this.processedCards.add(card);
      card.setAttribute(PROCESSED_ATTR, 'true');
      card.setAttribute(MEDIA_ID_ATTR, String(mediaId));
      const cached = this.getCachedActivities(mediaId);
      if (cached) { this.attach(card, mediaId, cached, type); continue; }
      if (!this.pendingCards.has(mediaId)) this.pendingCards.set(mediaId, { elements: new Map(), type });
      this.pendingCards.get(mediaId)!.elements.set(card, this.cardVersions.get(card)!);
      added = true;
    }
    if (added) this.scheduleBatchFetch();
  }

  private extractMediaInfo(card: HTMLElement): { mediaId: number; type: MediaType } | null {
    const href = card instanceof HTMLAnchorElement ? card.href
      : card.querySelector<HTMLAnchorElement>('a.cover')?.href || card.querySelector<HTMLAnchorElement>('a')?.href;
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      const route = getMediaRoute(url.pathname);
      return route && route.id <= 2147483647 ? { mediaId: route.id, type: route.type } : null;
    } catch { return null; }
  }

  private scheduleBatchFetch(): void {
    if (this.batchTimeout !== null) clearTimeout(this.batchTimeout);
    this.batchTimeout = setTimeout(() => {
      this.batchTimeout = null;
      void this.flushBatch();
    }, 800);
  }

  private async flushBatch(): Promise<void> {
    const generation = this.generation;
    const current = () => this.active && generation === this.generation && this.preferences.isSocialEnabled() && this.isOnHomePage();
    if (!current()) return;
    const currentBatch = new Map(this.pendingCards);
    this.pendingCards.clear();
    // Do not fetch cards that were removed or reused before the debounce elapsed.
    for (const [mediaId, data] of currentBatch) {
      data.elements = new Map([...data.elements].filter(([card, version]) => this.matches(card, mediaId, data.type, version)));
      if (data.elements.size === 0) currentBatch.delete(mediaId);
    }
    if (currentBatch.size === 0) return;
    const releaseBatch = () => {
      for (const [mediaId, data] of currentBatch) {
        for (const [card, version] of data.elements) if (this.matches(card, mediaId, data.type, version)) this.releaseCard(card);
      }
    };
    try {
      const results = await this.socialService.getFriendActivityBatch([...currentBatch.keys()]);
      if (!current()) return;
      for (const [mediaId, data] of currentBatch) {
        if (!results.has(mediaId)) {
          for (const [card, version] of data.elements) if (this.matches(card, mediaId, data.type, version)) this.releaseCard(card);
          continue;
        }
        if (![...data.elements].some(([card, version]) => this.matches(card, mediaId, data.type, version))) continue;
        const activities = results.get(mediaId)!;
        this.setCachedActivities(mediaId, activities);
        for (const [card, version] of data.elements) {
          if (this.matches(card, mediaId, data.type, version)) this.attach(card, mediaId, activities, data.type);
        }
      }
    } catch (error) {
      if (current()) { releaseBatch(); logger.error('[SocialEnhancer] Batch fetch failed', error); }
    }
  }

  public override async destroy(): Promise<void> {
    this.active = false;
    this.generation++;
    this.stopObservation();
    this.prefsUnsubscribe?.();
    this.prefsUnsubscribe = null;
    this.removeAllWrappers();
    this.clearCache();
    await super.destroy();
  }

  private getCachedActivities(mediaId: number): FriendActivity[] | undefined {
    if (!this.activityCache.has(mediaId)) return undefined;

    const timestamp = this.cacheTimestamps.get(mediaId);
    if (timestamp === undefined || Date.now() - timestamp > this.CACHE_TTL_MS || timestamp > Date.now()) {
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
