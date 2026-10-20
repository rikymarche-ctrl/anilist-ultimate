/**
 * @file ActivityService.ts
 * @description Enterprise service for fetching activity-related metadata and scores.
 *
 * Implements high-performance caching for user scores on the activity feed
 * and optimizes network traffic via GraphQL alias batching.
 *
 * CACHING:
 * - ScoreCache: Short-lived (5m) in-memory cache for user-media score pairs.
 *   Prevents redundant API calls when scrolling the activity feed.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { logger } from '@core/logger';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { isRecord, type GraphQLError, type GraphQLResponse } from '@/api/GraphQLResponse';
import { PERFORMANCE } from '@core/constants';
import type { AniListActivity } from './ActivityUtils';
import { isActivityId, parseActivityPage } from './ActivityResponse';
import { parseActivityScore, snapshotScorePairs } from './ActivityScoreResponse';
import type { ActivityScoreData, ActivityScorePair } from './ActivityScoreResponse';
export type { ActivityScoreData } from './ActivityScoreResponse';

interface ScoreScope { revision: number; context: ApiContext | undefined; }
type ScoreResult = ActivityScoreData | null | undefined;
interface PendingScore extends ActivityScorePair {
  cacheKey: string;
  promise: Promise<ScoreResult>;
  resolve: (result: ScoreResult) => void;
}

/** AniList reports a hidden or missing list entry as a null alias with a 403/404 error. */
const ABSENT_ENTRY_STATUSES: ReadonlySet<number> = new Set([403, 404]);

function aliasOf(error: GraphQLError): string | undefined {
  const head = error.path?.[0];
  return typeof head === 'string' ? head : undefined;
}

/**
 * Per-alias outcome for a score chunk: a score or confirmed absence (null) is
 * cacheable, while undefined means the lookup must be retried later.
 */
function readAliasScores(response: GraphQLResponse<unknown>, chunk: readonly ActivityScorePair[]): (ActivityScoreData | null | undefined)[] {
  const aliases = new Set(chunk.map((_, index) => `s${index}`));
  const errors = response.errors ?? [];
  // An error that is not scoped to one of our aliases makes the whole response untrustworthy.
  if (errors.some(error => !aliases.has(aliasOf(error) ?? ''))) return chunk.map(() => undefined);
  const data = response.data;
  return chunk.map((pair, index) => {
    const alias = `s${index}`;
    if (!isRecord(data) || !Object.prototype.hasOwnProperty.call(data, alias)) return undefined;
    const entry = data[alias];
    const aliasErrors = errors.filter(error => aliasOf(error) === alias);
    if (entry === null && !aliasErrors.every(error => error.status !== undefined && ABSENT_ENTRY_STATUSES.has(error.status))) return undefined;
    return parseActivityScore(entry, pair);
  });
}

/**
 * Service responsible for activity feed enhancements and scoring data.
 */
@injectable()
export class ActivityService {
  /** In-memory cache for activity feed scores */
  private cache: ICacheService<string, ActivityScoreData | null>;
  private scoreRevision = 0;
  private inFlight = new Map<string, Promise<ScoreResult>>();

  /** Cache configuration constants */
  private readonly CACHE_CONFIG = {
    namespace: 'activity_scores',
    maxSize: 100,
    ttlMs: 5 * 60 * 1000, // 5 minutes
    persistent: false // Short-lived data doesn't need disk persistence
  };

