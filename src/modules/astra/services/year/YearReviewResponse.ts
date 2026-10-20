/**
 * @file YearReviewResponse.ts
 * @description Strict readers for the Astra Wrapped GraphQL responses. Anything with a
 * wrong shape, wrong owner or out-of-range number is rejected; optional data that AniList
 * leaves null becomes an empty value instead.
 */

import { isRecord } from '@/api/GraphQLResponse';
import { isSyncId } from '@core/services/SyncResponse';
import { parseWebUrl } from '@core/utils/WebUrl';
import type {
  ReviewActivity,
  ReviewActivityKind,
  ReviewCharacter,
  ReviewMedia,
  ReviewMessage,
  ReviewPerson,
  ReviewPost,
  ReviewStaff,
  ReviewUser,
} from './YearReviewTypes';

function invalid(): never {
  throw new Error('Invalid Astra Wrapped response');
}

const KINDS: Record<string, ReviewActivityKind> = {
  'watched episode': 'progress',
  'read chapter': 'progress',
  'rewatched episode': 'repeat-progress',
  'reread chapter': 'repeat-progress',
  completed: 'completed',
  rewatched: 'repeated',
  reread: 'repeated',
  'plans to watch': 'planning',
  'plans to read': 'planning',
  'paused watching': 'paused',
  'paused reading': 'paused',
  dropped: 'dropped',
};
const MAX_TEXT = 500;
const MAX_COUNT = 100_000_000;

const count = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_COUNT
    ? (value as number)
    : invalid();
const optionalCount = (value: unknown): number | null =>
  value === null || value === undefined ? null : count(value);
const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : fallback;
const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, MAX_TEXT)
    : value === null || value === undefined
      ? null
      : invalid();
const list = (value: unknown): unknown[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : invalid();
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : invalid());
const imageOf = (value: unknown, key: 'large' | 'medium'): string | null =>
  value === null || value === undefined ? null : optionalText(record(value)[key]);
/** A cover is an http(s) URL or null; anything else is treated as missing. */
const webUrl = (value: unknown): string | null => {
  const url = optionalText(value);
  return url !== null && parseWebUrl(url) ? url : null;
};
/** extraLarge is sharp at poster size; large is the fallback. Both use the same validation. */
const coverOf = (cover: Record<string, unknown>): string | null =>
  webUrl(cover.extraLarge) ?? webUrl(cover.large);
const timestamp = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) < 4102444800
    ? (value as number)
    : invalid();

function page(value: unknown, key: string): { rows: unknown[]; hasNextPage: boolean } {
  const root = record(record(value)[key]);
  const info = record(root.pageInfo ?? { hasNextPage: false });
  if (typeof info.hasNextPage !== 'boolean') invalid();
  return { rows: list(root.activities), hasNextPage: info.hasNextPage };
}

function user(value: unknown): ReviewUser | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (!isSyncId(row.id)) invalid();
  return {
    id: row.id,
    name: text(row.name, `User ${row.id}`),
    avatar: imageOf(row.avatar, 'medium'),
  };
}

/** "4 - 10" → {4, 10}; "7" → {7, 7}; anything else → null. */
export function parseProgress(value: unknown): { from: number; to: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{1,6})(?:\s*-\s*(\d{1,6}))?\s*$/.exec(value);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return from > 0 && to >= from ? { from, to } : null;
}

export function yearActivityPage(
  value: unknown,
  owner: number
): { activities: ReviewActivity[]; hasNextPage: boolean } {
  const { rows, hasNextPage } = page(value, 'Page');
  const activities = rows.map((item): ReviewActivity => {
    const row = record(item);
    if (!isSyncId(row.id) || row.userId !== owner || typeof row.status !== 'string') invalid();
    const media = record(row.media);
    if (!isSyncId(media.id)) invalid();
    return {
      id: row.id,
      mediaId: media.id,
      kind: KINDS[row.status.trim().toLowerCase()] ?? 'other',
      progress: parseProgress(row.progress),
      createdAt: timestamp(row.createdAt),
      likeCount: count(row.likeCount ?? 0),
      replyCount: count(row.replyCount ?? 0),
      likers: list(row.likes).flatMap((like) => user(like) ?? []),
    };
  });
  return { activities, hasNextPage };
}

export function yearSocialPage(
  value: unknown,
  owner: number
): {
  posts: ReviewPost[];
  messages: ReviewMessage[];
  genres: Array<{ name: string; count: number }>;
  hasNextPage: boolean;
} {
  const posts = page(value, 'posts');
  const messages = page(value, 'messages');
  const profile = record(record(value).User);
  if (profile.id !== owner) invalid();
  const stats = profile.statistics === null ? null : record(profile.statistics);
  const anime = stats?.anime === null || !stats ? null : record(stats.anime);
  return {
    posts: posts.rows.map((item) => {
      const row = record(item);
      if (!isSyncId(row.id) || row.userId !== owner) invalid();
      return {
        createdAt: timestamp(row.createdAt),
        likeCount: count(row.likeCount ?? 0),
        replyCount: count(row.replyCount ?? 0),
        likers: list(row.likes).flatMap((like) => user(like) ?? []),
      };
    }),
    messages: messages.rows.flatMap((item) => {
      const row = record(item);
      if (!isSyncId(row.id)) invalid();
      return row.recipientId === owner
        ? [{ createdAt: timestamp(row.createdAt), sender: user(row.messenger) }]
        : [];
    }),
    genres: list(anime?.genres).map((item) => {
      const row = record(item);
      return { name: text(row.genre, 'Unknown'), count: count(row.count) };
    }),
    hasNextPage: posts.hasNextPage || messages.hasNextPage,
  };
}

