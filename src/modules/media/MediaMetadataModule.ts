/**
 * @file MediaMetadataModule.ts
 * @description Injects external metadata (MAL score, MAL link, Subreddit) into media pages
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { mutationsMatchSelector, type SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { html } from '@core/utils/Template';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { METADATA_QUERY, createMetadataCache, isMetadataId, isMetadataType, parseJikanMetadataScore,
  parseMediaMetadataResponse, readMetadataCache, trustedRedditUrl, type MediaMetadataInfo, type MetadataMediaType } from './MediaMetadataResponse';

@injectable()
export class MediaMetadataModule extends BaseModule {
  private isProcessing = false;
  private pageVersion = 0;
  private destroyed = false;
  /** Visit (page version) whose metadata lookup was attempted; an empty lookup is not repeated until navigation. */
  private lookupAttemptVersion = -1;
  /** Visit whose pipeline failed; a failed pipeline is not retried until navigation. */
  private failedVersion = -1;
  private completedMetadata = new WeakMap<Element, { mediaId: number; type: MetadataMediaType; needsMal: boolean }>();
  private readonly OBSERVER_NAME = 'media-metadata-injector';

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (this.destroyed) return;
    const restart = () => {
      if (this.destroyed) return;
      this.fullCleanup();
      if (this.isMediaPage()) {
        this.startObservation();
      }
    };
    this.onPageChange(restart);
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, restart);

    if (this.isMediaPage()) {
      this.startObservation();
    }
  }

  public getName(): string {
    return 'mediaMetadata';
  }

  private isMediaPage(): boolean {
    return getMediaRoute(window.location.pathname) !== null;
  }

  private startObservation(): void {
    if (this.destroyed) return;
    const version = this.pageVersion;
    const processCurrent = () => {
      if (!this.destroyed && version === this.pageVersion) return this.checkAndProcess();
      return undefined;
    };
    void processCurrent();
    this.sharedObserver.register(this.OBSERVER_NAME, processCurrent, undefined,
      mutationsMatchSelector('.sidebar, .external-links-wrap, h1'));
  }

  private fullCleanup(): void {
    this.pageVersion++;
    this.completedMetadata = new WeakMap();
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    this.isProcessing = false;
    document
      .querySelectorAll('.au-mal-score, .au-subreddit, .au-reddit-btn')
      .forEach((el) => el.remove());
    // Drop the dedup tag so a reused sidebar element gets re-processed on the next page.
    document.querySelectorAll('[data-au-meta]').forEach((el) => el.removeAttribute('data-au-meta'));
  }

  public override async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fullCleanup();
    await super.destroy();
  }

  private async checkAndProcess(): Promise<void> {
    if (this.destroyed || this.isProcessing) return;

    const path = window.location.pathname;
    const route = getMediaRoute(path);
    if (!route) return;
    const mediaId = route.id;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // Dedup by tagging the sidebar element itself. The old guard keyed off the
    // injected `.au-mal-score` node, but that node is only added when the media
    // has a MAL id — so MAL-less entries never matched and re-fetched the Media
    // query on EVERY mutation-observer tick, contributing to the request burst /
    // rate-limit cascade. Tagging the element fixes that and still self-heals when
    // Vue re-renders the sidebar (the fresh element has no tag).
    const type = route.type;
    const completed = this.completedMetadata.get(sidebar);
    if (sidebar.getAttribute('data-au-meta') === String(mediaId) && completed?.mediaId === mediaId
      && completed.type === type && this.hasInjectedMetadata(sidebar, completed.needsMal)) return;
    const version = this.pageVersion;
    if (this.failedVersion === version) return;
    const isCurrent = () => !this.destroyed && version === this.pageVersion && window.location.pathname === path
      && sidebar.isConnected && document.querySelector('.sidebar') === sidebar;

    this.isProcessing = true;
    try {
      const context = await captureApiContext(this.apiClient);
      const assertCurrentAccount = () => assertApiContext(this.apiClient, context);
      assertCurrentAccount();
      if (!isCurrent()) return;
      const cacheKey = `metadata_cache_${mediaId}`;
      const rawCache: unknown = await this.storage.get<unknown>(cacheKey);
      assertCurrentAccount();
      if (!isCurrent()) return;
      let info = readMetadataCache(rawCache, mediaId, type);
      // Marked before the request so a failed or empty lookup runs once per visit, not on every observer tick.
      if (!info && this.lookupAttemptVersion !== version) {
        this.lookupAttemptVersion = version;
        info = await this.fetchMediaInfo(mediaId, type, assertCurrentAccount);
        assertCurrentAccount();
        if (!isCurrent()) return;
        if (info) {
          await this.storage.set(cacheKey, createMetadataCache(mediaId, type, info));
          assertCurrentAccount();
        }
        if (!isCurrent()) return;
      }
      const ready = await this.injectMetadata(sidebar as HTMLElement, info, type, isCurrent);
      assertCurrentAccount();
      if (isCurrent() && ready) {
        this.completedMetadata.set(sidebar, { mediaId, type, needsMal: info?.idMal !== null && info?.idMal !== undefined });
        sidebar.setAttribute('data-au-meta', String(mediaId));
      }
    } catch (error) {
      this.failedVersion = version;
      this.logger.debug('[MediaMetadata] Process failed', error);
    } finally {
      if (version === this.pageVersion) this.isProcessing = false;
    }
  }

  private async fetchMediaInfo(mediaId: number, type: MetadataMediaType, assertCurrentAccount: () => void): Promise<MediaMetadataInfo | null> {
    if (!isMetadataId(mediaId) || !isMetadataType(type)) throw new Error('Invalid metadata identity');
    const data = await this.apiClient.query<unknown>(METADATA_QUERY, { id: mediaId, type });
    assertCurrentAccount();
    const info = parseMediaMetadataResponse(data, mediaId, type);
    if (!info) return null;
    const malScore = info.idMal === null ? null : await this.fetchMalScore(info.idMal, type, assertCurrentAccount);
    assertCurrentAccount();
    return { ...info, malScore };
  }

  private async fetchMalScore(idMal: number, type: MetadataMediaType, assertCurrentAccount: () => void): Promise<string | null> {
    if (!isMetadataId(idMal) || !isMetadataType(type)) throw new Error('Invalid metadata MAL identity');
    const response: unknown = await chrome.runtime.sendMessage({ type: MSG.MEDIA_METADATA_SCORE, idMal, mediaType: type });
    assertCurrentAccount();
    if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) {
      throw new Error('MAL score unavailable');
    }
    return parseJikanMetadataScore(response.data, idMal);
  }

  private hasInjectedMetadata(sidebar: Element, needsMal: boolean): boolean {
    if (needsMal && !sidebar.querySelector('.au-mal-score')) return false;
    const links = document.querySelector('.external-links-wrap');
    return links !== null && Array.from(links.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .some(link => trustedRedditUrl(link.getAttribute('href')) !== null);
  }

  private async injectMetadata(
    sidebar: HTMLElement,
    info: MediaMetadataInfo | null,
    type: MetadataMediaType,
    isCurrent: () => boolean
  ): Promise<boolean> {
    if (!isCurrent()) return false;
    const externalLinksWrap = document.querySelector('.external-links-wrap');
    const scoreParent = ['Mean Score', 'Average Score'].map(label => Array.from(sidebar.querySelectorAll('.type'))
      .find(element => element.textContent?.trim() === label)?.closest('.data-set')).find(parent => parent != null);
    // Vue may mount the sidebar before its contents and the external-links section.
    // Keep the validated public cache, but wait for both targets before completing injection.
    if (!externalLinksWrap || (info?.idMal && !sidebar.querySelector('.au-mal-score') && !scoreParent)) return false;
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    // 1. MAL Score - Perfect integration
    if (info?.idMal && !sidebar.querySelector('.au-mal-score')) {
      // Use cached score if available
      const score = info.malScore;
      if (!isCurrent()) return false;
      const malUrl = `https://myanimelist.net/${type.toLowerCase()}/${info.idMal}`;

      const malSection = html`
        <div class="data-set au-mal-score" style="margin-bottom: 14px;">
          <div
            class="type"
            style="font-size: 1.2rem; color: var(--color-text-light); padding-bottom: 5px; font-weight: 500;"
          >
            MAL Score
          </div>
          <div class="value" style="font-size: 1.2rem;">
            <a href="${malUrl}" target="_blank" style="color: rgb(140, 153, 169); font-weight: 400;"
              >${score || 'N/A'}</a
            >
          </div>
        </div>
      `;

      scoreParent?.after(malSection);
    }

    // 2. Subreddit Button in External Links
    const hasRedditLink = externalLinksWrap && Array.from(externalLinksWrap.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .some(link => trustedRedditUrl(link.getAttribute('href')) !== null);
    if (externalLinksWrap && !hasRedditLink) {
      const redditUrl =
        info?.externalLinks.map(link => trustedRedditUrl(link.url)).find(url => url !== null) ||
        `https://www.reddit.com/search/?q=${encodeURIComponent(title)}`;

      const redditBtn = document.createElement('a');
      redditBtn.href = redditUrl;
      redditBtn.target = '_blank';
      redditBtn.rel = 'noopener noreferrer';
      redditBtn.className = 'external-link au-reddit-btn';

      // Copy scoped CSS attributes from a sibling to inherit background/layout
      const sibling = externalLinksWrap.querySelector('.external-link');
      const dataAttr = sibling
        ? Array.from(sibling.attributes).find((a) => a.name.startsWith('data-v-'))?.name
        : null;

      if (dataAttr) {
        redditBtn.setAttribute(dataAttr, '');
      }

      redditBtn.style.setProperty('--link-color', 'rgb(255, 69, 0)');

      const redditInner = html`
        <div style="display: contents;">
          <div
            class="icon-wrap"
            style="background: rgb(255, 69, 0); width: 25px; height: 25px; display: flex !important; align-items: center; justify-content: center; border-radius: 4px; flex-shrink: 0;"
          >
            <i class="fa-brands fa-reddit-alien" style="color: white; font-size: 16px;"></i>
          </div>
          <span
            class="name"
            style="font-size: 1.4rem; font-weight: 700; color: var(--color-text);"
            >Reddit</span
          >
        </div>
      `;

      if (dataAttr) {
        redditInner.querySelectorAll('.icon-wrap, .name').forEach(element => element.setAttribute(dataAttr, ''));
      }

      redditBtn.appendChild(redditInner);
      externalLinksWrap.appendChild(redditBtn);
    }
    return this.hasInjectedMetadata(sidebar, info?.idMal !== null && info?.idMal !== undefined);
  }
}
