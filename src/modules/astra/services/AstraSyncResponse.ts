import { MediaListStatus } from '@/api/AnilistTypes';
import type { AniListDate, MediaFormat, MediaType } from '@/api/AnilistTypes';
import { isRecord } from '@/api/GraphQLResponse';
import { readAstraDate } from '../utils/AstraDates';
import { isSyncId } from '@core/services/SyncResponse';

export interface AstraSyncEntry {
  id: number; userId: number; mediaId: number; status: MediaListStatus;
  score: number; progress: number; notes: string;
  startedAt: AniListDate | null; completedAt: AniListDate | null;
  customLists: Record<string, boolean>; private: boolean; hiddenFromStatusLists: boolean;
  media: {
    id: number; type: MediaType; format: MediaFormat | null; countryOfOrigin: string | null;
    title: { romaji: string | null; english: string | null; native: string | null };
    coverImage: { extraLarge: string | null; large: string | null; medium: string | null };
    genres: string[]; episodes: number | null; chapters: number | null; duration: number | null;
  };
}

const statuses = [MediaListStatus.CURRENT, MediaListStatus.PLANNING, MediaListStatus.COMPLETED,
  MediaListStatus.DROPPED, MediaListStatus.PAUSED, MediaListStatus.REPEATING];
const formats: MediaFormat[] = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA', 'NOVEL', 'ONE_SHOT'];
function invalid(): never { throw new Error('Invalid AniList Astra collection response'); }
function date(value: unknown): AniListDate | null {
  try { return readAstraDate(value, true); } catch { return invalid(); }
}
function text(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') invalid();
  return value;
}
function integer(value: unknown): number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647)) invalid();
  return value as number | null;
}
function boolean(value: unknown): boolean {
  if (value === null) return false;
  if (typeof value !== 'boolean') invalid();
  return value;
}
function customLists(value: unknown): Record<string, boolean> {
  if (value === null) return {};
  if (!isRecord(value) || Object.values(value).some(enabled => typeof enabled !== 'boolean')) invalid();
  // Own data properties preserve list names such as __proto__; sorted keys also
  // make coherent duplicate rows independent of JSON object property order.
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) as Record<string, boolean>;
}
function entry(value: unknown, owner: number, type: MediaType): AstraSyncEntry {
  if (!isRecord(value) || !isSyncId(value.id) || !isSyncId(value.mediaId) || value.userId !== owner) invalid();
  const status = value.status === null ? MediaListStatus.PLANNING : statuses.find(item => item === value.status);
  if (!status) invalid();
  if (value.score !== null && (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 10)) invalid();
  const media = value.media;
  if (!isRecord(media) || media.id !== value.mediaId || media.type !== type) invalid();
  const format = media.format === null ? null : formats.find(item => item === media.format);
  if (format === undefined) invalid();
  const title = media.title === null ? { romaji: null, english: null, native: null } : media.title;
  const cover = media.coverImage === null ? { extraLarge: null, large: null, medium: null } : media.coverImage;
  if (!isRecord(title) || !isRecord(cover)) invalid();
  const genres = media.genres === null ? [] : media.genres;
  if (!Array.isArray(genres) || genres.some(item => item !== null && typeof item !== 'string')) invalid();
  return {
    id: value.id, userId: owner, mediaId: value.mediaId, status,
    score: value.score === null ? 0 : value.score as number, progress: integer(value.progress) ?? 0,
    startedAt: date(value.startedAt), completedAt: date(value.completedAt),
    notes: text(value.notes) ?? '', customLists: customLists(value.customLists),
    private: boolean(value.private), hiddenFromStatusLists: boolean(value.hiddenFromStatusLists),
    media: { id: value.mediaId, type, format, countryOfOrigin: text(media.countryOfOrigin),
      title: { romaji: text(title.romaji), english: text(title.english), native: text(title.native) },
      coverImage: { extraLarge: text(cover.extraLarge), large: text(cover.large), medium: text(cover.medium) },
      genres: genres.filter((item): item is string => typeof item === 'string'),
      episodes: integer(media.episodes), chapters: integer(media.chapters), duration: integer(media.duration) },
  };
}

/** Validate and detach the entire requested collection before import starts.
 * Missing selections are failures; only explicitly returned schema nulls normalize.
 * A null row/media cannot prove identity, so the whole import remains uncommitted.
 */
export function astraSyncCollection(value: unknown, owner: number, type: MediaType): { entries: AstraSyncEntry[]; hasNextChunk: boolean } {
  if (!isSyncId(owner) || !['ANIME', 'MANGA'].includes(type) || !isRecord(value) || !isRecord(value.MediaListCollection)) invalid();
  const collection = value.MediaListCollection;
  if (!isRecord(collection.user) || collection.user.id !== owner) invalid();
  if (collection.hasNextChunk !== null && typeof collection.hasNextChunk !== 'boolean') invalid();
  if (collection.lists !== null && !Array.isArray(collection.lists)) invalid();
  const entries = new Map<number, AstraSyncEntry>();
  const ids = new Set<number>();
  for (const list of collection.lists ?? []) {
    if (!isRecord(list) || (list.entries !== null && !Array.isArray(list.entries))) invalid();
    for (const row of list.entries ?? []) {
      const next = entry(row, owner, type);
      const previous = entries.get(next.mediaId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(next)) invalid();
      } else {
        if (ids.has(next.id)) invalid();
        entries.set(next.mediaId, next); ids.add(next.id);
      }
    }
  }
  if (entries.size > 500) invalid();
  return { entries: [...entries.values()], hasNextChunk: collection.hasNextChunk === true };
}
