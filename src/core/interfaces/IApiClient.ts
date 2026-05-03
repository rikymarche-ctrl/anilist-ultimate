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

export interface IApiClient {
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean;

  /**
   * Get current access token
   */
  getAccessToken(): string | null;

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
  query<T>(query: string, variables?: Record<string, unknown>, silent?: boolean): Promise<T>;

  /**
   * Execute a GraphQL query and return raw response (data + errors)
   */
  queryRaw<T>(query: string, variables?: Record<string, unknown>): Promise<{ data: T; errors?: any[] }>;

  /**
   * Execute a GraphQL mutation
   */
  mutate<T>(mutation: string, variables?: Record<string, unknown>): Promise<T>;

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
