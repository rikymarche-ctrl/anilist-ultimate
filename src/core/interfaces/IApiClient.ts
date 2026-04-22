/**
 * API Client Interface
 * Contract for GraphQL API communication
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
   * Set access token
   */
  setAccessToken(token: string): void;

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
