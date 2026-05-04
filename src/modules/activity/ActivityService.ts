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
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { log } from '@core/logger';
import { ScoreFormat } from '@core/types';
import { PERFORMANCE } from '@core/constants';

/**
 * Encapsulates score value and its display format
 */
export interface ActivityScoreData {
  score: number;
  format: ScoreFormat;
}

/**
 * Service responsible for activity feed enhancements and scoring data.
 */
@injectable()
export class ActivityService {
  /** In-memory cache for activity feed scores */
  private cache: ICacheService<string, ActivityScoreData | null>;

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
   * @returns Map of "userName-mediaId" key to score data or null
   */
  public async getScoresBatch(pairs: { userName: string; mediaId: number }[]): Promise<Map<string, ActivityScoreData | null>> {
    const results = new Map<string, ActivityScoreData | null>();
    const pendingPairs: { userName: string; mediaId: number; key: string }[] = [];

    // Prioritize cache
    for (const p of pairs) {
      const key = `${p.userName}-${p.mediaId}`;
      const cached = await this.cache.get(key);
      if (cached !== undefined || await this.cache.has(key)) {
        results.set(key, cached ?? null);
      } else {
        pendingPairs.push({ ...p, key });
      }
    }

    if (pendingPairs.length === 0) return results;

    const chunkSize = PERFORMANCE.GRAPHQL_CHUNK_SIZE_ACTIVITY;
    for (let i = 0; i < pendingPairs.length; i += chunkSize) {
      const chunk = pendingPairs.slice(i, i + chunkSize);
      
      const varDecls = chunk.map((_, i) => `$u${i}: String!, $m${i}: Int!`).join(', ');
      const aliases = chunk.map((_, i) =>
        `s${i}: MediaList(userName: $u${i}, mediaId: $m${i}) { 
          score(format: POINT_100) 
          user { mediaListOptions { scoreFormat } }
        }`
      );

      const query = `query (${varDecls}) { ${aliases.join('\n')} }`;
      const variables: Record<string, unknown> = {};
      chunk.forEach((p, i) => { variables[`u${i}`] = p.userName; variables[`m${i}`] = p.mediaId; });

      try {
        const response = await this.api.query<any>(query, variables, true);
        
        for (let idx = 0; idx < chunk.length; idx++) {
          const p = chunk[idx];
          const data = response[`s${idx}`];
          const scoreData = data ? {
            score: data.score,
            format: data.user.mediaListOptions.scoreFormat
          } : null;

          await this.cache.set(p.key, scoreData);
          results.set(p.key, scoreData);
        }
      } catch (e) {
        log.error('[ActivityService] Batch fetch failed', e);
        for (const p of chunk) {
          await this.cache.set(p.key, null);
          results.set(p.key, null);
        }
      }

      if (i + chunkSize < pendingPairs.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return results;
  }

  /**
   * Fetches the activity feed entries for a specific media among people the user follows.
   * 
   * @param mediaId AniList media ID
   * @param page Current page number
   * @returns List of activities and pagination status
   */
  public async getMediaActivity(mediaId: number, page: number = 1): Promise<{ activities: any[]; hasNextPage: boolean }> {
    const query = `
      query ($mediaId: Int, $page: Int) {
        Page(page: $page, perPage: 25) {
          pageInfo { hasMorePages }
          activities(mediaId: $mediaId, isFollowing: true, sort: ID_DESC) {
            ... on ListActivity {
              id type status progress createdAt replyCount likeCount
              user { id name avatar { medium } }
              media { id title { romaji english } type coverImage { medium } }
            }
          }
        }
      }
    `;

    try {
      const response = await this.api.query<any>(query, { mediaId, page });
      return {
        activities: response.Page.activities,
        hasNextPage: response.Page.pageInfo.hasMorePages
      };
    } catch (e) {
      log.error('[ActivityService] Media activity fetch failed', e);
      return { activities: [], hasNextPage: false };
    }
  }

  /**
   * Clears the in-memory score cache.
   */
  public async clearCache(): Promise<void> {
    await this.cache.clear();
    log.info('[ActivityService] Cache cleared');
  }
}
