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
import type { IConfigManager } from '@core/interfaces/IConfigManager';
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
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    this.onPageChange(() => {
      this.fullCleanup();
      if (this.isAnimePage() && this.config.isFeatureEnabled('mediaMusic')) {
        this.startObservation();
      }
    });

    if (this.isAnimePage() && this.config.isFeatureEnabled('mediaMusic')) {
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
    
    try {
      const themes = await this.fetchJikanThemes(idMal);
      if (themes) this.renderThemes(themes, overview);
    } catch (e) {
      this.logger.error('[MediaMusic] Error in manual render', e);
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
      const cacheKey = `music_themes_cache_${mediaId}`;
      let themes = await localStorage.get<JikanThemeData>(cacheKey);

      if (!themes) {
        const idMal = await this.fetchMalId(mediaId) || 0;
        if (idMal) {
          themes = await this.fetchJikanThemes(idMal);
          if (themes) await localStorage.set(cacheKey, themes);
        }
      }

      if (themes) {
        this.renderThemes(themes, overview);
      }
    } catch (error) {
      this.logger.error('[MediaMusic] Internal error', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async fetchMalId(mediaId: number): Promise<number | null> {
    const query = `query ($id: Int) { Media (id: $id) { idMal } }`;
    try {
      const data = await this.apiClient.query<any>(query, { id: mediaId });
      return data?.Media?.idMal || null;
    } catch (err) { return null; }
  }

  private async fetchJikanThemes(idMal: number): Promise<JikanThemeData | null> {
    try {
      const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/themes`);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.data || null;
    } catch (err) { return null; }
  }

  private renderThemes(themes: JikanThemeData, overview: Element): void {
    const staffSection = this.findSection(overview, 'Staff');
    const charactersSection = this.findSection(overview, 'Characters');
    
    let anchor = staffSection || charactersSection || overview.lastElementChild;
    let pos: 'before' | 'after' = staffSection ? 'before' : 'after';

    document.querySelectorAll('.au-music-section').forEach(e => e.remove());

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.cssText = `margin: 30px 0 !important; width: 100% !important;`;

    const build = (title: string, songs: string[]) => {
      if (!songs.length) return '';
      return `
        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 1.4rem; color: var(--color-text-light); margin-bottom: 15px;">${title}</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 10px;">
            ${songs.map(song => {
              const urlMatch = song.match(/https?:\/\/[^\s)]+/);
              const directUrl = urlMatch ? urlMatch[0] : null;
              
              const clean = song.replace(/^\d+:\s*/, '').replace(/\(eps\s*[\d-]+\)/gi, '').replace(/https?:\/\/[^\s)]+/g, '').replace(/by/gi, '').replace(/[":]/g, '').trim();
              const ytUrl = directUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(clean + ' official')}`;

              return `
                <div style="background: #151f2e; border-radius: 6px; display: flex; align-items: center; padding: 14px 18px; min-height: 65px;">
                  <div style="flex-grow: 1; font-size: 1.3rem; color: var(--color-text); padding-right: 20px; line-height: 1.5;">
                    ${this.formatSong(song.replace(/https?:\/\/[^\s)]+/, '').trim())}
                  </div>
                  <div style="display: flex; gap: 10px; align-items: center;">
                    <a href="${ytUrl}" target="_blank" title="Watch on YouTube" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,0,0,0.1); display: flex; align-items: center; justify-content: center; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
                      <i class="fab fa-youtube" style="color: #ff0000; font-size: 1.6rem;"></i>
                    </a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    container.innerHTML = build('Openings', themes.openings) + build('Endings', themes.endings);
    if (anchor) {
      if (pos === 'before') anchor.before(container);
      else anchor.after(container);
    }
  }

  private findSection(overview: Element, text: string): Element | null {
    const headers = Array.from(overview.querySelectorAll('h2, .section-header'));
    const h = headers.find(h => h.textContent?.trim().toLowerCase() === text.toLowerCase());
    return h?.closest('.section') || h?.parentElement || null;
  }

  private formatSong(song: string): string {
    return song.replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
