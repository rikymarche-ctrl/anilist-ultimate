import { isRecord } from '@/api/GraphQLResponse';
import type { JikanThemeData } from './interfaces/IMediaMusicModule';

export const MUSIC_MAL_ID_QUERY = `query ($id: Int!) { Media(id: $id, type: ANIME) { id type idMal title { english romaji native } } }`;
export const MUSIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Empty results (no themes, or no MAL match) expire sooner so later theme additions are picked up. */
export const MUSIC_EMPTY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Third-party theme JSON is capped: at most this many songs per list, each text field this long. */
export const MAX_THEME_SONGS = 50;
export const MAX_THEME_TEXT = 300;

export interface MusicMediaLookup {
  idMal: number | null;
  titles: string[];
}

export function isMusicMediaId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

/** Only an identified anime with an explicitly null MAL ID is MAL-less. */
export function parseMusicMalId(response: unknown, mediaId: number): number | null {
  if (!isMusicMediaId(mediaId) || !isRecord(response) || !isRecord(response.Media)
    || response.Media.id !== mediaId || response.Media.type !== 'ANIME'
    || (response.Media.idMal !== null && !isMusicMediaId(response.Media.idMal))) {
    throw new Error('Invalid music media response');
  }
  return response.Media.idMal;
}

/** Extract exact AniList title variants for a safe Jikan title-search fallback. */
export function parseMusicMediaLookup(response: unknown, mediaId: number): MusicMediaLookup {
  if (!isRecord(response) || !isRecord(response.Media) || !isRecord(response.Media.title)) {
    throw new Error('Invalid music media response');
  }
  const idMal = parseMusicMalId(response, mediaId);
  const title = response.Media.title;
  const values = [title.english, title.romaji, title.native];
  if (values.some(value => value !== null && typeof value !== 'string')) throw new Error('Invalid music media response');
  const titles = [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  return { idMal, titles };
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Resolve a Jikan search only when one result has an exact title-variant match. */
export function parseJikanAnimeSearchId(response: unknown, expectedTitles: string[]): number | null {
  if (!isRecord(response) || !Array.isArray(response.data)) throw new Error('Invalid Jikan anime search response');
  const expected = new Set(expectedTitles.map(normalizeTitle).filter(Boolean));
  if (!expected.size) return null;
  const matches = new Set<number>();
  for (const result of response.data) {
    if (!isRecord(result) || !isMusicMediaId(result.malId)) continue;
    const titles = [result.title, result.titleEnglish, result.titleJapanese,
      ...(Array.isArray(result.titleSynonyms) ? result.titleSynonyms : [])];
    if (titles.some(title => typeof title === 'string' && expected.has(normalizeTitle(title)))) matches.add(result.malId);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function boundedText(value: string): string {
  return Array.from(value).slice(0, MAX_THEME_TEXT).join('');
}

function parseSongs(value: unknown): string[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('Invalid Jikan theme response');
  return Array.from(value.slice(0, MAX_THEME_SONGS), song => {
    if (typeof song !== 'string') throw new Error('Invalid Jikan theme response');
    return boundedText(song);
  });
}

/** Nullable arrays are empty; omitted fields and malformed elements are failures. */
export function parseJikanThemes(value: unknown): JikanThemeData {
  if (!isRecord(value)) throw new Error('Invalid Jikan theme response');
  return { openings: parseSongs(value.openings), endings: parseSongs(value.endings) };
}

export function parseJikanThemeResponse(response: unknown): JikanThemeData {
  if (!isRecord(response) || !isRecord(response.data)) throw new Error('Invalid Jikan theme response');
  const songs = (value: unknown): string[] => {
    if (value === null) return [];
    if (!Array.isArray(value)) throw new Error('Invalid Jikan theme response');
    return Array.from(value.slice(0, MAX_THEME_SONGS), song => {
      // Retain support for the original string representation alongside Edge's objects.
      if (typeof song === 'string') return boundedText(song);
      if (!isRecord(song) || typeof song.title !== 'string' || !song.title.trim()
        || (song.artist !== null && typeof song.artist !== 'string')
        || (song.episodes !== null && typeof song.episodes !== 'string')) throw new Error('Invalid Jikan theme response');
      const artist = song.artist ? boundedText(song.artist) : '';
      const episodes = song.episodes ? boundedText(song.episodes) : '';
      return `"${boundedText(song.title)}"${artist ? ` by ${artist}` : ''}${episodes ? ` (${episodes})` : ''}`;
    });
  };
  return { openings: songs(response.data.openings), endings: songs(response.data.endings) };
}

interface MusicThemeCacheEntry {
  version: 3;
  mediaId: number;
  idMal: number | null;
  type: 'ANIME';
  cachedAt: number;
  themes: JikanThemeData;
}

/** Theme titles are public metadata shared by media ID, with a one-day expiry. */
export function createMusicThemeCache(mediaId: number, themes: JikanThemeData, now = Date.now(), idMal: number | null = null): MusicThemeCacheEntry {
  if (!isMusicMediaId(mediaId) || !Number.isSafeInteger(now) || now < 0 || (idMal !== null && !isMusicMediaId(idMal))) throw new Error('Invalid music cache identity');
  return { version: 3, mediaId, idMal, type: 'ANIME', cachedAt: now, themes: parseJikanThemes(themes) };
}

export function hasMusicThemes(themes: JikanThemeData): boolean {
  return themes.openings.length > 0 || themes.endings.length > 0;
}

export function readMusicThemeCache(value: unknown, mediaId: number, now = Date.now()): JikanThemeData | null {
  // Older entries lack the MAL identity needed for direct video lookup.
  if (!isMusicMediaId(mediaId) || !Number.isSafeInteger(now) || now < 0 || !isRecord(value) || value.version !== 3 || value.mediaId !== mediaId || value.type !== 'ANIME'
    || (value.idMal !== null && !isMusicMediaId(value.idMal))
    || typeof value.cachedAt !== 'number' || !Number.isSafeInteger(value.cachedAt) || value.cachedAt < 0
    || value.cachedAt > now) return null;
  try {
    const themes = parseJikanThemes(value.themes);
    const ttl = hasMusicThemes(themes) ? MUSIC_CACHE_TTL_MS : MUSIC_EMPTY_CACHE_TTL_MS;
    return now - value.cachedAt >= ttl ? null : themes;
  } catch { return null; }
}

export function readMusicThemeMalId(value: unknown, mediaId: number): number | null {
  return readMusicThemeCache(value, mediaId) && isRecord(value) && isMusicMediaId(value.idMal) ? value.idMal : null;
}
