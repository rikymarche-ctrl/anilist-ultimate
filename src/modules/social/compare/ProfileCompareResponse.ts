/**
 * @file ProfileCompareResponse.ts
 * @description Validates the AniList payloads behind the profile comparison.
 *
 * The envelope is strict: a list belonging to anyone but the requested user is refused.
 * Rows are lenient: one malformed or deleted title is skipped instead of losing a whole
 * comparison. The same title in several custom lists collapses to one entry.
 */

import { isRecord } from '@/api/GraphQLResponse';
import { parseWebUrl } from '@core/utils/WebUrl';
import type { CompareEntry, CompareMedia, CompareStat, CompareStats, CompareStatus, CompareUser } from './ProfileCompareModel';

const STATUSES: readonly string[] = [
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'DROPPED',
  'PAUSED',
  'REPEATING',
];
const MS_PER_DAY = 86_400_000;

const isId = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;

const webUrl = (value: unknown): string | null =>
  typeof value === 'string' && parseWebUrl(value) ? value : null;

/** Day number of a full calendar date; partial or impossible dates cannot be compared, so they are null. */
export function dayNumber(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const { year, month, day } = value;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const time = Date.UTC(year as number, (month as number) - 1, day as number);
  const date = new Date(time);
  if (date.getUTCMonth() !== (month as number) - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(time / MS_PER_DAY);
}

function parseEntry(row: unknown): CompareEntry | null {
  if (!isRecord(row) || !isId(row.mediaId) || !STATUSES.includes(row.status as string)) return null;
  const media = row.media;
  if (!isRecord(media) || media.id !== row.mediaId) return null;
  const score = typeof row.score === 'number' && row.score >= 0 && row.score <= 10 ? row.score : 0;
  const title =
    isRecord(media.title) && typeof media.title.userPreferred === 'string'
      ? media.title.userPreferred
      : '';
  const image = isRecord(media.coverImage) ? media.coverImage : {};
  return {
    mediaId: row.mediaId,
    title: title || `Anime ${row.mediaId}`,
    cover: webUrl(image.extraLarge) ?? webUrl(image.large),
    status: row.status as CompareStatus,
    score,
    private: row.private === true,
    adult: media.isAdult === true,
    unreleased: media.status === 'NOT_YET_RELEASED',
    started: dayNumber(row.startedAt),
    completed: dayNumber(row.completedAt),
    repeat: typeof row.repeat === 'number' && row.repeat > 0 ? row.repeat : 0,
    format: typeof media.format === 'string' ? media.format : null,
    releaseYear: isRecord(media.startDate) && typeof media.startDate.year === 'number' ? media.startDate.year : null,
    country: typeof media.countryOfOrigin === 'string' ? media.countryOfOrigin : null,
    popularity: typeof media.popularity === 'number' && media.popularity > 0 ? media.popularity : 0,
    genres: Array.isArray(media.genres)
      ? media.genres.filter((genre): genre is string => typeof genre === 'string')
      : [],
  };
}

export function parseCompareList(
  value: unknown,
  owner: number
): { entries: CompareEntry[]; hasNextChunk: boolean } {
  if (!isRecord(value) || !isRecord(value.MediaListCollection))
    throw new Error('Invalid list response');
  const collection = value.MediaListCollection;
  if (!isRecord(collection.user) || collection.user.id !== owner)
    throw new Error('Unrelated list response');
  const entries = new Map<number, CompareEntry>();
  for (const list of Array.isArray(collection.lists) ? collection.lists : []) {
    if (!isRecord(list) || !Array.isArray(list.entries)) continue;
    for (const row of list.entries) {
      const entry = parseEntry(row);
      if (entry && !entries.has(entry.mediaId)) entries.set(entry.mediaId, entry);
    }
  }
  return { entries: [...entries.values()], hasNextChunk: collection.hasNextChunk === true };
}

const asNumber = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0);

function parseStat(value: unknown, field: string): CompareStat | null {
  if (!isRecord(value) || !isRecord(value[field])) return null;
  const item = value[field];
  if (!isId(item.id)) return null;
  const name = isRecord(item.name) ? item.name.full : item.name;
  if (typeof name !== 'string' || !name) return null;
  return {
    id: item.id,
    name,
    image: isRecord(item.image) ? webUrl(item.image.medium) : null,
    count: asNumber(value.count),
  };
}

const statList = (value: unknown, field: string): CompareStat[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => parseStat(item, field))
    .filter((item): item is CompareStat => item !== null);

function parseStats(value: unknown, media: CompareMedia): CompareStats {
  const stats = isRecord(value) ? value : {};
  const tags = (Array.isArray(stats.tags) ? stats.tags : []).flatMap((row: unknown) => {
    if (!isRecord(row) || !isRecord(row.tag) || typeof row.tag.name !== 'string') return [];
    return row.tag.isAdult === true || row.tag.isMediaSpoiler === true
      ? []
      : [{ name: row.tag.name, count: asNumber(row.count) }];
  });
  return {
    count: asNumber(stats.count),
    minutes: asNumber(stats.minutesWatched),
    units: asNumber(media === 'ANIME' ? stats.episodesWatched : stats.chaptersRead),
    volumes: asNumber(stats.volumesRead),
    tags,
    studios: statList(stats.studios, 'studio'),
    voiceActors: statList(stats.voiceActors, 'voiceActor'),
    staff: statList(stats.staff, 'staff'),
  };
}

export function parseCompareUser(value: unknown, media: CompareMedia = 'ANIME'): CompareUser | null {
  if (!isRecord(value) || !isId(value.id) || typeof value.name !== 'string' || !value.name) return null;
  const statistics = isRecord(value.statistics) ? value.statistics : {};
  return {
    id: value.id,
    name: value.name,
    avatar: isRecord(value.avatar) ? webUrl(value.avatar.large) : null,
    stats: parseStats(statistics[media === 'ANIME' ? 'anime' : 'manga'], media),
  };
}
