import { isRecord } from '@/api/GraphQLResponse';
import { DAYS_OF_WEEK } from '@core/constants';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AnimeEntry, FriendActivity } from '@core/types';

const INT_MAX = 2147483647;
function invalid(): never { throw new Error('Invalid calendar entries'); }
export function isCalendarId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= INT_MAX;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > INT_MAX) invalid();
  return value;
}
function text(value: unknown): string { if (typeof value !== 'string') invalid(); return value; }
function date(value: unknown): Date {
  if (!(value instanceof Date) && typeof value !== 'string') invalid();
  const copy = new Date(value);
  if (!Number.isFinite(copy.getTime()) || (typeof value === 'string' && copy.toISOString() !== value)) invalid();
  return copy;
}
function friend(value: unknown): FriendActivity {
  if (!isRecord(value) || !isCalendarId(value.id) || !isRecord(value.user) || !isCalendarId(value.user.id)
    || !isRecord(value.user.avatar) || typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 100) invalid();
  const name = text(value.user.name);
  if (!name.trim()) invalid();
  try { encodeURIComponent(name); } catch { invalid(); }
  const status = Object.values(MediaListStatus).find(item => item === value.status);
  if (!status) invalid();
  return { id: value.id, status, progress: integer(value.progress), score: value.score,
    user: { id: value.user.id, name, avatar: { medium: text(value.user.avatar.medium) } } };
}

/** Validate and project a fresh graph, including Date and nested social data. */
export function calendarEntries(value: unknown): AnimeEntry[] {
  if (!Array.isArray(value)) invalid();
  const seen = new Set<number>();
  return value.map(item => {
    if (!isRecord(item) || !isCalendarId(item.id) || !isCalendarId(item.mediaId) || seen.has(item.mediaId)
      || !DAYS_OF_WEEK.some(day => day === item.dayOfWeek)) invalid();
    seen.add(item.mediaId);
    const airingAt = date(item.airingAt);
    const result: AnimeEntry = { id: item.id, mediaId: item.mediaId, title: text(item.title), cleanTitle: text(item.cleanTitle),
      episode: integer(item.episode, 1), airingAt, timeUntilAiring: integer(item.timeUntilAiring, -2147483648),
      coverImage: text(item.coverImage), siteUrl: text(item.siteUrl), progress: integer(item.progress),
      totalEpisodes: item.totalEpisodes === null ? null : integer(item.totalEpisodes), dayOfWeek: DAYS_OF_WEEK[airingAt.getDay()] };
    if (item.calendarKind !== undefined) {
      if (item.calendarKind !== 'airing' && item.calendarKind !== 'personal') invalid();
      result.calendarKind = item.calendarKind;
    }
    if (item.friendActivity !== undefined) {
      if (!Array.isArray(item.friendActivity)) invalid();
      result.friendActivity = item.friendActivity.map(friend);
    }
    return result;
  });
}

/** Non-cryptographic consistency check over the complete projected payload. */
export function calendarFingerprint(entries: AnimeEntry[]): string {
  const data = JSON.stringify(entries.slice().sort((a, b) => a.mediaId - b.mediaId));
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) { hash ^= data.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
