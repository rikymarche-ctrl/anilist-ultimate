import { isRecord, parseGraphQLErrors } from '@/api/GraphQLResponse';
import { isActivityId as isReviewId } from '@/modules/activity/ActivityResponse';
import type { ReviewData } from './ReviewService';

export { isReviewId };
const INT_MAX = 2147483647;
const SCORE_MAX = 100;
/** The rating badge renders only the score, so the batch never fetches bodies, authors or media. */
const REVIEW_BADGE_FIELDS = 'id score';
function fail(): never { throw new Error('Invalid review response'); }
function nullableCount(value: unknown, max = INT_MAX): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) fail();
  return value;
}

/** Project exactly the badge fields. Null reviews and null scores cannot produce a rating badge. */
export function parseReview(value: unknown, requestedId: number): ReviewData | undefined {
  if (!isReviewId(requestedId)) fail();
  if (value === null) return undefined;
  if (!isRecord(value) || value.id !== requestedId) fail();
  const score = nullableCount(value.score, SCORE_MAX);
  if (score === null) return undefined;
  return { id: requestedId, score };
}

/** Validate all requested aliases before any publication; errors never become cacheable data. */
export function parseReviewBatch(value: unknown, ids: readonly number[]): ReviewData[] {
  if (!isRecord(value) || ids.some(id => !isReviewId(id)) || new Set(ids).size !== ids.length) fail();
  const errors = parseGraphQLErrors(value.errors);
  const aliases = new Set(ids.map(id => `r${id}`));
  if (errors?.some(error => error.path?.length && !aliases.has(String(error.path[0])))) fail();
  if (value.data === null || value.data === undefined) {
    if (errors?.length) return [];
    fail();
  }
  if (!isRecord(value.data) || Object.keys(value.data).length !== ids.length
    || Object.keys(value.data).some(alias => !aliases.has(alias))) fail();
  const data = value.data;
  const reviews: ReviewData[] = [];
  for (const id of ids) {
    const alias = `r${id}`;
    if (!Object.prototype.hasOwnProperty.call(data, alias)) fail();
    if (errors?.some(error => !error.path?.length || error.path[0] === alias)) continue;
    const review = parseReview(data[alias], id);
    if (review) reviews.push(review);
  }
  return reviews;
}

export function reviewBatchQuery(ids: readonly number[]): { query: string; variables: Record<string, number> } {
  if (!ids.length || ids.some(id => !isReviewId(id)) || new Set(ids).size !== ids.length) fail();
  const variables = Object.fromEntries(ids.map(id => [`id${id}`, id]));
  return { variables, query: `query ReviewBatch(${ids.map(id => `$id${id}: Int!`).join(', ')}) {
    ${ids.map(id => `r${id}: Review(id: $id${id}) { ${REVIEW_BADGE_FIELDS} }`).join('\n')}
  }` };
}
