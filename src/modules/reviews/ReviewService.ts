/** Fetch selected review details with validated aliases and a private session cache. */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { logger } from '@core/logger';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { isRecord } from '@/api/GraphQLResponse';
import { isReviewId, parseReview, parseReviewBatch, reviewBatchQuery } from './ReviewResponse';

/** Badge-level review data; the batch query never fetches bodies, authors or media. */
export interface ReviewData {
  id: number;
  score: number;
}

@injectable()
export class ReviewService {
  private cache: ICacheService<number, unknown>;
  private generation = 0;
  private cacheWrites: Promise<unknown> = Promise.resolve();
  private mutateCache<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.cacheWrites.then(operation);
    this.cacheWrites = pending.catch(() => undefined);
    return pending;
  }

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(CacheFactory) cacheFactory: CacheFactory,
  ) {
    // Review bodies use a private session cache and are never restored from storage.
    this.cache = cacheFactory.create<number, unknown>({ namespace: 'reviews_session', persistent: false, maxSize: 500, ttlMs: 24 * 60 * 60 * 1000 });
  }

  public async getReviewBatch(ids: number[], chunkSize = 50): Promise<ReviewData[]> {
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('Invalid review chunk size');
    const requestedIds = [...new Set(ids.filter(isReviewId))];
    if (!requestedIds.length) return [];
    const generation = this.generation;
    const context = await captureApiContext(this.apiClient);
    const assertCurrent = () => {
      assertApiContext(this.apiClient, context);
      if (generation !== this.generation) throw new Error('Review cache changed');
    };
    assertCurrent();
    const results: ReviewData[] = [];
    const pendingIds: number[] = [];
    const readReview = (value: unknown, id: number): ReviewData => {
      if (!isRecord(value) || value.sessionId !== (context?.sessionId ?? null) || value.userId !== (context?.userId ?? null)) throw new Error('Invalid review cache identity');
      const review = parseReview(value.review, id);
      if (!review) throw new Error('Invalid cached review');
      return review;
    };
    for (const id of requestedIds) {
      const cached = await this.cache.get(id);
      assertCurrent();
      if (cached !== undefined) {
        try { results.push(readReview(cached, id)); continue; } catch {
          await this.mutateCache(async () => {
            assertCurrent();
            const latest = await this.cache.get(id);
            assertCurrent();
            if (latest === undefined) return;
            try { readReview(latest, id); } catch { await this.cache.delete(id); }
          });
          assertCurrent();
        }
      }
      pendingIds.push(id);
    }

    for (let index = 0; index < pendingIds.length; index += chunkSize) {
      const chunk = pendingIds.slice(index, index + chunkSize);
      try {
        assertCurrent();
        const { query, variables } = reviewBatchQuery(chunk);
        const response = await this.apiClient.queryRaw<unknown>(query, variables);
        assertCurrent();
        const reviews = parseReviewBatch(response, chunk);
        for (const review of reviews) {
          await this.mutateCache(async () => {
            assertCurrent();
            try {
              await this.cache.set(review.id, { sessionId: context?.sessionId ?? null, userId: context?.userId ?? null, review: parseReview(review, review.id) });
              assertCurrent();
            } catch (error) {
              // Serialization keeps cleanup ahead of any newer session replacement.
              await this.cache.delete(review.id);
              throw error;
            }
          });
          assertCurrent();
          const copy = parseReview(review, review.id);
          if (copy) results.push(copy);
        }
      } catch {
        assertCurrent();
        // Provider payloads may contain private bodies. Log batch metadata only.
        logger.warn('[ReviewService] Review batch ' + (index / chunkSize + 1) + ' failed');
      }
      if (index + chunkSize < pendingIds.length) {
        await new Promise(resolve => setTimeout(resolve, 900));
        assertCurrent();
      }
    }
    assertCurrent();
    return results;
  }

  public async getReview(reviewId: number): Promise<ReviewData | null> {
    const reviews = await this.getReviewBatch([reviewId]);
    return reviews.find(review => review.id === reviewId) ?? null;
  }

  public async clearCache(): Promise<void> {
    this.generation++;
    await this.mutateCache(() => this.cache.clear());
    logger.info('[ReviewService] Review cache cleared');
  }
}
