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
      this.logger.info(`[MediaMusic] Processing themes for anime ${mediaId}...`);
      const cacheKey = `music_themes_cache_${mediaId}`;
      const cached = await localStorage.get<JikanThemeData>(cacheKey);

      if (cached) {
        this.renderThemes(cached, overview);
      } else {
        const idMal = await this.fetchMalId(mediaId);
        if (idMal) {
          const themes = await this.fetchJikanThemes(idMal);
          if (themes) {
            await localStorage.set(cacheKey, themes);
            this.renderThemes(themes, overview);
          }
        }
      }
    } catch (error) {
      this.logger.error('[MediaMusic] Error processing themes', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async fetchMalId(mediaId: number): Promise<number | null> {
    const query = `query ($id: Int) { Media (id: $id) { idMal } }`;
    try {
      const data = await this.apiClient.query<any>(query, { id: mediaId });
      return data?.Media?.idMal || null;
    } catch (err) {
      return null;
    }
  }

  private async fetchJikanThemes(idMal: number): Promise<JikanThemeData | null> {
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/themes`);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.data || null;
    } catch (err) {
      return null;
    }
  }

  private renderThemes(themes: JikanThemeData, overview: Element): void {
    if (!themes.openings.length && !themes.endings.length) {
      this.logger.info('[MediaMusic] No themes found for this title.');
      return;
    }

    // Try to find a good spot inside overview
    const staff = overview.querySelector('.staff');
    const characters = overview.querySelector('.characters');
    const relations = overview.querySelector('.relations');

    // Remove existing
    overview.querySelectorAll('.au-music-section').forEach(el => el.remove());

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.marginTop = '40px';
    container.style.marginBottom = '40px';
    container.style.width = '100%';
    container.style.order = '5'; // Ensure it stays in a reasonable place if using flex

    const createSection = (title: string, songs: string[]) => {
      if (!songs || songs.length === 0) return '';
      return `
        <div class="music-group" style="margin-bottom: 30px;">
          <h2 style="font-size: 1.6rem; font-weight: 500; color: var(--color-text-light); margin-bottom: 20px; border-bottom: 1px solid var(--color-background-100); padding-bottom: 10px;">${title}</h2>
          <div class="songs-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
            ${songs.map(song => {
              const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(song)}`;
              return `
                <div class="song-item" style="background: var(--color-background-100); padding: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s ease;" onmouseover="this.style.background='var(--color-background-200)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';" onmouseout="this.style.background='var(--color-background-100)'; this.style.transform='translateY(0)'; this.style.boxShadow='none';">
                  <div class="song-info" style="font-size: 1.3rem; color: var(--color-text); line-height: 1.5; padding-right: 10px;">
                    ${this.formatSong(song)}
                  </div>
                  <a href="${youtubeUrl}" target="_blank" title="Search on YouTube" style="color: #ff0000; font-size: 1.8rem; opacity: 0.6; transition: all 0.2s; display: flex;" onmouseover="this.style.opacity='1'; this.style.transform='scale(1.1)';" onmouseout="this.style.opacity='0.6'; this.style.transform='scale(1)';" onclick="event.stopPropagation();">
                    <i class="fab fa-youtube"></i>
                  </a>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      ${createSection('Openings', themes.openings)}
      ${createSection('Endings', themes.endings)}
    `;

    // Strategic injection: after staff if exists, else after characters, else after relations
    const anchor = staff || characters || relations;
    if (anchor) {
      anchor.after(container);
    } else {
      overview.appendChild(container);
    }
  }

  private formatSong(song: string): string {
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
