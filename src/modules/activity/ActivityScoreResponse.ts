import { isRecord } from '@/api/GraphQLResponse';
import type { ScoreFormat } from '@core/types';
import { isActivityId } from './ActivityResponse';

export interface ActivityScoreData { score: number; format: ScoreFormat; }
export interface ActivityScorePair { userName: string; mediaId: number; key: string; }
const FORMATS: readonly ScoreFormat[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'];

/** Capture caller-owned data before any asynchronous context/cache lookup. */
export function snapshotScorePairs(value: unknown): ActivityScorePair[] {
  if (!Array.isArray(value)) throw new Error('Invalid activity score request');
  const unique = new Map<string, ActivityScorePair>();
  for (const pair of value) {
    if (!isRecord(pair) || typeof pair.userName !== 'string' || !pair.userName.trim() || !isActivityId(pair.mediaId)) {
      throw new Error('Invalid activity score request');
    }
    try { encodeURIComponent(pair.userName); } catch { throw new Error('Invalid activity score request'); }
    const key = `${pair.userName}-${pair.mediaId}`;
    unique.set(key, { userName: pair.userName, mediaId: pair.mediaId, key });
  }
  return [...unique.values()];
}

/** Undefined means an untrustworthy lookup; only an explicit null confirms absence. */
export function parseActivityScore(value: unknown, pair: ActivityScorePair): ActivityScoreData | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.mediaId !== pair.mediaId || !isActivityId(value.userId)
    || typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 100) return undefined;
  let format: ScoreFormat = 'POINT_100';
  if (value.user !== null) {
    if (!isRecord(value.user) || value.user.id !== value.userId || typeof value.user.name !== 'string'
      || value.user.name.toLowerCase() !== pair.userName.toLowerCase()) return undefined;
    const options = value.user.mediaListOptions;
    if (options !== null) {
      if (!isRecord(options)) return undefined;
      if (options.scoreFormat !== null) {
        const known = FORMATS.find(item => item === options.scoreFormat);
        if (!known) return undefined;
        format = known;
      }
    }
  }
  return { score: value.score, format };
}