function person(value: unknown): ReviewPerson {
  const row = record(value);
  if (!isSyncId(row.id)) invalid();
  const name = row.name === null || row.name === undefined ? null : record(row.name).userPreferred;
  return { id: row.id, name: text(name, `#${row.id}`), image: imageOf(row.image, 'large') };
}

const ROLES = new Set(['MAIN', 'SUPPORTING', 'BACKGROUND']);

function characters(value: unknown): ReviewCharacter[] {
  const root = value === null || value === undefined ? { edges: [] } : record(value);
  return list(root.edges).map((item) => {
    const edge = record(item);
    if (!ROLES.has(edge.role as string)) invalid();
    const node = record(edge.node);
    const actor = list(edge.voiceActors)[0];
    return {
      ...person(node),
      role: edge.role as ReviewCharacter['role'],
      favourites: count(node.favourites ?? 0),
      voiceActor: actor === undefined ? null : person(actor),
    };
  });
}

function staff(value: unknown): ReviewStaff[] {
  const root = value === null || value === undefined ? { edges: [] } : record(value);
  return list(root.edges).map((item) => {
    const edge = record(item);
    return { ...person(edge.node), role: text(edge.role, '') };
  });
}

function entry(value: unknown): ReviewMedia['entry'] {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (
    typeof row.score !== 'number' ||
    !Number.isFinite(row.score) ||
    row.score < 0 ||
    row.score > 10 ||
    typeof row.status !== 'string' ||
    typeof row.private !== 'boolean' ||
    typeof row.hiddenFromStatusLists !== 'boolean'
  )
    invalid();
  return {
    score: row.score,
    status: row.status,
    private: row.private,
    hidden: row.hiddenFromStatusLists,
  };
}

function releaseYear(row: Record<string, unknown>): number | null {
  const start =
    row.startDate === null || row.startDate === undefined ? null : record(row.startDate).year;
  const year = row.seasonYear ?? start ?? null;
  return year === null
    ? null
    : Number.isInteger(year) && (year as number) >= 1900 && (year as number) <= 2199
      ? (year as number)
      : invalid();
}

function mediaRow(value: unknown): ReviewMedia {
  const row = record(value);
  if (!isSyncId(row.id) || (row.type !== 'ANIME' && row.type !== 'MANGA')) invalid();
  const title = row.title === null ? null : record(row.title).userPreferred;
  const cover =
    row.coverImage === null || row.coverImage === undefined ? null : record(row.coverImage);
  const mean = optionalCount(row.meanScore);
  return {
    id: row.id,
    type: row.type,
    title: text(title, `${row.type === 'ANIME' ? 'Anime' : 'Manga'} ${row.id}`),
    cover: cover ? coverOf(cover) : null,
    color: cover ? optionalText(cover.color) : null,
    format: optionalText(row.format),
    episodes: optionalCount(row.episodes),
    chapters: optionalCount(row.chapters),
    duration: optionalCount(row.duration),
    releaseYear: releaseYear(row),
    country: optionalText(row.countryOfOrigin),
    source: optionalText(row.source),
    genres: list(row.genres).flatMap((genre) => (typeof genre === 'string' ? [genre] : [])),
    tags: list(row.tags).flatMap((item) => {
      const tag = record(item);
      return tag.isMediaSpoiler === true
        ? []
        : [{ name: text(tag.name, ''), rank: count(tag.rank ?? 0) }].filter((t) => t.name);
    }),
    meanScore: mean !== null && mean <= 100 ? mean : null,
    popularity: count(row.popularity ?? 0),
    studios: list(
      row.studios === null || row.studios === undefined ? [] : record(row.studios).nodes
    ).map((item) => {
      const studio = record(item);
      if (!isSyncId(studio.id)) invalid();
      return { id: studio.id, name: text(studio.name, `Studio ${studio.id}`) };
    }),
    staff: staff(row.staff),
    characters: characters(row.characters),
    scoreDistribution: list(
      row.stats === null || row.stats === undefined ? [] : record(row.stats).scoreDistribution
    ).map((item) => {
      const bucket = record(item);
      return { score: count(bucket.score), amount: count(bucket.amount) };
    }),
    entry: entry(row.mediaListEntry),
  };
}

export function yearMediaPage(value: unknown, requested: number[]): ReviewMedia[] {
  const wanted = new Set(requested);
  const media = list(record(record(value).Page).media).map(mediaRow);
  if (media.some((item) => !wanted.has(item.id))) invalid();
  return media;
}

/** Latest prior activity per alias: the last logged unit, or 'complete' for a finished title. */
export function yearPriorPage(
  value: unknown,
  owner: number,
  mediaIds: number[]
): Map<number, number | 'complete'> {
  const root = record(value);
  const result = new Map<number, number | 'complete'>();
  mediaIds.forEach((mediaId, index) => {
    for (const item of list(record(root[`m${index}`]).activities)) {
      const row = record(item);
      if (row.userId !== owner || record(row.media).id !== mediaId) invalid();
      const kind = KINDS[String(row.status).trim().toLowerCase()];
      const progress = parseProgress(row.progress);
      if ((kind === 'progress' || kind === 'repeat-progress') && progress) {
        result.set(mediaId, progress.to);
        return;
      }
      if (kind === 'completed' || kind === 'repeated') {
        result.set(mediaId, 'complete');
        return;
      }
    }
  });
  return result;
}
