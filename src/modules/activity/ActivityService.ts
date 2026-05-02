/**
 * @file ActivityService.ts
 * @description Batched user score fetching for activity feed entries
 *
 * When users update anime/manga progress in their activity feed, this service
 * fetches their scores for the corresponding media. Uses GraphQL alias batching
 * to fetch multiple user-media pairs in a single request (up to 25 per chunk).
 *
 * Caching:
 *   - In-memory cache keyed by "userName-mediaId"
 *   - LRU eviction (max 100 entries)
 *   - TTL 5 minutes
 *   - Failed fetches are cached as null to avoid retry spam
 *
 * @security GraphQL injection risk resolved: userName and mediaId are now passed
 *           as typed variables, not interpolated into query strings. See BUG-002.
 *
 * @see docs/MODULES.md#4-activity-score-module
 */
import { injectable, singleton, inject } from 'tsyringe';

import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';

import { ScoreFormat } from '@core/types';
import { PERFORMANCE } from '@core/constants';

import { LRUCacheWithTTL } from '@core/cache/LRUCacheWithTTL';

export interface ActivityScoreData {
  score: number;
  format: ScoreFormat;
}

@injectable()
@singleton()
export class ActivityService {
  private scoreCache = new LRUCacheWithTTL<string, ActivityScoreData | null>({
    maxSize: 100,
    ttlMs: 5 * 60 * 1000 // 5 minutes
  });

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  /**
   * Fetch scores for a batch of User-Media pairs
   */
  public async getScoresBatch(pairs: { userName: string; mediaId: number }[]): Promise<Map<string, ActivityScoreData | null>> {
    const results = new Map<string, ActivityScoreData | null>();
    const pendingPairs: { userName: string; mediaId: number; key: string }[] = [];

    pairs.forEach(p => {
      const key = `${p.userName}-${p.mediaId}`;
      const cached = this.scoreCache.get(key);
      if (cached !== undefined || this.scoreCache.has(key)) {
        results.set(key, cached !== undefined ? cached : null);
      } else {
        pendingPairs.push({ ...p, key });
      }
    });

    if (pendingPairs.length === 0) return results;

    // AniList Alias Batching (Max ~50 per request to be safe)
    const chunkSize = PERFORMANCE.GRAPHQL_CHUNK_SIZE_ACTIVITY;
    for (let i = 0; i < pendingPairs.length; i += chunkSize) {
      const chunk = pendingPairs.slice(i, i + chunkSize);
      
      // Build query using GraphQL variables (prevents injection via usernames)
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
        interface ActivityBatchResponse {
          [key: string]: {
            score: number;
            user: {
              mediaListOptions: {
                scoreFormat: ScoreFormat;
              };
            };
          } | null;
        }

        const response = await this.api.query<ActivityBatchResponse>(query, variables, true);
        
        chunk.forEach((p, idx) => {
          const data = response[`s${idx}`];
          const scoreData = data ? {
            score: data.score,
            format: data.user.mediaListOptions.scoreFormat
          } : null;

          this.scoreCache.set(p.key, scoreData);
          results.set(p.key, scoreData);
        });
      } catch (e) {
        log.error('[ActivityService] Batch fetch failed', e);
        // Mark as null to avoid spamming failed requests
        chunk.forEach(p => {
          this.scoreCache.set(p.key, null);
          results.set(p.key, null);
        });
      }

      // Small delay between chunks if multiple
      if (i + chunkSize < pendingPairs.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return results;
  }

  /**
   * Manually clear the score cache
   * Useful when user manually refreshes data or changes following list
   */
  public clearCache(): void {
    const size = this.scoreCache.size;
    if (size > 0) {
      this.scoreCache.clear();
      log.info(`[ActivityService] Cache manually cleared (${size} entries)`);
    }
  }
}
