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

export interface ActivityScoreData {
  score: number;
  format: ScoreFormat;
}

@injectable()
@singleton()
export class ActivityService {
  private scoreCache: Map<string, ActivityScoreData | null> = new Map(); // key: "userName-mediaId"

  /** Intelligent Caching: LRU eviction to prevent unbounded growth */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: string[] = []; // LRU tracking

  /** Intelligent Caching: TTL for stale data invalidation */
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cacheTimestamps: Map<string, number> = new Map();

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
      const cached = this.getCachedScore(key);
      if (cached !== undefined) {
        results.set(key, cached);
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
        const response = await this.api.query<Record<string, { score: number; user: { mediaListOptions: { scoreFormat: ScoreFormat } } } | null>>(query, variables, true);
        
        chunk.forEach((p, idx) => {
          const data = response[`s${idx}`];
          const scoreData = data ? {
            score: data.score,
            format: data.user.mediaListOptions.scoreFormat
          } : null;

          this.setCachedScore(p.key, scoreData);
          results.set(p.key, scoreData);
        });
      } catch (e) {
        log.error('[ActivityService] Batch fetch failed', e);
        // Mark as null to avoid spamming failed requests
        chunk.forEach(p => {
          this.setCachedScore(p.key, null);
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

  // ─── LRU Cache Helpers with TTL ────────────────────────────────────────────

  /**
   * Get from cache with LRU tracking and TTL validation
   * @returns cached data or undefined if not found or expired
   */
  private getCachedScore(key: string): ActivityScoreData | null | undefined {
    if (!this.scoreCache.has(key)) return undefined;

    // Check if entry is still fresh
    const timestamp = this.cacheTimestamps.get(key);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      // Expired - evict and return undefined
      this.scoreCache.delete(key);
      this.cacheTimestamps.delete(key);
      this.cacheOrder = this.cacheOrder.filter(k => k !== key);
      log.debug(`[ActivityService] Cache expired for ${key}`);
      return undefined;
    }

    // Move to end (most recently used)
    this.cacheOrder = this.cacheOrder.filter(k => k !== key);
    this.cacheOrder.push(key);

    return this.scoreCache.get(key)!;
  }

  /**
   * Set cache with LRU eviction and TTL tracking
   */
  private setCachedScore(key: string, data: ActivityScoreData | null): void {
    // Evict oldest if at capacity
    if (this.scoreCache.size >= this.MAX_CACHE_SIZE && !this.scoreCache.has(key)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.scoreCache.delete(oldest);
        this.cacheTimestamps.delete(oldest);
        log.debug(`[ActivityService] LRU evicted ${oldest} (cache size: ${this.scoreCache.size})`);
      }
    }

    this.scoreCache.set(key, data);
    this.cacheTimestamps.set(key, Date.now());

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(k => k !== key);
    this.cacheOrder.push(key);
  }

  /**
   * Manually clear the score cache
   * Useful when user manually refreshes data or changes following list
   */
  public clearCache(): void {
    const size = this.scoreCache.size;
    if (size > 0) {
      this.scoreCache.clear();
      this.cacheTimestamps.clear();
      this.cacheOrder = [];
      log.info(`[ActivityService] Cache manually cleared (${size} entries)`);
    }
  }
}
