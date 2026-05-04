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
    const contentContainer = document.querySelector('.content.container');
    if (!contentContainer) return;

    this.mediaId = mediaId;
    const cacheKey = `music_themes_cache_${mediaId}`;
    
    try {
      const themes = await this.fetchJikanThemes(idMal);
      if (themes) {
        await localStorage.set(cacheKey, themes);
        this.renderThemes(themes);
      }
    } catch (error) {
      this.logger.debug('[MediaMusic] Manual render failed', error);
    }
  }

  private async renderMusicThemesInternal(): Promise<void> {
    if (this.isProcessing) return;

    const match = window.location.pathname.match(/\/anime\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[1], 10);
    
    // Check if we already injected in the main container
    const contentContainer = document.querySelector('.content.container');
    if (!contentContainer || (this.mediaId === mediaId && contentContainer.querySelector('.au-music-section'))) return;

    this.mediaId = mediaId;
    this.isProcessing = true;

    try {
      const cacheKey = `music_themes_cache_${mediaId}`;
      const cached = await localStorage.get<JikanThemeData>(cacheKey);

      if (cached) {
        this.renderThemes(cached);
      } else {
        const idMal = await this.fetchMalId(mediaId);
        if (idMal) {
          const themes = await this.fetchJikanThemes(idMal);
          if (themes) {
            await localStorage.set(cacheKey, themes);
            this.renderThemes(themes);
          }
        }
      }
    } catch (error) {
      this.logger.debug('[MediaMusic] Failed to process music themes', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async fetchMalId(mediaId: number): Promise<number | null> {
    const query = `query ($id: Int) { Media (id: $id) { idMal } }`;
    try {
      const data = await this.apiClient.query<any>(query, { id: mediaId });
      return data?.Media?.idMal || null;
    } catch {
      return null;
    }
  }

  private async fetchJikanThemes(idMal: number): Promise<JikanThemeData | null> {
    try {
      const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/themes`);
      const data = await response.json();
      return data?.data || null;
    } catch {
      return null;
    }
  }

  private renderThemes(themes: JikanThemeData): void {
    // We want to inject after "Staff" section or before "Status Distribution"
    const staffSection = Array.from(document.querySelectorAll('h2, .section-header')).find(el => 
      el.textContent?.trim().toLowerCase() === 'staff'
    );

    const anchor = staffSection ? staffSection.closest('.section') : document.querySelector('.status-distribution')?.closest('.section');
    if (!anchor) return;

    // Remove existing to avoid duplicates
    document.querySelectorAll('.au-music-section').forEach(el => el.remove());

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.marginTop = '30px';
    container.style.marginBottom = '30px';

    const createSection = (title: string, songs: string[]) => {
      if (songs.length === 0) return '';
      return `
        <div class="music-group" style="margin-bottom: 20px;">
          <h2 style="font-size: 1.4rem; font-weight: 500; color: var(--color-text-light); margin-bottom: 15px; border-bottom: 1px solid var(--color-background-100); padding-bottom: 8px;">${title}</h2>
          <div class="songs-list" style="display: flex; flex-direction: column; gap: 10px;">
            ${songs.map(song => {
              const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(song)}`;
              return `
                <div class="song-item" style="background: var(--color-background-100); padding: 12px 16px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; transition: transform 0.2s ease, background 0.2s ease;" onmouseover="this.style.background='var(--color-background-200)'; this.style.transform='translateX(4px)';" onmouseout="this.style.background='var(--color-background-100)'; this.style.transform='translateX(0)';">
                  <div class="song-info" style="font-size: 1.3rem; color: var(--color-text); line-height: 1.4;">
                    ${this.formatSong(song)}
                  </div>
                  <a href="${youtubeUrl}" target="_blank" title="Search on YouTube" style="color: #ff0000; font-size: 1.6rem; opacity: 0.7; transition: opacity 0.2s;" onmouseover="this.style.opacity='1';" onmouseout="this.style.opacity='0.7';">
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

    anchor.after(container);
  }

  private formatSong(song: string): string {
    // AniList/MAL usually format as "1: "Song Title" by Artist (eps 1-13)"
    // We can wrap the title in a span for better styling
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
