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
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { localStorage } from '@core/storage/StorageManager';
import { html } from '@core/utils/Template';

interface MediaInfo {
  idMal: number | null;
  externalLinks: {
    url: string;
    site: string;
  }[];
}

@injectable()
export class MediaMetadataModule extends BaseModule {
  private mediaId: number | null = null;
  private isProcessing = false;
  private readonly OBSERVER_NAME = 'media-metadata-injector';

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    this.onPageChange(() => {
      this.fullCleanup();
      if (this.isMediaPage()) {
        this.startObservation();
      }
    });

    if (this.isMediaPage()) {
      this.startObservation();
    }
  }

  public getName(): string {
    return 'mediaMetadata';
  }

  private isMediaPage(): boolean {
    return /^\/(anime|manga)\/\d+/.test(window.location.pathname);
  }

  private startObservation(): void {
    this.checkAndProcess();
    this.sharedObserver.register(this.OBSERVER_NAME, () => {
      this.checkAndProcess();
    });
  }

  private fullCleanup(): void {
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    this.mediaId = null;
    this.isProcessing = false;
    document.querySelectorAll('.au-mal-score, .au-subreddit, .au-reddit-btn').forEach(el => el.remove());
  }

  private async checkAndProcess(): Promise<void> {
    if (this.isProcessing) return;

    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[2], 10);
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // Fix: Check for the specific injected classes to prevent duplicates
    if (this.mediaId === mediaId && sidebar.querySelector('.au-mal-score')) return;

    const type = match[1].toUpperCase();
    this.mediaId = mediaId;

    this.isProcessing = true;
    try {
      const cacheKey = `metadata_cache_${mediaId}`;
      const cached = await localStorage.get<any>(cacheKey);

      if (cached) {
        await this.injectMetadata(sidebar as HTMLElement, cached, type);
        // Refresh cache in background
        this.fetchMediaInfo(mediaId).then(info => {
          if (info) localStorage.set(cacheKey, info);
        });
      } else {
        const info = await this.fetchMediaInfo(mediaId);
        if (info) await localStorage.set(cacheKey, info);
        await this.injectMetadata(sidebar as HTMLElement, info, type);
      }
    } catch (error) {
      this.logger.debug('[MediaMetadata] Process failed', error);
      await this.injectMetadata(sidebar as HTMLElement, null, type);
    } finally {
      this.isProcessing = false;
    }
  }

  private async fetchMediaInfo(mediaId: number): Promise<MediaInfo | null> {
    const query = `
      query ($id: Int) {
        Media (id: $id) {
          idMal
          externalLinks {
            url
            site
          }
        }
      }
    `;

    try {
      const data = await this.apiClient.query<any>(query, { id: mediaId });
      if (data?.Media) {
        const info = data.Media;
        // Fetch MAL score in background and update cache if possible
        if (info.idMal) {
          const score = await this.fetchMalScore(info.idMal, window.location.pathname.includes('/anime/') ? 'ANIME' : 'MANGA');
          (info as any).malScore = score;
        }
        return info;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async fetchMalScore(idMal: number, type: string): Promise<string | null> {
    try {
      const apiType = type === 'ANIME' ? 'anime' : 'manga';
      const response = await fetch(`https://api.jikan.moe/v4/${apiType}/${idMal}`);
      const data = await response.json();
      return data?.data?.score ? data.data.score.toString() : null;
    } catch (error) {
      return null;
    }
  }

  private async injectMetadata(sidebar: HTMLElement, info: MediaInfo | null, type: string): Promise<void> {
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    // 1. MAL Score - Perfect integration
    if (info?.idMal) {
      // Use cached score if available
      const score = (info as any).malScore || await this.fetchMalScore(info.idMal, type);
      const malUrl = `https://myanimelist.net/${type.toLowerCase()}/${info.idMal}`;

      const malSection = html`
        <div class="data-set au-mal-score" style="margin-bottom: 14px;">
          <div class="type" style="font-size: 1.2rem; color: var(--color-text-light); padding-bottom: 5px; font-weight: 500;">MAL Score</div>
          <div class="value" style="font-size: 1.2rem;">
            <a href="${malUrl}" target="_blank" style="color: rgb(140, 153, 169); font-weight: 400;">${score || 'N/A'}</a>
          </div>
        </div>
      `;

      // Inject after Mean Score
      const meanScoreHeader = Array.from(sidebar.querySelectorAll('.type')).find(el => 
        el.textContent?.trim() === 'Mean Score'
      );
      
      if (meanScoreHeader) {
        const parent = meanScoreHeader.closest('.data-set');
        if (parent) {
          parent.after(malSection);
        }
      } else {
        // Fallback: search for Average Score
        const avgScoreHeader = Array.from(sidebar.querySelectorAll('.type')).find(el => 
          el.textContent?.trim() === 'Average Score'
        );
        if (avgScoreHeader) {
          avgScoreHeader.closest('.data-set')?.after(malSection);
        }
      }
    }

    // 2. Subreddit Button in External Links
    const externalLinksWrap = document.querySelector('.external-links-wrap');
    if (externalLinksWrap && !externalLinksWrap.querySelector('a[href*="reddit.com"]')) {
      const redditUrl = info?.externalLinks?.find(l => l.url.includes('reddit.com'))?.url
        || `https://www.reddit.com/search/?q=${encodeURIComponent(title)}`;

      const redditBtn = document.createElement('a');
      redditBtn.href = redditUrl;
      redditBtn.target = '_blank';
      redditBtn.className = 'external-link au-reddit-btn';

      // Copy scoped CSS attributes from a sibling to inherit background/layout
      const sibling = externalLinksWrap.querySelector('.external-link');
      const dataAttr = sibling ? Array.from(sibling.attributes).find(a => a.name.startsWith('data-v-'))?.name : null;
      
      if (dataAttr) {
        redditBtn.setAttribute(dataAttr, '');
      }

      redditBtn.style.setProperty('--link-color', 'rgb(255, 69, 0)');

      const redditInner = html`
        <div style="display: contents;">
          <div class="icon-wrap" ${dataAttr ? dataAttr : ''} style="background: rgb(255, 69, 0); width: 25px; height: 25px; display: flex !important; align-items: center; justify-content: center; border-radius: 4px; flex-shrink: 0;">
            <i class="fab fa-reddit-alien" style="color: white; font-size: 16px;"></i>
          </div>
          <span class="name" ${dataAttr ? dataAttr : ''} style="font-size: 1.4rem; font-weight: 700; color: var(--color-text);">Reddit</span>
        </div>
      `;
      
      redditBtn.appendChild(redditInner);
      externalLinksWrap.appendChild(redditBtn);
    }
  }
}
