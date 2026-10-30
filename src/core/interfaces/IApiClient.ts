/**
 * @file IApiClient.ts
 * @description Contract for GraphQL API communication with AniList
 *
 * Defines authentication, query/mutation execution, request queue
 * management, and OAuth URL generation. Implemented by AnilistClient.
 *
 * @see AnilistClient.ts for the concrete implementation
 * @see docs/ARCHITECTURE.md#api-layer
 */

import type { AniListUser } from '@/api/AnilistTypes';
import type { GraphQLResponse } from '@/api/GraphQLResponse';
export interface ApiContext { sessionId: string; userId: number | null; }

/** Scheduling hints for a read. Priority requests jump ahead of background work in the shared queue. */
export interface ApiRequestOptions {
  priority?: boolean;
}

export interface IApiClient {
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean;

  /** Public account context; credentials never cross the API interface. */
  getContext?(): ApiContext;
  ensureContext?(): Promise<ApiContext>;

  /**
   * Get current user ID
   */
  getCurrentUserId(): Promise<number>;

  /**
   * Get current viewer details
   */
  getCurrentUser(): Promise<AniListUser>;

  /**
   * Execute a GraphQL query
   */
  query<T>(query: string, variables?: Record<string, unknown>, silent?: boolean, options?: ApiRequestOptions): Promise<T>;
  /** Background polling can defer failures until its next scheduled interval. */
  queryOnce?<T>(query: string, variables?: Record<string, unknown>, silent?: boolean): Promise<T>;

  /**
   * Execute a GraphQL query and return raw response (data + errors)
   */
  queryRaw<T>(query: string, variables?: Record<string, unknown>, options?: ApiRequestOptions): Promise<GraphQLResponse<T>>;

  /**
   * Execute a GraphQL mutation
   */
  mutate<T>(mutation: string, variables?: Record<string, unknown>): Promise<T>;
  /** Non-idempotent writes (e.g. toggles) must not be retried after a lost response; durable notes saves own their retries. */
  mutateOnce<T>(mutation: string, variables?: Record<string, unknown>): Promise<T>;

  /**
   * Clear request queue
   */
  clearQueue(): void;

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueLength: number;
    activeRequests: number;
    isRateLimited: boolean;
  };
}
