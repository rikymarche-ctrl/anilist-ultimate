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
  private readonly MAX_CACHE_SIZE = 500; // Increased for persistence
  private cacheOrder: number[] = []; // LRU tracking

  /** Intelligent Caching: TTL for stale data invalidation */
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (increased since we persist)
  private cacheTimestamps: Map<number, number> = new Map();
  
  private readonly STORAGE_KEY = 'au_review_cache';
  private isLoaded = false;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {}

  /** Load cache from persistent storage */
  public async init(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const data = await new Promise<any>((resolve) => {
        chrome.storage.local.get(this.STORAGE_KEY, (res) => resolve(res[this.STORAGE_KEY]));
      });

      if (data && data.cache) {
        this.reviewCache = new Map(data.cache.map((entry: any) => [entry.id, entry.data]));
        this.cacheTimestamps = new Map(data.cache.map((entry: any) => [entry.id, entry.timestamp]));
        this.cacheOrder = data.cache.map((entry: any) => entry.id);
        log.info(`[ReviewService] Loaded ${this.reviewCache.size} reviews from persistent cache`);
      }
    } catch (e) {
      log.warn('[ReviewService] Failed to load persistent cache', e);
    }
    this.isLoaded = true;
  }

  private async persist(): Promise<void> {
    const cacheArray = Array.from(this.reviewCache.entries()).map(([id, data]) => ({
      id,
      data,
      timestamp: this.cacheTimestamps.get(id) || Date.now()
    }));

    await chrome.storage.local.set({
      [this.STORAGE_KEY]: {
        cache: cacheArray,
        lastUpdated: Date.now()
      }
    });
  }

  /**
   * Get multiple reviews via GraphQL Alias Batching
   * Very robust for AniList rate limits with smart delay between chunks
   */
  public async getReviewBatch(ids: number[], chunkSize: number = 50): Promise<ReviewData[]> {
    if (ids.length === 0) return [];
    
    // Ensure we are loaded
    if (!this.isLoaded) await this.init();

    const results: ReviewData[] = [];
    const pendingIds: number[] = [];

    ids.forEach(id => {
      const cached = this.getCachedReview(id);
      if (cached !== undefined) {
        results.push(cached);
      } else {
        // Even if expired, keep track for fallback if API fails
        pendingIds.push(id);
      }
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
          
          responseEntries.forEach(([alias, review]) => {
            if (review && review.id) {
              this.setCachedReview(review.id, review);
              results.push(review);
            } else {
              const reviewId = alias.replace('r', '');
              log.warn(`%c[ReviewService] ⚠️ Review ${reviewId} not accessible (deleted/private)`, 'color: #ff9800;');
              
              // FALLBACK: If API says it's not found but we have it in cache (expired), use it anyway
              const fallback = this.reviewCache.get(parseInt(reviewId));
              if (fallback) {
                log.info(`[ReviewService] Using stale fallback for inaccessible review ${reviewId}`);
                results.push(fallback);
              }
            }
          });
          
          await this.persist();
        }
      } catch (error) {
        log.error(`ReviewService: Failed to fetch alias batch ${chunkIndex}/${totalChunks}. Using stale fallbacks.`, error);
        
        // STALE-WHILE-REVALIDATE: If API fails, return whatever we have in cache even if expired
        chunk.forEach(id => {
          const stale = this.reviewCache.get(id);
          if (stale) {
            results.push(stale);
          }
        });
      }

      // Rate limit protection: wait 900ms between chunks
      if (i + chunkSize < pendingIds.length) {
        log.info(`%c[ReviewService] ⏳ Waiting 900ms before next chunk...`, 'color: #ff9800; font-style: italic;');
        await new Promise(r => setTimeout(r, 900));
      }
    }

    log.info(`%c[ReviewService] ✅ Completed: ${results.length} reviews fetched (including fallbacks)`, 'color: #46d369; font-weight: bold;');
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
      chrome.storage.local.remove(this.STORAGE_KEY);
      log.info(`[ReviewService] Cache cleared (${size} entries)`);
    }
  }

  // ─── LRU Cache Helpers with TTL ────────────────────────────────────────────

  /**
   * Get from cache with LRU tracking and TTL validation
   * @returns cached review or undefined if expired (but keeps it in memory for fallback)
   */
  private getCachedReview(id: number): ReviewData | undefined {
    if (!this.reviewCache.has(id)) return undefined;

    // Check if entry is still fresh
    const timestamp = this.cacheTimestamps.get(id);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      // Expired - return undefined to trigger re-fetch, but DO NOT delete yet (for fallback)
      log.debug(`[ReviewService] Cache expired (stale) for review ${id}`);
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