  /**
   * @param api Injected AniList API client
   * @param cacheFactory Factory to create isolated cache instances
   */
  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(CacheFactory) cacheFactory: CacheFactory
  ) {
    this.cache = cacheFactory.create<string, ActivityScoreData | null>(this.CACHE_CONFIG);
  }

  /**
   * Fetches scores for a batch of user-media pairs.
   * Optimizes API usage using GraphQL alias batching.
   *
   * @param pairs Array of userName and mediaId pairs to query
   * @returns Map of "userName-mediaId" key to score data or confirmed absence (null).
   * Failed lookups are omitted so callers can retry them.
   */
  public async getScoresBatch(pairs: readonly { userName: string; mediaId: number }[]): Promise<Map<string, ActivityScoreData | null>> {
    const requested = snapshotScorePairs(pairs);
    const revision = this.scoreRevision;
    const context = await captureApiContext(this.api);
    const scope: ScoreScope = { revision, context: context ? { ...context } : undefined };
    this.assertScoreScope(scope);
    const results = new Map<string, ActivityScoreData | null>();
    const misses: (ActivityScorePair & { cacheKey: string })[] = [];
    for (const pair of requested) {
      const cacheKey = JSON.stringify([revision, scope.context?.sessionId ?? null, scope.context?.userId ?? null, pair.userName, pair.mediaId]);
      const cached = await this.cache.get(cacheKey);
      this.assertScoreScope(scope);
      if (cached !== undefined) results.set(pair.key, cached ? { ...cached } : null);
      else misses.push({ ...pair, cacheKey });
    }
    const pending: PendingScore[] = [];
    const lookups = misses.map(pair => {
      let promise = this.inFlight.get(pair.cacheKey);
      if (!promise) {
        let resolve!: PendingScore['resolve'];
        promise = new Promise<ScoreResult>(done => { resolve = done; });
        this.inFlight.set(pair.cacheKey, promise);
        pending.push({ ...pair, promise, resolve });
      }
      return { key: pair.key, promise };
    });
    if (pending.length) void this.fetchScores(pending, scope);
    for (const lookup of lookups) {
      const result = await lookup.promise;
      this.assertScoreScope(scope);
      if (result !== undefined) results.set(lookup.key, result ? { ...result } : null);
    }
    this.assertScoreScope(scope);
    return results;
  }

  private assertScoreScope(scope: ScoreScope): void {
    assertApiContext(this.api, scope.context);
    if (scope.revision !== this.scoreRevision) throw new Error('Activity score cache changed');
  }

  /** Each missing pair has one shared lookup, including overlaps between batches. */
  private async fetchScores(pairs: PendingScore[], scope: ScoreScope): Promise<void> {
    const chunkSize = PERFORMANCE.GRAPHQL_CHUNK_SIZE_ACTIVITY;
    try {
      for (let i = 0; i < pairs.length; i += chunkSize) {
        this.assertScoreScope(scope);
        const chunk = pairs.slice(i, i + chunkSize);

        const varDecls = chunk.map((_, i) => `$u${i}: String!, $m${i}: Int!`).join(', ');
        const aliases = chunk.map((_, i) =>
          `s${i}: MediaList(userName: $u${i}, mediaId: $m${i}) {
            mediaId userId
            score(format: POINT_100)
            user { id name mediaListOptions { scoreFormat } }
          }`
        );

        const query = `query (${varDecls}) { ${aliases.join('\n')} }`;
        const variables: Record<string, unknown> = {};
        chunk.forEach((p, i) => { variables[`u${i}`] = p.userName; variables[`m${i}`] = p.mediaId; });

        try {
          // queryRaw keeps per-alias errors: one hidden or deleted entry must not reject its whole chunk.
          const response = await this.api.queryRaw<unknown>(query, variables);
          this.assertScoreScope(scope);
          const outcomes = readAliasScores(response, chunk);

          for (let idx = 0; idx < chunk.length; idx++) {
            const p = chunk[idx];
            const scoreData = outcomes[idx];
            if (scoreData === undefined) continue;
            this.assertScoreScope(scope);
            try { await this.cache.set(p.cacheKey, scoreData ? { ...scoreData } : null); }
            catch (error) { logger.error('[ActivityService] Score cache write failed', error); }
            try { this.assertScoreScope(scope); }
            catch (error) {
              // A write may have yielded across clear/auth invalidation. Its scoped
              // key cannot be read by the new session; remove the stale bytes too.
              await this.cache.delete(p.cacheKey).catch(failure => logger.error('[ActivityService] Obsolete score removal failed', failure));
              throw error;
            }
            p.resolve(scoreData);
          }
        } catch (e) {
          logger.error('[ActivityService] Batch fetch failed', e);
          // A transient error is not evidence that the user has no rating.
          // Leave these keys uncached so the next scan can recover.
        }

        this.assertScoreScope(scope);
        if (i + chunkSize < pairs.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (error) {
      logger.debug('[ActivityService] Score batch invalidated', error);
    } finally {
      for (const pair of pairs) {
        pair.resolve(undefined);
        if (this.inFlight.get(pair.cacheKey) === pair.promise) this.inFlight.delete(pair.cacheKey);
      }
    }
  }

  /**
   * Fetches the activity feed entries for a specific media among people the user follows.
   *
   * @param mediaId AniList media ID
   * @param page Current page number
   * @returns List of activities and pagination status
   */
  public async getMediaActivity(mediaId: number, page: number = 1): Promise<{ activities: AniListActivity[]; hasNextPage: boolean }> {
    if (!isActivityId(mediaId) || !Number.isInteger(page) || page <= 0 || page > 200) {
      throw new Error('Invalid media activity pagination');
    }
    const context = await captureApiContext(this.api);
    const query = `
      query ($mediaId: Int, $page: Int) {
        Page(page: $page, perPage: 25) {
          pageInfo { hasNextPage }
          activities(mediaId: $mediaId, type: MEDIA_LIST, isFollowing: true, sort: ID_DESC) {
            ... on ListActivity {
              id type userId status progress createdAt replyCount likeCount
              user { id name avatar { medium } }
              media { id title { romaji english } type coverImage { medium } }
            }
          }
        }
      }
    `;

    assertApiContext(this.api, context);
    const response = await this.api.query<unknown>(query, { mediaId, page });
    assertApiContext(this.api, context);
    return parseActivityPage(response, { maxSize: 25, mediaId, pageInfo: true });
  }

  /**
   * Clears the in-memory score cache.
   */
  public async clearCache(): Promise<void> {
    this.scoreRevision++;
    this.inFlight.clear();
    await this.cache.clear();
    logger.info('[ActivityService] Cache cleared');
  }
}
