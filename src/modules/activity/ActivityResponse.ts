import { isRecord } from '@/api/GraphQLResponse';
import type { AniListActivity } from './ActivityUtils';

const INT_MAX = 2147483647;
function fail(): never { throw new Error('Invalid activity response'); }
export function isActivityId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= INT_MAX;
}
function nonnegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > INT_MAX) fail();
  return value;
}
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') fail();
  return value;
}
function image(value: unknown): { medium: string } {
  if (value === null) return { medium: '' };
  if (!isRecord(value)) fail();
  return { medium: text(value.medium) };
}

/** Project only requested fields; nullable provider fields are normalized, never coerced. */
export function parseFeedActivity(value: unknown): AniListActivity {
  if (!isRecord(value) || !isActivityId(value.id)
    || !['ANIME_LIST', 'MANGA_LIST', 'TEXT'].some(kind => kind === value.type)) fail();
  let user: AniListActivity['user'] = null;
  if (value.user !== null) {
    if (!isRecord(value.user) || !isActivityId(value.user.id) || typeof value.user.name !== 'string' || !value.user.name.trim()) fail();
    try { encodeURIComponent(value.user.name); } catch { fail(); }
    user = { id: value.user.id, name: value.user.name, avatar: image(value.user.avatar) };
  }
  const userId = value.userId === undefined || value.userId === null ? user?.id ?? null : value.userId;
  if (userId !== null && !isActivityId(userId)) fail();
  if (user && userId !== user.id) fail();
  const activity: AniListActivity = {
    id: value.id, type: value.type as AniListActivity['type'], userId, user,
    createdAt: nonnegativeInt(value.createdAt), replyCount: nonnegativeInt(value.replyCount), likeCount: nonnegativeInt(value.likeCount),
  };
  if (activity.type === 'TEXT') { activity.text = text(value.text); return activity; }
  activity.status = text(value.status);
  activity.progress = text(value.progress);
  if (value.media !== null && value.media !== undefined) {
    const media = value.media;
    if (!isRecord(media) || !isActivityId(media.id) || !isRecord(media.title)
      || media.type !== (activity.type === 'ANIME_LIST' ? 'ANIME' : 'MANGA')) fail();
    activity.media = { id: media.id, type: activity.type === 'ANIME_LIST' ? 'ANIME' : 'MANGA', title: { romaji: text(media.title.romaji) || 'Unknown' }, coverImage: image(media.coverImage) };
  }
  return activity;
}

export function activityUserIds(users: unknown): number[] {
  if (!Array.isArray(users)) fail();
  const ids = new Set<number>();
  for (const user of users) {
    if (!isRecord(user) || !isActivityId(user.id)) fail();
    ids.add(user.id);
    if (ids.size > 10000) throw new Error('Activity user filter limit exceeded');
  }
  return [...ids];
}

interface ActivityPageOptions { maxSize?: number; mediaId?: number; userIds?: readonly number[]; pageInfo?: boolean }
export function parseActivityPage(value: unknown, options: ActivityPageOptions = {}): { activities: AniListActivity[]; hasNextPage: boolean } {
  if (!isRecord(value) || !isRecord(value.Page) || !Array.isArray(value.Page.activities)
    || value.Page.activities.length > (options.maxSize ?? 50)) fail();
  let hasNextPage = false;
  if (options.pageInfo) {
    if (!isRecord(value.Page.pageInfo) || typeof value.Page.pageInfo.hasNextPage !== 'boolean') fail();
    hasNextPage = value.Page.pageInfo.hasNextPage;
  }
  const users = options.userIds && new Set(options.userIds);
  const activities: AniListActivity[] = [];
  const ids = new Set<number>();
  for (const row of value.Page.activities) {
    // [ActivityUnion] permits null tombstones; preserve pageInfo despite skipping them.
    if (row === null) continue;
    const entry = parseFeedActivity(row);
    if (ids.has(entry.id) || (options.mediaId !== undefined && entry.media?.id !== options.mediaId)
      || (users && (entry.userId === null || entry.userId === undefined || !users.has(entry.userId)))) fail();
    ids.add(entry.id); activities.push(entry);
  }
  return { activities, hasNextPage };
}
