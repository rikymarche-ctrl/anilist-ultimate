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
import { mutationsMatchSelector, type SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IMediaMusicModule, JikanThemeData } from './interfaces/IMediaMusicModule';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { escapeHtml } from '@core/utils/Template';
import { Sanitizer } from '@core/utils/Sanitizer';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { MUSIC_MAL_ID_QUERY, createMusicThemeCache, isMusicMediaId, parseJikanAnimeSearchId, parseJikanThemeResponse, parseMusicMediaLookup, readMusicThemeCache, readMusicThemeMalId } from './MediaMusicResponse';
import { findThemeVideo, musicSearchUrl, parseThemeVideoResponse } from './MediaThemeVideos';

@injectable()
export class MediaMusicModule extends BaseModule implements IMediaMusicModule {
  private mediaId: number | null = null;
  private isProcessing = false;
  private pageVersion = 0;
  private destroyed = false;
  /** Visit (page version) whose pipeline failed; a failed pipeline is not retried until navigation. */
  private failedVersion = -1;
  private readonly OBSERVER_NAME = 'media-music-injector';

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.Config) private config: IConfigManager,
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
      if (this.isAnimePage() && this.config.isFeatureEnabled('mediaMusic')) {
        this.startObservation();
      }
    };
    this.onPageChange(restart);
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, restart);

    if (this.isAnimePage() && this.config.isFeatureEnabled('mediaMusic')) {
      this.startObservation();
    }
  }

  public getName(): string {
    return 'mediaMusic';
  }

  private isAnimePage(): boolean {
    return getMediaRoute(window.location.pathname)?.type === 'ANIME';
  }

  private startObservation(): void {
    if (this.destroyed) return;
    const version = this.pageVersion;
    const processCurrent = () => {
      if (!this.destroyed && version === this.pageVersion) return this.renderMusicThemesInternal();
      return undefined;
    };
    void processCurrent();
    this.sharedObserver.register(this.OBSERVER_NAME, processCurrent, undefined,
      mutationsMatchSelector('.overview'));
  }

  private fullCleanup(): void {
    this.pageVersion++;
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    this.mediaId = null;
    this.isProcessing = false;
    document.querySelectorAll('.au-music-section').forEach(el => el.remove());
    document.querySelectorAll('[data-au-music]').forEach(el => el.removeAttribute('data-au-music'));
  }

  public override async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fullCleanup();
    await super.destroy();
  }

  public async renderMusicThemes(mediaId: number, idMal: number): Promise<void> {
    if (this.destroyed || !isMusicMediaId(mediaId) || !isMusicMediaId(idMal)) return;
    const overview = document.querySelector('.overview');
    if (!overview) return;
    const path = window.location.pathname;
    const route = getMediaRoute(path);
    if (route?.type !== 'ANIME' || route.id !== mediaId) return;
    const version = this.pageVersion;
    this.mediaId = mediaId;
    
    try {
      const context = await captureApiContext(this.apiClient);
      const isCurrent = () => !this.destroyed && version === this.pageVersion && window.location.pathname === path
        && overview.isConnected && document.querySelector('.overview') === overview;
      assertApiContext(this.apiClient, context);
      if (!isCurrent()) return;
      const themes = await this.fetchJikanThemes(idMal);
      assertApiContext(this.apiClient, context);
      if (themes && isCurrent() && (themes.openings.length || themes.endings.length)) {
        this.renderThemes(themes, overview, idMal);
      } else if (isCurrent()) {
        overview.setAttribute('data-au-music', String(mediaId));
      }
    } catch (e) {
      this.logger.error('[MediaMusic] Error in manual render', e);
    }
  }

  private async renderMusicThemesInternal(): Promise<void> {
    if (this.destroyed || this.isProcessing) return;

    const path = window.location.pathname;
    const route = getMediaRoute(path);
    if (route?.type !== 'ANIME') return;
    const mediaId = route.id;
    const overview = document.querySelector('.overview');
    if (!overview) return;

    if (this.mediaId === mediaId && overview.querySelector('.au-music-section')) return;
    if (overview.getAttribute('data-au-music') === String(mediaId)) return;
    const version = this.pageVersion;
    if (this.failedVersion === version) return;
    const isCurrent = () => !this.destroyed && version === this.pageVersion && window.location.pathname === path
      && overview.isConnected && document.querySelector('.overview') === overview;

    this.mediaId = mediaId;
    this.isProcessing = true;

    try {
      const context = await captureApiContext(this.apiClient);
      const assertCurrentAccount = () => assertApiContext(this.apiClient, context);
      assertCurrentAccount();
      if (!isCurrent()) return;
      const cacheKey = `music_themes_cache_${mediaId}`;
      const cached: unknown = await this.storage.get<unknown>(cacheKey);
      assertCurrentAccount();
      if (!isCurrent()) return;
      let themes = readMusicThemeCache(cached, mediaId);
      let idMal = readMusicThemeMalId(cached, mediaId);

      if (!themes) {
        const lookup = await this.fetchMusicLookup(mediaId);
        assertCurrentAccount();
        if (!isCurrent()) return;
        idMal = lookup.idMal;
        if (!idMal) {
          for (const title of lookup.titles) {
            idMal = await this.searchJikanId(title, lookup.titles);
            assertCurrentAccount();
            if (!isCurrent()) return;
            if (idMal) break;
          }
        }
        // A MAL-less or theme-less anime is a valid result: cache it briefly so revisits skip the lookup.
        themes = idMal ? await this.fetchJikanThemes(idMal) : { openings: [], endings: [] };
        assertCurrentAccount();
        if (!isCurrent()) return;
        if (!themes) {
          // Provider failure: never cached, and not retried until this page visit ends.
          this.failedVersion = version;
          return;
        }
        await this.storage.set(cacheKey, createMusicThemeCache(mediaId, themes, Date.now(), idMal));
        assertCurrentAccount();
      }

      if (!isCurrent()) return;
      if (themes && (themes.openings.length || themes.endings.length)) {
        this.renderThemes(themes, overview, idMal);
      } else {
        overview.setAttribute('data-au-music', String(mediaId));
      }
    } catch (error) {
      this.failedVersion = version;
      this.logger.error('[MediaMusic] Internal error', error);
    } finally {
      if (version === this.pageVersion) this.isProcessing = false;
    }
  }

  private async fetchMusicLookup(mediaId: number): Promise<{ idMal: number | null; titles: string[] }> {
    if (!isMusicMediaId(mediaId)) throw new Error('Invalid music media ID');
    const data = await this.apiClient.query<unknown>(MUSIC_MAL_ID_QUERY, { id: mediaId });
    return parseMusicMediaLookup(data, mediaId);
  }

  private async searchJikanId(title: string, expectedTitles: string[]): Promise<number | null> {
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: MSG.MEDIA_MUSIC_SEARCH, title });
      if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) {
        throw new Error('Jikan anime search failed');
      }
      return parseJikanAnimeSearchId(response.data, expectedTitles);
    } catch (error) {
      // Rethrow: a failed search is a provider failure, not "no MAL match", so the result must not be cached.
      this.logger.error('[MediaMusic] Jikan anime search unavailable', error);
      throw error;
    }
  }

  private async fetchJikanThemes(idMal: number): Promise<JikanThemeData | null> {
    if (!isMusicMediaId(idMal)) throw new Error('Invalid music MAL ID');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: MSG.MEDIA_MUSIC_THEMES, idMal });
      if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) {
        throw new Error('Jikan themes request failed');
      }
      return parseJikanThemeResponse(response.data);
    } catch (error) {
      this.logger.error('[MediaMusic] Jikan themes unavailable', error);
      return null;
    }
  }

  private renderThemes(themes: JikanThemeData, overview: Element, idMal: number | null): void {
    if (!themes.openings.length && !themes.endings.length) {
      overview.setAttribute('data-au-music', String(this.mediaId));
      return;
    }
    const staffSection = this.findSection(overview, 'Staff');
    const charactersSection = this.findSection(overview, 'Characters');
    
    const anchor = staffSection || charactersSection || overview.lastElementChild;
    const pos: 'before' | 'after' = staffSection ? 'before' : 'after';

    document.querySelectorAll('.au-music-section').forEach(e => e.remove());

    const container = document.createElement('div');
    container.className = 'au-music-section';
    container.style.cssText = `margin: 30px 0 !important; width: 100% !important;`;

    const build = (title: string, songs: string[], type: 'OP' | 'ED') => {
      if (!songs.length) return '';
      return `
        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 1.4rem; color: var(--color-text-light); margin-bottom: 15px;">${title}</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 10px;">
            ${songs.map((song, index) => {
              const ytUrl = musicSearchUrl(song);

              return `
                <div style="background: #151f2e; border-radius: 6px; display: flex; align-items: center; padding: 14px 18px; min-height: 65px;">
                  <div style="flex-grow: 1; font-size: 1.3rem; color: var(--color-text); padding-right: 20px; line-height: 1.5;">
                    ${this.formatSong(song.replace(/https?:\/\/[^\s)]+/, '').trim())}
                  </div>
                  <div style="display: flex; gap: 10px; align-items: center;">
                    <a data-au-music-type="${type}" data-au-song-index="${index}" href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener noreferrer" title="Search on YouTube" aria-label="Search on YouTube" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,0,0,0.1); display: flex; align-items: center; justify-content: center;">
                      <i class="fa-brands fa-youtube" style="color: #ff0000; font-size: 1.6rem;"></i>
                    </a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    container.innerHTML = build('Openings', themes.openings, 'OP') + build('Endings', themes.endings, 'ED');
    if (anchor) {
      if (pos === 'before') anchor.before(container);
      else anchor.after(container);
    } else overview.append(container);
    if (idMal !== null) void this.enrichVideoLinks(container, themes, idMal);
  }

  private async enrichVideoLinks(container: HTMLElement, themes: JikanThemeData, idMal: number): Promise<void> {
    const version = this.pageVersion;
    const path = window.location.pathname;
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: MSG.MEDIA_MUSIC_VIDEOS, idMal });
      if (this.destroyed || version !== this.pageVersion || path !== window.location.pathname || !container.isConnected) return;
      if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) return;
      const links = parseThemeVideoResponse(response.data, idMal);
      for (const search of container.querySelectorAll<HTMLAnchorElement>('a[data-au-song-index]')) {
        const type = search.dataset.auMusicType === 'OP' ? 'OP' : 'ED';
        const song = (type === 'OP' ? themes.openings : themes.endings)[Number(search.dataset.auSongIndex)];
        const url = song === undefined ? null : findThemeVideo(song, type, links);
        if (!url) continue;
        const play = document.createElement('a');
        play.href = url; play.target = '_blank'; play.rel = 'noopener noreferrer'; play.className = 'au-theme-video';
        play.title = 'Play on AnimeThemes'; play.setAttribute('aria-label', 'Play video on AnimeThemes in a new tab');
        play.textContent = '▶';
        play.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(61,180,242,0.15);color:rgb(61,180,242);display:flex;align-items:center;justify-content:center;font-size:14px;';
        search.before(play);
      }
    } catch (error) { this.logger.debug?.('[MediaMusic] Direct video unavailable', error); }
  }

  private findSection(overview: Element, text: string): Element | null {
    const headers = Array.from(overview.querySelectorAll('h2, .section-header'));
    const h = headers.find(h => h.textContent?.trim().toLowerCase() === text.toLowerCase());
    return h?.closest('.section') || h?.parentElement || null;
  }

  private formatSong(song: string): string {
    return Sanitizer.escape(song).replace(/"([^"]+)"/, '<span style="font-weight: 600; color: var(--color-blue);">$1</span>');
  }
}
