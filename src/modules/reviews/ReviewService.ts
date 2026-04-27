/**
 * @file ReviewService.ts
 * @description Review data fetching with GraphQL alias batching and intelligent caching
 *
 * Fetches review scores and ratings in batches via GraphQL alias queries,
 * caches results in memory with LRU eviction and TTL expiration.
 *
 * Caching:
 *   - In-memory cache keyed by review ID
 *   - LRU eviction (max 200 entries)
 *   - TTL 30 minutes
 *   - Manual invalidation via clearCache()
 *
 * @see ReviewEnhancerModule.ts for the UI integration and fingerprint-based batching
 * @see docs/MODULES.md#11-review-enhancer-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';

export interface ReviewData {
  id: number;
  score: number;
  summary: string;
  body: string;
  rating: number;
  ratingAmount: number;
  user: {
    id: number;
    name: string;
  };
  media: {
    id: number;
    title: {
      romaji: string;
      english: string | null;
    };
  };
}

@injectable()
export class ReviewService {
  private reviewCache: Map<number, ReviewData> = new Map();

  /** Intelligent Caching: LRU eviction to prevent unbounded growth */
  private readonly MAX_CACHE_SIZE = 200;
  private cacheOrder: number[] = []; // LRU tracking

  /** Intelligent Caching: TTL for stale data invalidation */
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private cacheTimestamps: Map<number, number> = new Map();

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {}

  /**
   * Get multiple reviews via GraphQL Alias Batching
   * Very robust for AniList rate limits with smart delay between chunks
   */
  public async getReviewBatch(ids: number[], chunkSize: number = 50): Promise<ReviewData[]> {
    if (ids.length === 0) return [];

    const results: ReviewData[] = [];
    const pendingIds = ids.filter(id => {
      const cached = this.getCachedReview(id);
      if (cached !== undefined) {
        results.push(cached);
        return false;
      }
      return true;
    });

    if (pendingIds.length === 0) return results;

    const totalChunks = Math.ceil(pendingIds.length / chunkSize);
    log.info(`%c[ReviewService] 📦 Processing ${pendingIds.length} reviews in ${totalChunks} chunk(s)`, 'color: #3db4f2; font-weight: bold;');

    // Process in chunks to avoid too large query strings
    for (let i = 0; i < pendingIds.length; i += chunkSize) {
      const chunk = pendingIds.slice(i, i + chunkSize);
      const chunkIndex = Math.floor(i / chunkSize) + 1;

      const fields = `
        id
        score
        summary
        body(asHtml: false)
        rating
        ratingAmount
        user { id name }
        media { id title { romaji english } }
      `;

      const aliasParts = chunk.map(id => `r${id}: Review(id: ${id}) { ${fields} }`);
      const query = `query { ${aliasParts.join('\n')} }`;

      log.info(`%c[ReviewService] 🚀 Batch ${chunkIndex}/${totalChunks}: Fetching ${chunk.length} reviews`, 'color: #3db4f2; font-weight: bold;');

      try {
        const response = await this.apiClient.query<Record<string, ReviewData>>(query, {}, true);

        if (response) {
          const responseEntries = Object.entries(response);
          const successCount = responseEntries.filter(([_, review]) => review && review.id).length;
          const failedCount = responseEntries.length - successCount;

          responseEntries.forEach(([alias, review]) => {
            if (review && review.id) {
              this.setCachedReview(review.id, review);
              results.push(review);
            } else {
              const reviewId = alias.replace('r', '');
              log.warn(`%c[ReviewService] ⚠️ Review ${reviewId} not accessible (deleted/private)`, 'color: #ff9800;');
            }
          });

          if (failedCount > 0) {
            log.info(`%c[ReviewService] 📊 Batch ${chunkIndex}: ${successCount} OK, ${failedCount} failed`, 'color: #ff9800; font-weight: bold;');
          }
        }
      } catch (error) {
        log.error(`ReviewService: Failed to fetch alias batch ${chunkIndex}/${totalChunks}`, error);
      }

      // Rate limit protection: wait 900ms between chunks
      if (i + chunkSize < pendingIds.length) {
        log.info(`%c[ReviewService] ⏳ Waiting 900ms before next chunk...`, 'color: #ff9800; font-style: italic;');
        await new Promise(r => setTimeout(r, 900));
      }
    }

    log.info(`%c[ReviewService] ✅ Completed: ${results.length} reviews fetched successfully`, 'color: #46d369; font-weight: bold;');
    return results;
  }

  /**
   * Get review by ID (Singular)
   */
  public async getReview(reviewId: number): Promise<ReviewData | null> {
    const cached = this.getCachedReview(reviewId);
    if (cached !== undefined) {
      return cached;
    }

    const results = await this.getReviewBatch([reviewId]);
    return results.length > 0 ? results[0] : null;
  }

  public clearCache(): void {
    const size = this.reviewCache.size;
    if (size > 0) {
      this.reviewCache.clear();
      this.cacheTimestamps.clear();
      this.cacheOrder = [];
      log.info(`[ReviewService] Cache cleared (${size} entries)`);
    }
  }

  // ─── LRU Cache Helpers with TTL ────────────────────────────────────────────

  /**
   * Get from cache with LRU tracking and TTL validation
   * @returns cached review or undefined if not found or expired
   */
  private getCachedReview(id: number): ReviewData | undefined {
    if (!this.reviewCache.has(id)) return undefined;

    // Check if entry is still fresh
    const timestamp = this.cacheTimestamps.get(id);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      // Expired - evict and return undefined
      this.reviewCache.delete(id);
      this.cacheTimestamps.delete(id);
      this.cacheOrder = this.cacheOrder.filter(k => k !== id);
      log.debug(`[ReviewService] Cache expired for review ${id}`);
      return undefined;
    }

    // Move to end (most recently used)
    this.cacheOrder = this.cacheOrder.filter(k => k !== id);
    this.cacheOrder.push(id);

    return this.reviewCache.get(id)!;
  }

  /**
   * Set cache with LRU eviction and TTL tracking
   */
  private setCachedReview(id: number, data: ReviewData): void {
    // Evict oldest if at capacity
    if (this.reviewCache.size >= this.MAX_CACHE_SIZE && !this.reviewCache.has(id)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.reviewCache.delete(oldest);
        this.cacheTimestamps.delete(oldest);
        log.debug(`[ReviewService] LRU evicted review ${oldest} (cache size: ${this.reviewCache.size})`);
      }
    }

    this.reviewCache.set(id, data);
    this.cacheTimestamps.set(id, Date.now());

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(k => k !== id);
    this.cacheOrder.push(id);
  }
}
