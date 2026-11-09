/**
 * @file MediaThemeLoader.ts
 * @description Loads an anime's opening/ending list on demand, outside the media page.
 *
 * Same pipeline and cache entry as MediaMusicModule (AniList MAL id → Jikan search fallback
 * → Jikan themes → `music_themes_cache_<id>`), so a list loaded here is reused by the media
 * page and by the progress popup. Concurrent requests for one anime share a single fetch.
 */

import { inject, injectable, singleton } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { MSG } from '@shared/messages';
import type { JikanThemeData } from './interfaces/IMediaMusicModule';
import {
  MUSIC_MAL_ID_QUERY,
  createMusicThemeCache,
  isMusicMediaId,
  parseJikanAnimeSearchId,
  parseJikanThemeResponse,
  parseMusicMediaLookup,
  readMusicThemeCache,
} from './MediaMusicResponse';

const cacheKey = (mediaId: number) => `music_themes_cache_${mediaId}`;

@singleton()
@injectable()
export class MediaThemeLoader {
  private inflight = new Map<number, Promise<JikanThemeData | null>>();

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {}

  /** Any cached list, even expired; never touches the network. */
  public async cached(mediaId: number): Promise<JikanThemeData | null> {
    if (!isMusicMediaId(mediaId)) return null;
    return readMusicThemeCache(
      await this.storage.get<unknown>(cacheKey(mediaId)),
      mediaId,
      Date.now(),
      true
    );
  }

  /** A fresh cached list, or a fetched one; falls back to an expired list when the providers fail. */
  public load(mediaId: number): Promise<JikanThemeData | null> {
    if (!isMusicMediaId(mediaId)) return Promise.resolve(null);
    let pending = this.inflight.get(mediaId);
    if (!pending) {
      pending = this.loadOnce(mediaId).finally(() => this.inflight.delete(mediaId));
      this.inflight.set(mediaId, pending);
    }
    return pending;
  }

  private async loadOnce(mediaId: number): Promise<JikanThemeData | null> {
    const stored = await this.storage.get<unknown>(cacheKey(mediaId));
    const fresh = readMusicThemeCache(stored, mediaId);
    if (fresh) return fresh;
    try {
      const lookup = parseMusicMediaLookup(
        await this.api.query<unknown>(MUSIC_MAL_ID_QUERY, { id: mediaId }),
        mediaId
      );
      let idMal = lookup.idMal;
      for (const title of idMal ? [] : lookup.titles) {
        idMal = parseJikanAnimeSearchId(
          await this.send(MSG.MEDIA_MUSIC_SEARCH, { title }),
          lookup.titles
        );
        if (idMal) break;
      }
      const themes = idMal
        ? parseJikanThemeResponse(await this.send(MSG.MEDIA_MUSIC_THEMES, { idMal }))
        : { openings: [], endings: [] };
      await this.storage.set(
        cacheKey(mediaId),
        createMusicThemeCache(mediaId, themes, Date.now(), idMal)
      );
      return themes;
    } catch (error) {
      logger.warn('[MediaThemeLoader] Theme list unavailable', error);
      return readMusicThemeCache(stored, mediaId, Date.now(), true);
    }
  }

  private async send(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ type, ...payload });
    if (
      !response ||
      typeof response !== 'object' ||
      !('success' in response) ||
      response.success !== true ||
      !('data' in response)
    )
      throw new Error('Theme provider request failed');
    return response.data;
  }
}
