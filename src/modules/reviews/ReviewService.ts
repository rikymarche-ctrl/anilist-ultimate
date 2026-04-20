/**
 * Review Service
 * Handles GraphQL queries for review data with advanced Batching via Alias
 */

import { log } from '@core/logger';
import { API_CONFIG } from '@core/constants';
import type { GraphQLResponse } from '@core/types';

interface ReviewData {
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

export class ReviewService {
  private static instance: ReviewService;
  private reviewCache: Map<number, ReviewData> = new Map();

  private constructor() {}

  public static getInstance(): ReviewService {
    if (!ReviewService.instance) {
      ReviewService.instance = new ReviewService();
    }
    return ReviewService.instance;
  }

  /**
   * Get multiple reviews via GraphQL Alias Batching
   * Very robust for AniList rate limits with smart delay between chunks
   */
  public async getReviewBatch(ids: number[], chunkSize: number = 50): Promise<ReviewData[]> {
    if (ids.length === 0) return [];

    const results: ReviewData[] = [];
    const pendingIds = ids.filter(id => {
      if (this.reviewCache.has(id)) {
        results.push(this.reviewCache.get(id)!);
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

      // Build Dynamic Alias Query
      // Example: r123: Review(id: 123) { id score ... }
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
        const response = await this.executeQuery<Record<string, ReviewData>>(query, {});

        if (response) {
          const responseEntries = Object.entries(response);
          const successCount = responseEntries.filter(([_, review]) => review && review.id).length;
          const failedCount = responseEntries.length - successCount;

          responseEntries.forEach(([alias, review]) => {
            if (review && review.id) {
              this.reviewCache.set(review.id, review);
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

      // Rate limit protection: wait 900ms between chunks (AniList limit: ~90 req/min)
      if (i + chunkSize < pendingIds.length) {
        log.info(`%c[ReviewService] ⏳ Waiting 900ms before next chunk...`, 'color: #ff9800; font-style: italic;');
        await this.delay(900);
      }
    }

    log.info(`%c[ReviewService] ✅ Completed: ${results.length} reviews fetched successfully`, 'color: #46d369; font-weight: bold;');
    return results;
  }

  /**
   * Delay utility for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get review by ID (Singular)
   */
  public async getReview(reviewId: number): Promise<ReviewData | null> {
    if (this.reviewCache.has(reviewId)) {
      return this.reviewCache.get(reviewId)!;
    }

    const results = await this.getReviewBatch([reviewId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Execute a GraphQL query
   */
  private async executeQuery<T>(query: string, variables: Record<string, any>): Promise<T | null> {
    try {
      const response = await fetch(API_CONFIG.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(localStorage.getItem('access_token') && localStorage.getItem('access_token') !== 'undefined'
            ? { Authorization: `Bearer ${localStorage.getItem('access_token')}` } 
            : {}),
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: GraphQLResponse<T> = await response.json();

      if (json.errors && json.errors.length > 0) {
        // If it's a batch, some aliases might fail but others succeed
        if (json.data) return json.data;
        log.error('GraphQL errors:', json.errors);
        return null;
      }

      return json.data;
    } catch (error) {
      log.error('Failed to execute GraphQL query', error);
      return null;
    }
  }

  public clearCache(): void {
    this.reviewCache.clear();
  }
}
