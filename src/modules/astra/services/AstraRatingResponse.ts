import { MediaListStatus } from '@/api/AnilistTypes';
import type { AniListDate, MediaFormat, MediaStatus } from '@/api/AnilistTypes';
import type { AstraRatingEntry, IRatingInitialData } from '../interfaces/IAstraRatingService';
import { isSyncId } from '@core/services/SyncResponse';
import { readAstraDate } from '../utils/AstraDates';

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (): never => { throw new Error('Invalid AniList rating response'); };
const statuses = new Set<unknown>(['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']);
const formats = new Set<unknown>(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA', 'NOVEL', 'ONE_SHOT']);
const mediaStatuses = new Set<unknown>(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']);

function text(v: unknown): string | null { return v === null || typeof v === 'string' ? v : fail(); }
function integer(v: unknown, max = 2147483647): number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max) ? v : fail();
}
function boolean(v: unknown): boolean { return v === null ? false : typeof v === 'boolean' ? v : fail(); }
function date(v: unknown): AniListDate | null {
  try { return readAstraDate(v, true); } catch { return fail(); }
}
function customLists(v: unknown): Record<string, boolean> {
  if (v === null) return {};
  if (!record(v)) return fail();
  const pairs = Object.entries(v);
  if (pairs.some(([, enabled]) => typeof enabled !== 'boolean')) return fail();
  // fromEntries preserves names such as __proto__ as own data properties.
  return Object.fromEntries(pairs) as Record<string, boolean>;
}
function listEntry(v: unknown, mediaId: number, userId: number): AstraRatingEntry | null {
  if (v === null) return null;
  if (!record(v) || !isSyncId(v.id) || v.mediaId !== mediaId || v.userId !== userId) return fail();
  if (v.status !== null && !statuses.has(v.status)) return fail();
  if (v.score !== null && (typeof v.score !== 'number' || !Number.isFinite(v.score) || v.score < 0 || v.score > 100)) return fail();
  return { id: v.id, mediaId, userId, status: v.status === null ? MediaListStatus.PLANNING : v.status as MediaListStatus,
    progress: integer(v.progress) ?? 0, score: v.score === null ? 0 : v.score as number, notes: text(v.notes) ?? '',
    repeat: integer(v.repeat) ?? 0, private: boolean(v.private), hiddenFromStatusLists: boolean(v.hiddenFromStatusLists),
    startedAt: date(v.startedAt), completedAt: date(v.completedAt), customLists: customLists(v.customLists) };
}
function viewerLists(v: unknown, type: 'ANIME' | 'MANGA'): string[] {
  if (v === null) return [];
  if (!record(v)) return fail();
  const options = v[type === 'MANGA' ? 'mangaList' : 'animeList'];
  if (options === null) return [];
  if (!record(options)) return fail();
  const lists = options.customLists;
  if (lists === null) return [];
  if (!Array.isArray(lists) || lists.some(name => name !== null && typeof name !== 'string')) return fail();
  return lists.filter((name): name is string => typeof name === 'string');
}

/** Accept only the selected schema fields and the captured viewer/media identity. */
export function ratingInitialResponse(value: unknown, mediaId: number, userId: number): IRatingInitialData | null {
  if (!isSyncId(mediaId) || !isSyncId(userId) || !record(value) || !record(value.Viewer) || value.Viewer.id !== userId) return fail();
  if (value.Media === null) return null;
  const media = value.Media;
  if (!record(media) || media.id !== mediaId || (media.type !== 'ANIME' && media.type !== 'MANGA')) return fail();
  if (media.format !== null && !formats.has(media.format)) return fail();
  if (media.status !== null && !mediaStatuses.has(media.status)) return fail();
  let title = `Media ${mediaId}`;
  if (media.title !== null) {
    if (!record(media.title)) return fail();
    title = text(media.title.userPreferred) || title;
  }
  const coverImage: IRatingInitialData['media']['coverImage'] = {};
  if (media.coverImage !== null) {
    if (!record(media.coverImage)) return fail();
    for (const field of ['large', 'extraLarge', 'color'] as const) {
      const val = text(media.coverImage[field]); if (val !== null) coverImage[field] = val;
    }
  }
  let nextAiringEpisode: { episode: number } | null = null;
  if (media.nextAiringEpisode !== null) {
    if (!record(media.nextAiringEpisode) || !isSyncId(media.nextAiringEpisode.episode)) return fail();
    nextAiringEpisode = { episode: media.nextAiringEpisode.episode };
  }
  const country = text(media.countryOfOrigin);
  return { media: { id: mediaId, title: { userPreferred: title }, type: media.type,
    format: media.format === null ? undefined : media.format as MediaFormat,
    status: media.status === null ? undefined : media.status as MediaStatus,
    episodes: integer(media.episodes), chapters: integer(media.chapters), countryOfOrigin: country ?? undefined,
    coverImage, nextAiringEpisode, mediaListEntry: listEntry(media.mediaListEntry, mediaId, userId) },
    allCustomLists: viewerLists(value.Viewer.mediaListOptions, media.type) };
}
