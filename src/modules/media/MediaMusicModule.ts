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
    
    const overview = document.querySelector('.overview');
    if (!overview) return;

    if (this.mediaId === mediaId && overview.querySelector('.au-music-section')) return;

    this.mediaId = mediaId;
    this.isProcessing = true;

    try {
      this.logger.info(`[MediaMusic] 🔍 Processing themes for anime ${mediaId}...`);
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/themes`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.data || null;
    } catch (err) {
      return null;
    }
  }

  private renderThemes(themes: JikanThemeData, overview: Element): void {
    if (!themes.openings.length && !themes.endings.length) return;

    const headers = Array.from(overview.querySelectorAll('h2, .section-header'));
    const staffHeader = headers.find(h => h.textContent?.trim().toLowerCase() === 'staff');
    const charactersHeader = headers.find(h => h.textContent?.trim().toLowerCase() === 'characters');
    const relationsHeader = headers.find(h => h.textContent?.trim().toLowerCase() === 'relations');

    const staffSection = staffHeader?.closest('.section') || staffHeader?.parentElement;
    const charactersSection = charactersHeader?.closest('.section') || charactersHeader?.parentElement;
    const relationsSection = relationsHeader?.closest('.section') || relationsHeader?.parentElement;

    const existing = document.querySelector('.au-music-section');
    
    let idealAnchor: Element | null = null;
    let position: 'before' | 'after' = 'after';

    if (staffSection) {
      idealAnchor = staffSection;
      position = 'before';
    } else if (charactersSection) {
      idealAnchor = charactersSection;
      position = 'after';
    } else if (relationsSection) {
      idealAnchor = relationsSection;
      position = 'after';
    }

    // Force fresh render to apply new styles/content
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.cssText = `
      margin: 30px 0 !important;
      width: 100% !important;
      display: block !important;
      position: relative !important;
    `;

    const createSection = (title: string, songs: string[]) => {
      if (!songs || songs.length === 0) return '';
      return `
        <div class="music-group" style="margin-bottom: 30px !important;">
          <h2 style="font-size: 1.4rem !important; font-weight: 500 !important; color: var(--color-text-light) !important; margin-bottom: 15px !important; padding-bottom: 8px !important;">${title}</h2>
          <div class="songs-list" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)) !important; gap: 10px !important;">
            ${songs.map(song => {
              const urlMatch = song.match(/https?:\/\/[^\s)]+/);
              const directUrl = urlMatch ? urlMatch[0] : null;
              const cleanSong = song.replace(/https?:\/\/[^\s)]+/, '').replace(/"/g, '').trim();
              
              const ytUrl = directUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanSong + ' official')}`;
              const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(cleanSong)}`;
              const appleUrl = `https://music.apple.com/search?term=${encodeURIComponent(cleanSong)}`;

              return `
                <div class="song-item" style="background: var(--color-background-100) !important; border-radius: 4px !important; display: flex !important; align-items: center !important; padding: 12px 16px !important; transition: background 0.2s !important; min-height: 60px !important;">
                  <div class="song-info" style="flex-grow: 1 !important; font-size: 1.3rem !important; color: var(--color-text) !important; padding-right: 15px !important;">
                    ${this.formatSong(song.replace(/https?:\/\/[^\s)]+/, '').trim())}
                  </div>
                  <div class="song-actions" style="display: flex !important; gap: 8px !important; flex-shrink: 0 !important;">
                    <a href="${ytUrl}" target="_blank" title="YouTube" style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255,0,0,0.1); display: flex; align-items: center; justify-content: center; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                      <i class="fab fa-youtube" style="color: #ff0000; font-size: 1.4rem;"></i>
                    </a>
                    <a href="${spotifyUrl}" target="_blank" title="Spotify" style="width: 28px; height: 28px; border-radius: 50%; background: rgba(30,215,96,0.1); display: flex; align-items: center; justify-content: center; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                      <i class="fab fa-spotify" style="color: #1ed760; font-size: 1.4rem;"></i>
                    </a>
                    <a href="${appleUrl}" target="_blank" title="Apple Music" style="width: 28px; height: 28px; border-radius: 50%; background: rgba(252,60,68,0.1); display: flex; align-items: center; justify-content: center; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                      <i class="fab fa-apple" style="color: #fc3c44; font-size: 1.4rem;"></i>
                    </a>
                  </div>
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

    if (idealAnchor) {
      if (position === 'before') {
        idealAnchor.before(container);
      } else {
        idealAnchor.after(container);
      }
    } else {
      overview.appendChild(container);
    }
    
    this.logger.info('[MediaMusic] ✅ Successfully Positioned');
  }

  private formatSong(song: string): string {
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
