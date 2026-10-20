import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { MediaListStatus, type ScoreFormat } from '@core/types';
import { isRecord } from '@/api/GraphQLResponse';
import { isAniListId } from './SocialResponse';

export interface FollowingMediaEntry {
  userId: number;
  name: string;
  avatar: string;
  status: MediaListStatus;
  /** Raw 0-100 score, or null when the user has not scored the title. */
  score: number | null;
}
export interface FollowingMediaResult {
  entries: FollowingMediaEntry[];
  scoreFormat: ScoreFormat;
}

/** Score stays raw (POINT_100) and is formatted with the viewer's own format, as SocialService does. */
export const FOLLOWING_MEDIA_QUERY = `query ($mediaId: Int) {
  Page(perPage: 50) {
    mediaList(mediaId: $mediaId, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
      status score(format: POINT_100) user { id name avatar { large } }
    }
  }
}`;
const MAX_ENTRIES = 50;
const STATUSES = new Set<string>(Object.values(MediaListStatus));
const SCORE_FORMATS = new Set<string>([
  'POINT_100',
  'POINT_10_DECIMAL',
  'POINT_10',
  'POINT_5',
  'POINT_3',
]);

const httpsUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
};

/** Drops malformed entries individually, so one bad row never hides the rest. */
function parseEntry(value: unknown): FollowingMediaEntry | null {
  if (!isRecord(value) || typeof value.status !== 'string' || !STATUSES.has(value.status))
    return null;
  const user = isRecord(value.user) ? value.user : null;
  if (!user || !isAniListId(user.id) || typeof user.name !== 'string') return null;
  if (!user.name.trim() || user.name.length > 100) return null;
  const raw = value.score;
  if (raw !== null && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 100))
    return null;
  const avatar = isRecord(user.avatar) ? httpsUrl(user.avatar.large) : '';
  return {
    userId: Number(user.id),
    name: user.name,
    avatar,
    status: value.status as MediaListStatus,
    score: raw,
  };
}

export function parseFollowingMedia(response: unknown): FollowingMediaEntry[] {
  const page = isRecord(response) && isRecord(response.Page) ? response.Page : response;
  const list = isRecord(page) && Array.isArray(page.mediaList) ? page.mediaList : null;
  if (!list) throw new Error('Invalid following media response');
  const byUser = new Map<number, FollowingMediaEntry>();
  for (const item of list.slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(item);
    if (entry && !byUser.has(entry.userId)) byUser.set(entry.userId, entry);
  }
  return [...byUser.values()];
}

/** Background read for the Overview: the viewer's followings for one title. Never a priority request. */
@injectable()
export class FollowingMediaReader {
  constructor(@inject(TOKENS.ApiClient) private api: IApiClient) {}

  async read(mediaId: number): Promise<FollowingMediaResult> {
    if (!isAniListId(mediaId)) throw new Error('Invalid media id');
    const [response, viewer] = await Promise.all([
      this.api.query<unknown>(FOLLOWING_MEDIA_QUERY, { mediaId }, true, { priority: false }),
      this.api.getCurrentUser(),
    ]);
    const format = String(viewer.mediaListOptions?.scoreFormat);
    return {
      entries: parseFollowingMedia(response),
      scoreFormat: (SCORE_FORMATS.has(format) ? format : 'POINT_100') as ScoreFormat,
    };
  }
}
