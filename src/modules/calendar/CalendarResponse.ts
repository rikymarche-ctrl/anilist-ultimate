import { isRecord } from '@/api/GraphQLResponse';
import { MediaListStatus } from '@/api/AnilistTypes';
import { validateSyncPayload } from '@core/services/SyncPayload';
import { isCalendarId } from './CalendarEntries';

const statuses = [MediaListStatus.CURRENT, MediaListStatus.PLANNING, MediaListStatus.COMPLETED,
  MediaListStatus.DROPPED, MediaListStatus.PAUSED, MediaListStatus.REPEATING];
type CalendarStatus = typeof statuses[number] | null;
interface CalendarMedia {
  id: number; type: 'ANIME' | 'MANGA' | null; status: string | null; episodes: number | null;
  title: { english: string | null; romaji: string | null; native: string | null };
  coverImage: { large: string | null; medium: string | null }; siteUrl: string | null;
  nextAiringEpisode: { id: number; mediaId: number; episode: number; airingAt: number; timeUntilAiring: number } | null;
}
export interface CalendarListEntry {
  id: number; mediaId: number; progress: number; status: CalendarStatus; media: CalendarMedia | null;
}
export interface CalendarPending { progress?: number; status?: CalendarStatus; }
function invalid(): never { throw new Error('Invalid calendar response'); }
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 2147483647) invalid();
  return value;
}
function string(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') invalid();
  return value;
}
function status(value: unknown): CalendarStatus {
  if (value === null) return null;
  const result = statuses.find(item => item === value);
  if (!result) invalid(); return result;
}
function media(value: unknown, mediaId: number): CalendarMedia | null {
  if (value === null) return null;
  if (!isRecord(value) || value.id !== mediaId || ![null, 'ANIME', 'MANGA'].includes(value.type as string | null)) invalid();
  if (value.status !== null && !['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'].includes(value.status as string)) invalid();
  const title = value.title === null ? { english: null, romaji: null, native: null } : value.title;
  const cover = value.coverImage === null ? { large: null, medium: null } : value.coverImage;
  if (!isRecord(title) || !isRecord(cover)) invalid();
  let next: CalendarMedia['nextAiringEpisode'] = null;
  if (value.nextAiringEpisode !== null) {
    const airing = value.nextAiringEpisode;
    if (!isRecord(airing) || !isCalendarId(airing.id) || airing.mediaId !== mediaId) invalid();
    next = { id: airing.id, mediaId, episode: integer(airing.episode, 1), airingAt: integer(airing.airingAt),
      timeUntilAiring: integer(airing.timeUntilAiring, -2147483648) };
  }
  return { id: mediaId, type: value.type as CalendarMedia['type'], status: value.status as string | null,
    episodes: value.episodes === null ? null : integer(value.episodes),
    title: { english: string(title.english), romaji: string(title.romaji), native: string(title.native) },
    coverImage: { large: string(cover.large), medium: string(cover.medium) }, siteUrl: string(value.siteUrl), nextAiringEpisode: next };
}

/** Project the fields used by the calendar; nullable schema fields remain explicit. */
export function calendarCollection(value: unknown, owner: number): { entries: CalendarListEntry[]; hasNextChunk: boolean } {
  if (!isCalendarId(owner) || !isRecord(value) || !isRecord(value.MediaListCollection)) invalid();
  const collection = value.MediaListCollection;
  if (collection.user !== null && (!isRecord(collection.user) || collection.user.id !== owner)) invalid();
  if (collection.hasNextChunk !== null && typeof collection.hasNextChunk !== 'boolean') invalid();
  if (collection.lists !== null && !Array.isArray(collection.lists)) invalid();
  const entries: CalendarListEntry[] = [];
  for (const list of collection.lists ?? []) {
    if (list === null) continue;
    if (!isRecord(list) || (list.entries !== null && !Array.isArray(list.entries))) invalid();
    for (const row of list.entries ?? []) {
      if (row === null) continue;
      if (!isRecord(row) || !isCalendarId(row.id) || !isCalendarId(row.mediaId) || row.userId !== owner) invalid();
      entries.push({ id: row.id, mediaId: row.mediaId, progress: row.progress === null ? 0 : integer(row.progress),
        status: status(row.status), media: media(row.media, row.mediaId) });
    }
  }
  return { entries, hasNextChunk: collection.hasNextChunk === true };
}

/** Only explicitly owned, validated durable changes can override a remote snapshot. */
export function calendarPending(value: unknown, owner: number): Map<number, CalendarPending> {
  if (!Array.isArray(value)) throw new Error('Invalid calendar pending queue');
  const result = new Map<number, CalendarPending>();
  for (const item of value) {
    if (!isRecord(item)) throw new Error('Invalid calendar pending queue');
    if (item.userId !== owner) continue; // Only this account can affect its calendar.
    validateSyncPayload(item.type, item.payload);
    const id = item.payload.mediaId!;
    const patch = result.get(id) ?? {};
    if (item.payload.progress !== undefined && item.payload.progress !== null) patch.progress = item.payload.progress;
    if (item.payload.status !== undefined) patch.status = status(item.payload.status);
    result.set(id, patch);
  }
  return result;
}
