import type { AstraProgressResult } from '@/modules/astra/interfaces/IAstraRatingService';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { GraphQLResponse } from '@/api/GraphQLResponse';

const statuses = new Set<unknown>([MediaListStatus.CURRENT, MediaListStatus.PLANNING, MediaListStatus.COMPLETED,
  MediaListStatus.DROPPED, MediaListStatus.PAUSED, MediaListStatus.REPEATING]);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isSyncId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;

function entry(value: unknown, field: string, mediaId: number, userId?: number): Record<string, unknown> {
  if (!isSyncId(mediaId) || (userId !== undefined && !isSyncId(userId)) || !record(value) || !record(value[field])) {
    throw new Error('Invalid AniList synchronization response');
  }
  const row = value[field];
  if (!isSyncId(row.id) || !isSyncId(row.userId) || row.mediaId !== mediaId || (userId !== undefined && row.userId !== userId)) {
    throw new Error('Unrelated AniList synchronization response');
  }
  return row;
}

/** Project only the identity, baseline progress/status and nullable display title needed by the action. */
export function syncProgressResponse(value: unknown, mediaId: number, userId: number): { progress: number; status: MediaListStatus; title: string } {
  const row = entry(value, 'MediaList', mediaId, userId);
  if ((row.progress !== null && (!Number.isInteger(row.progress) || (row.progress as number) < 0 || (row.progress as number) > 2147483647))
    || !statuses.has(row.status)) throw new Error('Invalid AniList progress response');
  let title = `Media ${mediaId}`;
  if (row.media !== null) {
    if (!record(row.media) || row.media.id !== mediaId) throw new Error('Unrelated AniList media response');
    if (row.media.title !== null) {
      if (!record(row.media.title) || (row.media.title.userPreferred !== null && typeof row.media.title.userPreferred !== 'string')) {
        throw new Error('Invalid AniList title response');
      }
      title = row.media.title.userPreferred as string || title;
    }
  }
  return { progress: row.progress === null ? 0 : row.progress as number, status: row.status as MediaListStatus, title };
}

/** A transport 404 for the notes lookup is AniList's answer for a viewer without a list entry. */
export function isNotFoundFailure(error: unknown): boolean {
  return record(error) && error.statusCode === 404;
}

/**
 * Null is a confirmed empty baseline: either notes are null, or AniList confirms the viewer has no
 * MediaList yet (MediaList null, optionally with only 404 "Not Found" errors). Missing/non-string
 * notes and any other GraphQL error never become empty text.
 */
export function syncNotesResponse(response: GraphQLResponse<unknown>, mediaId: number, userId: number): string | null {
  if (!record(response)) throw new Error('Invalid AniList synchronization response');
  const { data } = response;
  const errors = response.errors ?? [];
  const notFound = errors.length > 0 && errors.every(error => error.status === 404);
  if (errors.length > 0 && !notFound) throw new Error('AniList notes lookup failed');
  const mediaListAbsent = record(data) && data.MediaList === null;
  if (mediaListAbsent || (notFound && (data === null || data === undefined))) return null;
  const row = entry(data, 'MediaList', mediaId, userId);
  if (row.notes !== null && typeof row.notes !== 'string') throw new Error('Invalid AniList notes response');
  return row.notes as string | null;
}

/** A mutation is removed from the durable queue only after its identity is confirmed. */
export function assertSyncAcknowledgement(value: unknown, mediaId: number, userId?: number): void {
  entry(value, 'SaveMediaListEntry', mediaId, userId);
}

/** Resolve the authenticated viewer's entry; never delete an identity supplied by a tab. */
export function syncDeletionEntryResponse(value: unknown, mediaId: number, userId: number): number | null {
  if (!isSyncId(mediaId) || !isSyncId(userId) || !record(value) || !record(value.Media)
    || value.Media.id !== mediaId) throw new Error('Invalid AniList deletion response');
  if (value.Media.mediaListEntry === null) return null;
  const row = entry({ MediaList: value.Media.mediaListEntry }, 'MediaList', mediaId, userId);
  return row.id as number;
}

export function assertDeletionAcknowledgement(value: unknown): void {
  if (!record(value) || !record(value.DeleteMediaListEntry) || value.DeleteMediaListEntry.deleted !== true) {
    throw new Error('AniList did not confirm entry deletion');
  }
}

/** Validate the public worker result before a tab updates its own store or emits an event. */
export function syncProgressResult(value: unknown, mediaId: number, userId?: number): AstraProgressResult {
  if (!isSyncId(mediaId) || (userId !== undefined && !isSyncId(userId)) || !record(value)
    || value.mediaId !== mediaId || !isSyncId(value.userId) || (userId !== undefined && value.userId !== userId)
    || !Number.isInteger(value.progress) || (value.progress as number) < 0 || (value.progress as number) > 2147483647
    || !Number.isInteger(value.previousProgress) || (value.previousProgress as number) < 0 || (value.previousProgress as number) > 2147483647
    || !statuses.has(value.status) || typeof value.title !== 'string'
    || (value.syncState !== undefined && value.syncState !== 'synced' && value.syncState !== 'queued')) throw new Error('Invalid background progress result');
  return { mediaId, userId: value.userId, progress: value.progress as number, previousProgress: value.previousProgress as number,
    status: value.status as MediaListStatus, title: value.title,
    ...(value.syncState === undefined ? {} : { syncState: value.syncState as 'synced' | 'queued' }) };
}
