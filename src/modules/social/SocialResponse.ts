import { isRecord } from '@/api/GraphQLResponse';
import type { ScoreFormat } from '@/api/AnilistTypes';
import { MediaListStatus, type FriendActivity, type SocialActivityDetailed } from '@core/types';

export class SocialPaginationLimitError extends Error {
  constructor() { super('AniList pagination limit reached; incomplete results were not accepted as complete'); this.name = 'SocialPaginationLimitError'; }
}

export function isAniListId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}
export function isAniListStatus(value: unknown): value is MediaListStatus {
  return [MediaListStatus.CURRENT, MediaListStatus.PLANNING, MediaListStatus.COMPLETED,
    MediaListStatus.PAUSED, MediaListStatus.DROPPED, MediaListStatus.REPEATING].some(status => status === value);
}
function fail(): never { throw new Error('Invalid social response'); }
function nullableNumber(value: unknown, max: number, integer = true): number {
  if (value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) fail();
  return value;
}
export function parseSocialUser(value: unknown): FriendActivity['user'] {
  if (!isRecord(value) || !isAniListId(value.id) || typeof value.name !== 'string' || !value.name.trim()) fail();
  let medium = '';
  if (value.avatar !== null) {
    if (!isRecord(value.avatar) || (value.avatar.medium !== null && typeof value.avatar.medium !== 'string')) fail();
    medium = value.avatar.medium === null ? '' : value.avatar.medium as string;
  }
  return { id: value.id, name: value.name, avatar: { medium } };
}
function parseActivity(value: unknown, mediaId: number): FriendActivity {
  if (!isRecord(value) || value.mediaId !== mediaId || !isAniListStatus(value.status)) fail();
  const user = parseSocialUser(value.user);
  if (value.userId !== user.id) fail();
  return { id: user.id, user, status: value.status, progress: nullableNumber(value.progress, 2147483647), score: nullableNumber(value.score, 100, false) };
}
function parsePage(value: unknown, field: 'mediaList' | 'following' | 'followers', max: number): { rows: unknown[]; hasNextPage: boolean } {
  if (!isRecord(value) || !isRecord(value.Page) || !isRecord(value.Page.pageInfo)
    || typeof value.Page.pageInfo.hasNextPage !== 'boolean' || !Array.isArray(value.Page[field]) || value.Page[field].length > max) fail();
  return { rows: value.Page[field] as unknown[], hasNextPage: value.Page.pageInfo.hasNextPage };
}
export function parseFriendActivity(value: unknown, mediaId: number): FriendActivity[] {
  if (!isRecord(value) || !Array.isArray(value.mediaList) || value.mediaList.length > 6) fail();
  return value.mediaList.map((entry: unknown) => parseActivity(entry, mediaId));
}
export function parseFollowingPage(value: unknown, relation: 'following' | 'followers' = 'following'): { nodes: FriendActivity['user'][]; hasNextPage: boolean } {
  const page = parsePage(value, relation, 50);
  return { nodes: page.rows.map(parseSocialUser), hasNextPage: page.hasNextPage };
}
const formats: readonly ScoreFormat[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'];
export function parseDetailedActivity(value: unknown, mediaId: number, maxPageSize = 30): { nodes: SocialActivityDetailed[]; hasNextPage: boolean } {
  const page = parsePage(value, 'mediaList', maxPageSize);
  const nodes = page.rows.map(entry => {
    if (!isRecord(entry) || !isAniListId(entry.id) || (entry.notes !== null && typeof entry.notes !== 'string')) fail();
    const activity = parseActivity(entry, mediaId);
    if (!isRecord(entry.user)) fail();
    let scoreFormat: ScoreFormat = 'POINT_100';
    if (entry.user.mediaListOptions !== null) {
      const options = entry.user.mediaListOptions;
      if (!isRecord(options) || (options.scoreFormat !== null && !formats.some(format => format === options.scoreFormat))) fail();
      if (options.scoreFormat !== null) scoreFormat = options.scoreFormat as ScoreFormat;
    }
    return { ...activity, id: entry.id, notes: entry.notes, updatedAt: nullableNumber(entry.updatedAt, 2147483647),
      user: { ...activity.user, mediaListOptions: { scoreFormat } } };
  });
  return { nodes, hasNextPage: page.hasNextPage };
}
