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
    this.isProcessing = false;
    document.querySelectorAll('.au-music-section').forEach(el => el.remove());
  }

  public async renderMusicThemes(idMal: number): Promise<void> {
    const overview = document.querySelector('.overview');
    if (!overview) return;

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
      return;
    }

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
    if (!themes.openings.length && !themes.endings.length) {
      this.logger.info('[MediaMusic] No themes found for this title.');
      return;
    }

    const staff = overview.querySelector('.staff');
    const characters = overview.querySelector('.characters');
    const relations = overview.querySelector('.relations');

    const existing = document.querySelector('.au-music-section');
    
    let idealAnchor: Element | null = null;
    let position: 'before' | 'after' = 'after';

    if (staff) {
      idealAnchor = staff;
      position = 'before';
    } else if (characters) {
      idealAnchor = characters;
      position = 'after';
    } else if (relations) {
      idealAnchor = relations;
      position = 'after';
    }

    if (existing && idealAnchor) {
      const isCorrectPosition = position === 'before' ? 
                                 existing.nextElementSibling === idealAnchor : 
                                 idealAnchor.nextElementSibling === existing;
      if (isCorrectPosition) return;
    }

    if (existing) existing.remove();

    this.logger.info(`[MediaMusic] 🎨 Rendering ${themes.openings.length} OPs and ${themes.endings.length} EDs...`);

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.cssText = `
      margin: 30px 0 !important;
      width: 100% !important;
      display: block !important;
      min-height: 50px !important;
      position: relative !important;
    `;

    const createSection = (title: string, songs: string[]) => {
      if (!songs || songs.length === 0) return '';
      return `
        <div class="music-group" style="margin-bottom: 35px !important;">
          <h2 style="font-size: 1.6rem !important; font-weight: 500 !important; color: var(--color-text-light) !important; margin-bottom: 20px !important; border-bottom: 1px solid var(--color-background-100) !important; padding-bottom: 10px !important;">${title}</h2>
          <div class="songs-list" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)) !important; gap: 15px !important;">
            ${songs.map(song => {
              const urlMatch = song.match(/https?:\/\/[^\s)]+/);
              const directUrl = urlMatch ? urlMatch[0] : null;
              const cleanSong = song.replace(/https?:\/\/[^\s)]+/, '').trim();
              const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanSong + ' official')}`;
              const finalUrl = directUrl || searchUrl;

              return `
                <div class="song-item" style="background: var(--color-background-100) !important; padding: 14px 18px !important; border-radius: 8px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; transition: all 0.2s ease !important; cursor: pointer !important;" onmouseover="this.style.background='var(--color-background-200)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';" onmouseout="this.style.background='var(--color-background-100)'; this.style.transform='translateY(0)'; this.style.boxShadow='none';" onclick="window.open('${finalUrl}', '_blank')">
                  <div class="song-info" style="font-size: 1.3rem !important; color: var(--color-text) !important; line-height: 1.4 !important;">
                    ${this.formatSong(cleanSong)}
                  </div>
                  <i class="${directUrl ? 'fas fa-external-link-alt' : 'fab fa-youtube'}" style="color: ${directUrl ? 'var(--color-blue)' : '#ff0000'}; font-size: 1.8rem; opacity: 0.7;"></i>
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
    
    this.logger.info('[MediaMusic] ✅ Injection completed');
  }

  private formatSong(song: string): string {
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
