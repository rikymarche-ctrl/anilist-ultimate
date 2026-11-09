/**
 * @file AstraThemeRatingService.ts
 * @description Per-song opening/ending ratings for the media page and the progress popup.
 *
 * Ratings live in the account-scoped Astra repository (never in AniList notes). When the
 * user links a section to openings or endings, the song averages are copied into the
 * latest season's scores and saved through AstraService like any other Astra edit.
 */

import { inject, injectable, singleton } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type {
  IThemeRatingPrompt,
  ThemePromptSong,
  ThemeRatingAvailability,
} from '@core/interfaces/IThemeRatingPrompt';
import { AstraRepository } from '../store/AstraRepository';
import { AstraService } from '../AstraService';
import { themeAverages, type ThemeMediaRatings } from '../store/AstraThemeRatings';
import {
  applyLinkedThemeScores,
  linkedScoreKeys,
  songKindStates,
  songRatingsEnabled,
} from '../utils/AstraThemeScores';
import { readMusicThemeCache } from '@/modules/media/MediaMusicResponse';
import { MediaThemeLoader } from '@/modules/media/MediaThemeLoader';
import {
  findThemeValue,
  parseThemeSongs,
  themeTitleKey,
  themeStartEpisode,
  themesNewAt,
  type ThemeSong,
} from '@/modules/media/MediaThemeSongs';

@singleton()
@injectable()
export class AstraThemeRatingService implements IThemeRatingPrompt {
  constructor(
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(TOKENS.AstraService) private astra: AstraService,
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(MediaThemeLoader) private loader: Pick<MediaThemeLoader, 'load'>
  ) {}

  /** Off, or on with the kinds that have a section to fill (set in Astra settings). */
  public async availability(): Promise<ThemeRatingAvailability> {
    await this.astra.init();
    const sections = this.astra.getSections();
    const settings = this.astra.getSettings();
    return {
      enabled: songRatingsEnabled(settings, sections),
      kinds: songKindStates(settings, sections),
    };
  }

  public getRatings(mediaId: number): Promise<ThemeMediaRatings> {
    return this.repository.getThemeRatings(mediaId);
  }

  /** Score for a song, matched by id or (after a Jikan renumbering) by kind + title. */
  public scoreOf(ratings: ThemeMediaRatings, song: Pick<ThemeSong, 'id'>): number | null {
    return findThemeValue(ratings.ratings, song)?.score ?? null;
  }

  public async getScores(
    mediaId: number,
    songs: ThemePromptSong[]
  ): Promise<Record<string, number | null>> {
    const ratings = await this.repository.getThemeRatings(mediaId);
    return Object.fromEntries(songs.map((song) => [song.id, this.scoreOf(ratings, song)]));
  }

  public async rate(mediaId: number, song: ThemePromptSong, score: number | null): Promise<void> {
    await this.applyLinkedSections(mediaId, await this.saveSongScore(mediaId, song, score));
  }

  /** Saves only the song rating: the open rating form applies the mean to its own state. */
  public async saveSongScore(mediaId: number, song: ThemePromptSong, score: number | null): Promise<ThemeMediaRatings> {
    // A vote stored under a renumbered id moves to the current id, so it is never counted twice.
    const titleKey = themeTitleKey(song.id);
    const stale = Object.keys((await this.repository.getThemeRatings(mediaId)).ratings).filter(
      (id) => id !== song.id && themeTitleKey(id) === titleKey
    );
    for (const id of stale) await this.repository.saveThemeRating(mediaId, id, null);
    const ratings = await this.repository.saveThemeRating(
      mediaId,
      song.id,
      score === null
        ? null
        : { score: Math.round(score * 10) / 10, kind: song.kind, title: song.title }
    );
    return ratings;
  }

  /** Copies OP/ED means into linked sections of an existing Astra entry; never creates one. */
  public async applyLinkedSections(mediaId: number, ratings: ThemeMediaRatings): Promise<void> {
    await this.astra.init();
    const sections = this.astra.getSections();
    if (!songRatingsEnabled(this.astra.getSettings(), sections)) return;
    if (!linkedScoreKeys(sections).length) return;
    const work = await this.astra.getFullWork(mediaId);
    const latest = work?.seasons.length ? work.seasons.length - 1 : -1;
    if (!work || latest < 0) return;
    const scores = applyLinkedThemeScores(
      work.seasons[latest].scores,
      sections,
      themeAverages(ratings.ratings)
    );
    if (!scores) return;
    const seasons = work.seasons.map((season, index) =>
      index === latest ? { ...season, scores } : season
    );
    await this.astra.saveWork({ ...work, seasons });
  }

  /** Songs for the rating form: loaded from Jikan when no list is cached (not the progress hot path). */
  public async getSongs(mediaId: number): Promise<ThemePromptSong[] | null> {
    const themes = await this.loader.load(mediaId);
    return themes ? parseThemeSongs(themes, mediaId).map(({ id, kind, title, artist }) => ({ id, kind, title, artist })) : null;
  }


  public async findNewThemes(
    mediaId: number,
    previous: number,
    next: number
  ): Promise<ThemePromptSong[]> {
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !(next > previous)) return [];
    // Prompts only for kinds set up in the settings (linked or "Not counted"), with song ratings on.
    const { enabled, kinds } = await this.availability();
    const rated = (kind: 'OP' | 'ED') => kinds[kind] !== 'unset';
    if (!enabled || (!rated('OP') && !rated('ED'))) return [];
    const cached = readMusicThemeCache(
      await this.storage.get<unknown>(`music_themes_cache_${mediaId}`),
      mediaId,
      Date.now(),
      true
    );
    if (!cached) return [];
    // Every song stays in: the numbering check needs the whole list (see themesNewAt).
    const songs = parseThemeSongs(cached, mediaId);
    if (!songs.length) return [];
    const ratings = await this.repository.getThemeRatings(mediaId);
    const prompted = new Set(ratings.prompted ?? []);
    const fresh = themesNewAt(
      songs,
      previous,
      next,
      (song) => this.scoreOf(ratings, song) !== null,
      (song) => prompted.has(song.id)
    ).filter((song) => rated(song.kind));
    const unranged = fresh
      .filter((song) => themeStartEpisode(song) === null)
      .map((song) => song.id);
    if (unranged.length) {
      // Unranged songs are offered once; a failed write only means they may show again.
      void this.repository
        .markThemesPrompted(mediaId, unranged)
        .catch((error) =>
          logger.warn('[AstraThemeRating] Could not remember prompted songs', error)
        );
    }
    return fresh.map(({ id, kind, title, artist }) => ({
      id,
      kind,
      title,
      artist,
      counted: kinds[kind] === 'linked',
    }));
  }
}
