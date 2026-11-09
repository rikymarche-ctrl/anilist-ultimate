/**
 * @file MediaThemeSongs.ts
 * @description Pure parsing of Jikan theme strings into stable, rateable songs.
 *
 * Jikan lists themes as free text, for example
 *   `1: "Guren no Yumiya" by Linked Horizon (eps 1-13)`.
 * A song's id combines media, kind, sequence and normalised title, so a reordered
 * list never moves a vote; lookups also fall back to kind + title alone.
 */

import type { JikanThemeData } from './interfaces/IMediaMusicModule';

export type ThemeKind = 'OP' | 'ED';

export interface EpisodeRange {
  from: number;
  /** Inclusive end; null for an open range such as "eps 14-". */
  to: number | null;
}

export interface ThemeSong {
  id: string;
  kind: ThemeKind;
  sequence: number;
  title: string;
  artist: string;
  /** Empty when Jikan gives no episode information. */
  episodes: EpisodeRange[];
}

const MAX_EPISODE = 100000;
const MAX_TITLE_KEY = 80;

/** Lower-case ASCII key of a title, without diacritics, brackets or punctuation. */
export function normalizeThemeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_KEY);
}

export function themeSongId(
  mediaId: number,
  kind: ThemeKind,
  sequence: number,
  title: string
): string {
  return `${mediaId}:${kind}:${sequence}:${normalizeThemeTitle(title) || 'untitled'}`;
}

/** Kind + title part of an id: survives a sequence change in Jikan's list. */
export function themeTitleKey(id: string): string | null {
  const match = /^\d+:(OP|ED):\d+:(.+)$/.exec(id);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** Parses every "(eps 1-12, 14)" / "(ep 13)" / "(eps 14-)" group in a theme string. */
export function parseEpisodeRanges(song: string): EpisodeRange[] {
  const ranges: EpisodeRange[] = [];
  for (const group of song.matchAll(/\(\s*eps?\.?\s*([\d\s,\-–~]+)\)/gi)) {
    for (const part of group[1].split(',')) {
      const match = /^\s*(\d+)\s*(?:[-–~]\s*(\d*))?\s*$/.exec(part);
      if (!match) continue;
      const from = Number(match[1]);
      const hasDash = /[-–~]/.test(part);
      const to = !hasDash ? from : match[2] ? Number(match[2]) : null;
      if (from < 1 || from > MAX_EPISODE || (to !== null && (to < from || to > MAX_EPISODE)))
        continue;
      ranges.push({ from, to });
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

export function parseThemeSong(
  song: string,
  kind: ThemeKind,
  index: number,
  mediaId: number
): ThemeSong {
  const clean = song.replace(/https?:\/\/[^\s)]+/g, '').trim();
  const numbered = /^#?(\d+)\s*:\s*/.exec(clean);
  const sequence = numbered ? Number(numbered[1]) : index + 1;
  const rest = numbered ? clean.slice(numbered[0].length) : clean;
  const quoted = /"([^"]+)"/.exec(rest);
  const title = (quoted?.[1] ?? rest.split(/\s+by\s+/i)[0]).trim();
  const afterTitle = quoted
    ? rest.slice(quoted.index + quoted[0].length)
    : rest.slice(title.length);
  const artist = (/^\s*by\s+(.+?)\s*(?:\(\s*eps?\b.*)?$/i.exec(afterTitle)?.[1] ?? '').trim();
  return {
    id: themeSongId(mediaId, kind, sequence, title),
    kind,
    sequence,
    title,
    artist,
    episodes: parseEpisodeRanges(rest),
  };
}

export function parseThemeSongs(themes: JikanThemeData, mediaId: number): ThemeSong[] {
  return [
    ...themes.openings.map((song, index) => parseThemeSong(song, 'OP', index, mediaId)),
    ...themes.endings.map((song, index) => parseThemeSong(song, 'ED', index, mediaId)),
  ];
}

/** Finds a stored value by exact id, then by kind + title (Jikan renumbered the list). */
export function findThemeValue<T>(
  values: Record<string, T>,
  song: Pick<ThemeSong, 'id'>
): T | undefined {
  if (Object.prototype.hasOwnProperty.call(values, song.id)) return values[song.id];
  const key = themeTitleKey(song.id);
  const match = Object.keys(values).find((id) => themeTitleKey(id) === key);
  return match === undefined ? undefined : values[match];
}

/** First episode at which a song is heard, or null when Jikan gives no range. */
export function themeStartEpisode(song: ThemeSong): number | null {
  return song.episodes.length ? song.episodes[0].from : null;
}

/**
 * Songs that become new when progress moves from `previous` to `next`.
 * - Ranged songs: the first episode lies in (previous, next].
 * - Unranged songs: at episode 1, or at the first update where they were not prompted yet.
 * Rated songs are never returned.
 *
 * MyAnimeList often numbers a later season's songs from the whole series ("eps 26-37")
 * while AniList progress starts again at 1. When no song of the entry starts before
 * episode 3, every range is shifted so the earliest one starts at episode 1.
 */
export function themesNewAt(
  songs: ThemeSong[],
  previous: number,
  next: number,
  isRated: (song: ThemeSong) => boolean,
  wasPrompted: (song: ThemeSong) => boolean
): ThemeSong[] {
  if (
    !Number.isSafeInteger(previous) ||
    !Number.isSafeInteger(next) ||
    next <= previous ||
    next < 1
  )
    return [];
  const shift = absoluteNumberingShift(songs);
  return songs.filter((song) => {
    if (isRated(song)) return false;
    const raw = themeStartEpisode(song);
    const start = raw === null ? null : raw - shift;
    if (start !== null) return start > previous && start <= next;
    return previous < 1 || !wasPrompted(song);
  });
}

/** Episodes to subtract when the entry's songs use series-wide numbering (see themesNewAt). */
export function absoluteNumberingShift(songs: readonly ThemeSong[]): number {
  const starts = songs
    .map(themeStartEpisode)
    .filter((start): start is number => start !== null);
  if (!starts.length) return 0;
  const first = Math.min(...starts);
  return first > 2 ? first - 1 : 0;
}
