/**
 * Review Service
 * Handles GraphQL queries for review data
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
   * Get review by ID
   */
  public async getReview(reviewId: number): Promise<ReviewData | null> {
    // Check cache first
    if (this.reviewCache.has(reviewId)) {
      log.debug(`ReviewService: Retrieved review ${reviewId} from cache`);
      return this.reviewCache.get(reviewId)!;
    }

    try {
      const query = `
        query ($id: Int!) {
          Review(id: $id) {
            id
            score
            summary
            body(asHtml: false)
            rating
            ratingAmount
            user {
              id
              name
            }
            media {
              id
              title {
                romaji
                english
              }
            }
          }
        }
      `;

      const variables = { id: reviewId };

      const response = await this.executeQuery<ReviewResponse>(query, variables);

      if (response?.Review) {
        // Cache the result
        this.reviewCache.set(reviewId, response.Review);
        log.info(`ReviewService: Fetched review ${reviewId} with score ${response.Review.score}`);
        return response.Review;
      }

      return null;
    } catch (error) {
      log.error(`ReviewService: Failed to fetch review ${reviewId}`, error);
      return null;
    }
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
        log.error('GraphQL errors:', json.errors);
        return null;
      }

      return json.data;
    } catch (error) {
      log.error('Failed to execute GraphQL query', error);
      return null;
    }
  }

  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.reviewCache.clear();
    log.info('ReviewService: Cache cleared');
  }
}
