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

interface BatchReviewResponse {
  Page: {
    reviews: ReviewData[];
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
   * Get multiple reviews by IDs (Batch)
   */
  public async getReviews(ids: number[]): Promise<ReviewData[]> {
    if (ids.length === 0) return [];

    const results: ReviewData[] = [];
    const pendingIds: number[] = [];

    // Check cache first
    ids.forEach(id => {
      if (this.reviewCache.has(id)) {
        results.push(this.reviewCache.get(id)!);
      } else {
        pendingIds.push(id);
      }
    });

    if (pendingIds.length === 0) return results;

    // Fetch pending IDs in chunks of 50 (AniList limit)
    const chunkSize = 50;
    for (let i = 0; i < pendingIds.length; i += chunkSize) {
      const chunk = pendingIds.slice(i, i + chunkSize);
      try {
        const query = `
          query ($ids: [Int]) {
            Page(page: 1, perPage: 50) {
              reviews(id_in: $ids) {
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
          }
        `;

        const variables = { ids: chunk };
        const response = await this.executeQuery<BatchReviewResponse>(query, variables);

        if (response?.Page?.reviews) {
          response.Page.reviews.forEach(review => {
            this.reviewCache.set(review.id, review);
            results.push(review);
          });
          log.info(`ReviewService: Batched fetched ${response.Page.reviews.length} reviews`);
        }
      } catch (error) {
        log.error(`ReviewService: Failed to batch fetch reviews`, error);
      }
    }

    return results;
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
