/**
 * @file MediaMusicModule.ts
 * @description Injects anime opening and ending themes into media pages
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { localStorage } from '@core/storage/StorageManager';
import type { IMediaMusicModule, JikanThemeData } from './interfaces/IMediaMusicModule';

@injectable()
export class MediaMusicModule extends BaseModule implements IMediaMusicModule {
  private mediaId: number | null = null;
  private isProcessing = false;
  private readonly OBSERVER_NAME = 'media-music-injector';

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
      if (this.isAnimePage()) {
        this.startObservation();
      }
    });

    if (this.isAnimePage()) {
      this.startObservation();
    }
  }

  public getName(): string {
    return 'mediaMusic';
  }

  private isAnimePage(): boolean {
    return /^\/anime\/\d+/.test(window.location.pathname);
  }

  private startObservation(): void {
    this.renderMusicThemesInternal();
    this.sharedObserver.register(this.OBSERVER_NAME, () => {
      this.renderMusicThemesInternal();
    });
  }

  private fullCleanup(): void {
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    this.mediaId = null;
    this.isProcessing = false;
    document.querySelectorAll('.au-music-section').forEach(el => el.remove());
  }

  public async renderMusicThemes(mediaId: number, idMal: number): Promise<void> {
    const overview = document.querySelector('.overview');
    if (!overview) return;

    this.mediaId = mediaId;
    const themes = await this.fetchJikanThemes(idMal);
    if (themes) {
      this.renderThemes(themes, overview);
    }
  }

  private async renderMusicThemesInternal(): Promise<void> {
    if (this.isProcessing) return;

    const match = window.location.pathname.match(/\/anime\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[1], 10);
    
    // Look for the overview container (main body of media page)
    const overview = document.querySelector('.overview');
    if (!overview) {
      // If overview isn't ready, the observer will call us again later
      return;
    }

    // Prevent duplicates
    if (this.mediaId === mediaId && overview.querySelector('.au-music-section')) return;

    this.mediaId = mediaId;
    this.isProcessing = true;

    try {
      this.logger.info(`[MediaMusic] 🔍 Processing themes for anime ${mediaId}...`);
      const cacheKey = `music_themes_cache_${mediaId}`;
      const cached = await localStorage.get<JikanThemeData>(cacheKey);

      if (cached) {
        this.logger.info(`[MediaMusic] 📦 Found cached themes for ${mediaId}`);
        this.renderThemes(cached, overview);
      } else {
        this.logger.info(`[MediaMusic] 🛰️ Fetching MAL ID for ${mediaId}...`);
        const idMal = await this.fetchMalId(mediaId);
        
        if (idMal) {
          this.logger.info(`[MediaMusic] ✅ Found MAL ID: ${idMal}. Fetching themes from Jikan...`);
          const themes = await this.fetchJikanThemes(idMal);
          
          if (themes) {
            this.logger.info(`[MediaMusic] 🎵 Themes fetched successfully. Rendering...`);
            await localStorage.set(cacheKey, themes);
            this.renderThemes(themes, overview);
          } else {
            this.logger.warn(`[MediaMusic] ⚠️ No themes returned from Jikan for MAL ${idMal}`);
          }
        } else {
          this.logger.warn(`[MediaMusic] ❌ Could not find MAL ID for anime ${mediaId}`);
        }
      }
    } catch (error) {
      this.logger.error('[MediaMusic] 🛑 Error processing themes', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async fetchMalId(mediaId: number): Promise<number | null> {
    const query = `query ($id: Int) { Media (id: $id) { idMal } }`;
    try {
      const data = await this.apiClient.query<any>(query, { id: mediaId });
      const idMal = data?.Media?.idMal;
      return idMal || null;
    } catch (err) {
      this.logger.error(`[MediaMusic] 💥 GraphQL query failed for ${mediaId}`, err);
      return null;
    }
  }

  private async fetchJikanThemes(idMal: number): Promise<JikanThemeData | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
      
      const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/themes`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        this.logger.error(`[MediaMusic] Jikan API returned status ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      return data?.data || null;
    } catch (err) {
      this.logger.error(`[MediaMusic] Jikan fetch failed or timed out`, err);
      return null;
    }
  }

  private renderThemes(themes: JikanThemeData, overview: Element): void {
    if (!themes.openings.length && !themes.endings.length) {
      this.logger.info('[MediaMusic] No themes found for this title.');
      return;
    }

    // Use the very beginning of the overview as a more stable point
    const anchor = overview.firstChild;

    // Cleanup ONLY if it's a different media or we explicitly want to refresh
    const existing = document.querySelector('.au-music-section');
    if (existing) {
       // If it already exists in the right place, don't touch it to avoid flicker
       return;
    }

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.cssText = `
      margin: 40px 0 !important;
      padding: 20px !important;
      width: 100% !important;
      display: block !important;
      background: rgba(255, 0, 0, 0.05) !important;
      border: 2px solid #ff0000 !important; /* DEBUG BORDER */
      min-height: 100px !important;
      position: relative !important;
      z-index: 9999 !important;
    `;

    const createSection = (title: string, songs: string[]) => {
      if (!songs || songs.length === 0) return '';
      return `
        <div class="music-group" style="margin-bottom: 30px !important;">
          <h2 style="font-size: 1.6rem !important; font-weight: 500 !important; color: var(--color-text-light) !important; margin-bottom: 20px !important; border-bottom: 1px solid var(--color-background-100) !important; padding-bottom: 10px !important;">${title}</h2>
          <div class="songs-list" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important; gap: 15px !important;">
            ${songs.map(song => {
              const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(song)}`;
              return `
                <div class="song-item" style="background: var(--color-background-100) !important; padding: 16px !important; border-radius: 8px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; cursor: pointer !important;" onclick="window.open('${youtubeUrl}', '_blank')">
                  <div class="song-info" style="font-size: 1.3rem !important; color: var(--color-text) !important;">
                    ${this.formatSong(song)}
                  </div>
                  <i class="fab fa-youtube" style="color: #ff0000; font-size: 1.8rem;"></i>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div style="color: #ff0000; font-weight: bold; margin-bottom: 10px;">ASTRA MUSIC MODULE ACTIVE</div>
      ${createSection('Openings', themes.openings)}
      ${createSection('Endings', themes.endings)}
    `;

    if (anchor) {
      overview.insertBefore(container, anchor);
    } else {
      overview.appendChild(container);
    }
    this.logger.info('[MediaMusic] 🚩 Injected at the top of overview');
  }

  private formatSong(song: string): string {
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
