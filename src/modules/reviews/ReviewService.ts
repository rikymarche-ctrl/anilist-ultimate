/**
 * @file ReviewService.ts
 * @description Enterprise service for fetching and caching AniList reviews.
 * 
 * Implements high-performance caching using the centralized CacheService and
 * optimizes API usage through GraphQL alias batching.
 *
 * @see docs/ARCHITECTURE.md#51-caching-strategy
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { log } from '@core/logger';

/**
 * Structure of review data returned from AniList API
 */
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

/**
 * Service responsible for review data management.
 * Orchestrates API fetching and persistent caching.
 */
@injectable()
export class ReviewService {
  /** Centralized persistent cache instance for reviews */
  private cache: ICacheService<number, ReviewData>;

  /** Cache configuration constants */
  private readonly CACHE_CONFIG = {
    namespace: 'reviews',
    maxSize: 500,
    ttlMs: 24 * 60 * 60 * 1000 // 24 hours
  };

  /**
   * @param apiClient Injected AniList API client
   * @param cacheFactory Factory to create isolated cache instances
   */
  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(CacheFactory) cacheFactory: CacheFactory
  ) {
    this.cache = cacheFactory.create<number, ReviewData>(this.CACHE_CONFIG);
  }

  /**
   * Retrieves multiple reviews in optimized batches.
   * Uses a 'stale-while-revalidate' approach: if API fails, it falls back to cached data.
   * 
   * @param ids Array of AniList review IDs
   * @param chunkSize Number of reviews per GraphQL alias batch
   * @returns Promise resolving to an array of ReviewData
   */
  public async getReviewBatch(ids: number[], chunkSize: number = 50): Promise<ReviewData[]> {
    if (ids.length === 0) return [];
    
    const results: ReviewData[] = [];
    const pendingIds: number[] = [];

    // Filter out items already in cache
    for (const id of ids) {
      const cached = await this.cache.get(id);
      if (cached) {
        results.push(cached);
      } else {
        pendingIds.push(id);
      }
    }

    if (pendingIds.length === 0) return results;

    const totalChunks = Math.ceil(pendingIds.length / chunkSize);
    log.info(`%c[ReviewService] 📦 Batching ${pendingIds.length} reviews into ${totalChunks} chunk(s)`, 'color: #3db4f2; font-weight: bold;');

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

      log.info(`%c[ReviewService] 🚀 Fetching chunk ${chunkIndex}/${totalChunks}`, 'color: #3db4f2;');

      try {
        const response = await this.apiClient.query<Record<string, ReviewData>>(query, {}, true);

        if (response) {
          for (const [alias, review] of Object.entries(response)) {
            if (review && review.id) {
              await this.cache.set(review.id, review);
              results.push(review);
            } else {
              const reviewId = parseInt(alias.replace('r', ''));
              log.warn(`[ReviewService] Review ${reviewId} not accessible (private/deleted)`);
            }
          }
        }
      } catch (error) {
        log.error(`[ReviewService] Batch ${chunkIndex} failed.`, error);
        // Fallback to expired cache entries if possible
        for (const id of chunk) {
          const stale = await this.cache.get(id);
          if (stale) results.push(stale);
        }
      }

      // Throttling for AniList rate limits
      if (i + chunkSize < pendingIds.length) {
        await new Promise(r => setTimeout(r, 900));
      }
    }

    return results;
  }

  /**
   * Retrieves a single review.
   * 
   * @param reviewId The AniList review ID
   * @returns Promise resolving to ReviewData or null if not found
   */
  public async getReview(reviewId: number): Promise<ReviewData | null> {
    const cached = await this.cache.get(reviewId);
    if (cached) return cached;

    const results = await this.getReviewBatch([reviewId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Clears the entire review cache (memory and storage).
   */
  public async clearCache(): Promise<void> {
    await this.cache.clear();
    log.info('[ReviewService] Persistent review cache cleared');
  }
}
