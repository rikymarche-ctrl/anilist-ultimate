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
   * Get authorization URL for OAuth
   */
  getAuthUrl(): string;

  /**
   * Get current user ID
   */
  getCurrentUserId(): Promise<number>;

  /**
   * Execute a GraphQL query
   */
  query<T>(query: string, variables?: Record<string, any>, silent?: boolean): Promise<T>;

  /**
   * Execute a GraphQL mutation
   */
  mutate<T>(mutation: string, variables?: Record<string, any>): Promise<T>;

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
