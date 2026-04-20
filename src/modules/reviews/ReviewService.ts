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

interface ReviewResponse {
  Review: ReviewData;
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
   * Very robust for AniList rate limits
   */
  public async getReviewBatch(ids: number[], chunkSize: number = 25): Promise<ReviewData[]> {
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

    // Process in chunks to avoid too large query strings
    for (let i = 0; i < pendingIds.length; i += chunkSize) {
      const chunk = pendingIds.slice(i, i + chunkSize);
      
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

      try {
        const response = await this.executeQuery<Record<string, ReviewData>>(query, {});
        
        if (response) {
          Object.values(response).forEach(review => {
            if (review && review.id) {
              this.reviewCache.set(review.id, review);
              results.push(review);
            }
          });
        }
      } catch (error) {
        log.error(`ReviewService: Failed to fetch alias batch`, error);
      }
    }

    return results;
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
