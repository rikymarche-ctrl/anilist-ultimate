import type { AniListUser, ScoreFormat } from './AnilistTypes';
import type { ApiContext } from '@core/interfaces/IApiClient';
import { isRecord } from './GraphQLResponse';
import { parseWebUrl } from '@core/utils/WebUrl';

export const VIEWER_QUERY = 'query { Viewer { id name avatar { medium } options { titleLanguage } mediaListOptions { scoreFormat rowOrder } } }';
const languages = new Set(['ROMAJI', 'ENGLISH', 'NATIVE', 'ROMAJI_STYLISED', 'ENGLISH_STYLISED', 'NATIVE_STYLISED']);
const formats = new Set<ScoreFormat>(['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3']);
const invalid = (): never => { throw new Error('Invalid Viewer response'); };
function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  return invalid();
}

/** Project only queried fields. Missing fields indicate an incomplete response;
 * explicit GraphQL nulls become the existing consumer's absent/empty values. */
export function viewerResponse(value: unknown, expectedUserId: number | null = null): AniListUser {
  if (!isRecord(value) || !isRecord(value.Viewer)) return invalid();
  const viewer = value.Viewer;
  if (typeof viewer.id !== 'number' || !Number.isInteger(viewer.id) || viewer.id <= 0 || viewer.id > 2147483647
    || (expectedUserId !== null && viewer.id !== expectedUserId)
    || typeof viewer.name !== 'string' || !viewer.name.trim()) return invalid();
  let medium = '';
  if (viewer.avatar !== null) {
    if (!isRecord(viewer.avatar)) return invalid();
    medium = nullableString(viewer.avatar.medium) ?? '';
    if (medium && !parseWebUrl(medium)) return invalid();
  }
  const projected: AniListUser = { id: viewer.id, name: viewer.name, avatar: { medium } };
  if (viewer.options !== null) {
    if (!isRecord(viewer.options)) return invalid();
    const language = nullableString(viewer.options.titleLanguage);
    if (language !== null) {
      if (!languages.has(language)) return invalid();
      projected.options = { titleLanguage: language };
    }
  }
  if (viewer.mediaListOptions !== null) {
    if (!isRecord(viewer.mediaListOptions)) return invalid();
    const format = nullableString(viewer.mediaListOptions.scoreFormat);
    const rowOrder = nullableString(viewer.mediaListOptions.rowOrder) ?? '';
    if (format !== null) {
      if (!formats.has(format as ScoreFormat)) return invalid();
      projected.mediaListOptions = { scoreFormat: format as ScoreFormat, rowOrder };
    }
  }
  return projected;
}

export interface ViewerCache { context: ApiContext; user: AniListUser; }
export function sameViewerContext(first: ApiContext, second: ApiContext): boolean {
  return first.sessionId === second.sessionId && first.userId === second.userId;
}
