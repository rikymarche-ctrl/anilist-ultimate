import { isRecord } from '@/api/GraphQLResponse';
import { readAstraDate } from '../utils/AstraDates';
import { isSyncId } from '@core/services/SyncResponse';
import { parseWebUrl } from '@core/utils/WebUrl';
import type { MediaListStatus, MediaStatus } from '@/api/AnilistTypes';
import { SEASONS, type BroadcastSeason, type SeasonalEntry } from './SeasonalWrappedModel';

function invalid(): never { throw new Error('Invalid Seasonal Wrapped response'); }
const listStatuses = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];
const releaseStatuses = ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'];
const nullableText = (value: unknown): string | null => value === null || typeof value === 'string' ? value : invalid();
/** A cover is an http(s) URL or null; anything else is treated as missing. */
const webUrl = (value: unknown): string | null => {
  const url = nullableText(value);
  return url !== null && parseWebUrl(url) ? url : null;
};
/** extraLarge is sharp at poster size; large is the fallback. A payload without extraLarge reads as null. */
const coverOf = (image: Record<string, unknown>): string | null => webUrl(image.extraLarge ?? null) ?? webUrl(image.large);

export function seasonalCollection(value: unknown, owner: number): { entries: SeasonalEntry[]; hasNextChunk: boolean } {
  if (!isSyncId(owner) || !isRecord(value) || !isRecord(value.MediaListCollection)) invalid();
  const collection = value.MediaListCollection;
  if (!isRecord(collection.user) || collection.user.id !== owner || typeof collection.hasNextChunk !== 'boolean'
    || (collection.lists !== null && !Array.isArray(collection.lists))) invalid();
  const entries = new Map<number, SeasonalEntry>();
  for (const list of collection.lists ?? []) {
    if (!isRecord(list) || (list.entries !== null && !Array.isArray(list.entries))) invalid();
    for (const row of list.entries ?? []) {
      if (!isRecord(row) || !isSyncId(row.id) || !isSyncId(row.mediaId) || row.userId !== owner
        || !listStatuses.includes(row.status as string) || !Number.isInteger(row.progress) || (row.progress as number) < 0 || (row.progress as number) > 2147483647
        || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 10
        || typeof row.private !== 'boolean' || typeof row.hiddenFromStatusLists !== 'boolean') invalid();
      const media = row.media;
      if (!isRecord(media) || media.id !== row.mediaId || media.type !== 'ANIME' || !releaseStatuses.includes(media.status as string)
        || (media.season !== null && !SEASONS.includes(media.season as BroadcastSeason))
        || (media.seasonYear !== null && (!Number.isInteger(media.seasonYear) || (media.seasonYear as number) < 1900 || (media.seasonYear as number) > 2199))) invalid();
      if (media.title !== null && !isRecord(media.title)) invalid();
      if (media.coverImage !== null && !isRecord(media.coverImage)) invalid();
      if (media.genres !== null && (!Array.isArray(media.genres) || !media.genres.every(item => item === null || typeof item === 'string'))) invalid();
      const next: SeasonalEntry = { mediaId: row.mediaId, title: media.title === null ? `Anime ${row.mediaId}` : nullableText(media.title.userPreferred) || `Anime ${row.mediaId}`,
        cover: media.coverImage === null ? null : coverOf(media.coverImage), format: nullableText(media.format),
        status: row.status as MediaListStatus, progress: row.progress as number, score: row.score,
        private: row.private, hidden: row.hiddenFromStatusLists,
        startedAt: readAstraDate(row.startedAt, true), completedAt: readAstraDate(row.completedAt, true),
        releaseStatus: media.status as MediaStatus, startDate: readAstraDate(media.startDate, true), endDate: readAstraDate(media.endDate, true),
        origin: media.season && media.seasonYear ? { season: media.season as BroadcastSeason, year: media.seasonYear as number } : null,
        genres: (media.genres ?? []).filter((item): item is string => typeof item === 'string') };
      const previous = entries.get(next.mediaId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(next)) invalid();
      entries.set(next.mediaId, next);
    }
  }
  if (entries.size > 500) invalid();
  return { entries: [...entries.values()], hasNextChunk: collection.hasNextChunk };
}
