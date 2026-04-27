/**
 * @file AnilistClient.ts
 * @description GraphQL API client for the AniList API (https://graphql.anilist.co)
 *
 * Implements request queuing, rate limiting, and automatic retry with
 * exponential backoff. All GraphQL queries and mutations are funneled
 * through a single queue to respect AniList's rate limits.
 *
 * Rate Limiting Strategy:
 *   - Max 90 requests/minute (AniList's limit)
 *   - 700ms minimum delay between requests
 *   - Max 2 concurrent in-flight requests
 *   - On HTTP 429: pause queue for 60 seconds
 *   - On failure: exponential backoff (1s, 2s, 4s) up to 3 retries
 *
 * Authentication:
 *   - OAuth bearer token loaded from localStorage on construction
 *   - Token auto-refreshed via AuthTokenService
 *
 * Fixed: Token management now fully delegated to AuthTokenService.
 *
 * @see docs/ARCHITECTURE.md#6-api-layer
 */

import { injectable, inject } from 'tsyringe';
import { GraphQLClient } from 'graphql-request';
import { API_CONFIG, OAUTH_CONFIG } from '@core/constants';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { ApiError } from '@core/errors/ErrorTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IErrorHandler } from '@core/errors/ErrorHandler';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

interface RequestQueueItem {
  query: string;
  variables: Record<string, any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  retries: number;
  silent?: boolean;
}

/**
 * Type guard for API errors with response status
 */
function isApiError(error: unknown): error is { message?: string; response?: { status?: number } } {
  return typeof error === 'object' && error !== null;
}

/**
 * AnilistClient - GraphQL API client with rate limiting
 * Implements IApiClient interface for dependency injection
 */
@injectable()
export class AnilistClient implements IApiClient {
  private client: GraphQLClient;
  private queue: RequestQueueItem[] = [];
  private activeRequests = 0;
  private isRateLimited = false;
  private accessToken: string | null = null;

  constructor(
    @inject(TOKENS.ErrorHandler) private errorHandler: IErrorHandler,
    @inject(TOKENS.AuthTokenService) private authTokenService: AuthTokenService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    this.client = new GraphQLClient(API_CONFIG.ENDPOINT, {
      headers: this.getHeaders(),
    });

    // Load token from AuthTokenService
    this.loadAccessToken();

    // Subscribe to auth state changes to update headers
    this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.loadAccessToken();
      this.updateHeaders();
    });
  }

  /**
   * Load access token from AuthTokenService
   */
  private loadAccessToken(): void {
    try {
      const token = this.authTokenService.getToken();
      if (token) {
        this.accessToken = token;
        log.info('Access token loaded from AuthTokenService');
      } else {
        this.accessToken = null;
        log.warn('No access token available');
      }
    } catch (error) {
      log.error('Failed to load access token', error);
      this.accessToken = null;
    }
  }

  /**
   * Get current access token
   */
  public getAccessToken(): string | null {
    return this.authTokenService.getToken();
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.authTokenService.getToken();
  }

  /**
   * Get authorization URL for OAuth
   */
  public getAuthUrl(): string {
    return `${OAUTH_CONFIG.AUTH_URL}?client_id=${OAUTH_CONFIG.CLIENT_ID}&redirect_uri=${OAUTH_CONFIG.REDIRECT_URI}&response_type=${OAUTH_CONFIG.RESPONSE_TYPE}`;
  }

  /**
   * Update request headers
   */
  private updateHeaders(): void {
    this.client = new GraphQLClient(API_CONFIG.ENDPOINT, {
      headers: this.getHeaders(),
    });
  }

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  /**
   * Execute a GraphQL query with rate limiting
   */
  public async query<T>(query: string, variables: Record<string, any> = {}, silent: boolean = false): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        query,
        variables,
        resolve,
        reject,
        retries: 0,
        silent,
      });

      this.processQueue();
    });
  }

  /**
   * Execute a GraphQL mutation with rate limiting
   * (Mutations use same queue as queries for rate limiting)
   */
  public async mutate<T>(mutation: string, variables: Record<string, any> = {}): Promise<T> {
    // Mutations are treated the same as queries for rate limiting purposes
    return this.query<T>(mutation, variables);
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    // Check if we can process more requests
    if (
      this.isRateLimited ||
      this.activeRequests >= API_CONFIG.RATE_LIMIT.MAX_CONCURRENT ||
      this.queue.length === 0
    ) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeRequests++;

    try {
      const result = await this.executeRequest(item);
      item.resolve(result);
    } catch (error: unknown) {
      // Handle rate limiting
      if (this.isRateLimitError(error)) {
        log.warn('Rate limit hit, retrying after delay');
        this.handleRateLimit(item);
      } else if (item.retries < API_CONFIG.RETRY_ATTEMPTS) {
        const delay = Math.pow(2, item.retries) * 1000; // Exponential backoff: 1s, 2s, 4s...
        log.warn(`Request failed, retry ${item.retries + 1}/${API_CONFIG.RETRY_ATTEMPTS} in ${delay}ms`);
        
        item.retries++;
        setTimeout(() => {
          this.queue.unshift(item);
          this.processQueue();
        }, delay);
      } else {
        log.error('Request failed after max retries', error);

        const errorMessage = isApiError(error) && error.message ? error.message : 'Anilist API request failed';
        const statusCode = isApiError(error) ? error.response?.status : undefined;

        const apiError = new ApiError(
          errorMessage,
          statusCode,
          'GraphQL',
          item.retries,
          error instanceof Error ? error : undefined
        );

        if (!item.silent) {
          this.errorHandler.handle(apiError, 'Anilist API');
        }
        item.reject(apiError);
      }

    } finally {
      this.activeRequests--;

      // Process next item with delay
      if (!this.isRateLimited) {
        setTimeout(() => this.processQueue(), API_CONFIG.RATE_LIMIT.REQUEST_DELAY_MS);
      }
    }
  }

  /**
   * Execute a single request
   */
  private async executeRequest(item: RequestQueueItem): Promise<any> {
    log.debug('Executing GraphQL request', { variables: item.variables });

    try {
      const data = await this.client.request(item.query, item.variables);
      return data;
    } catch (error: unknown) {
      // Check for authentication errors
      const statusCode = isApiError(error) ? error.response?.status : undefined;
      if (statusCode === 401 || statusCode === 403) {
        log.error('Authentication error - token may be invalid');
        this.accessToken = null;
        throw new ApiError('Authentication required', statusCode, 'GraphQL', 0, error instanceof Error ? error : undefined);
      }

      throw error;
    }
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    return (
      error.response?.status === 429 ||
      error.message?.includes('rate limit') ||
      error.message?.includes('Too Many Requests')
    );
  }

  /**
   * Handle rate limiting
   */
  private handleRateLimit(item: RequestQueueItem): void {
    this.isRateLimited = true;

    // Put item back in queue
    this.queue.unshift(item);

    // Wait for rate limit to reset (60 seconds)
    setTimeout(() => {
      this.isRateLimited = false;
      log.info('Rate limit reset, resuming requests');
      this.processQueue();
    }, 60000);
  }

  /**
   * Get current user ID
   */
  public async getCurrentUserId(): Promise<number> {
    const query = `
      query {
        Viewer {
          id
          name
        }
      }
    `;

    try {
      const data = await this.query<{ Viewer: { id: number; name: string } }>(query);
      log.info('Current user fetched via GraphQL', { userId: data.Viewer.id });
      return data.Viewer.id;
    } catch (error: unknown) {
      log.error('Failed to fetch user data. Please ensure you are logged in to Anilist Ultimate.', error);
      const statusCode = isApiError(error) ? error.response?.status : undefined;
      throw new ApiError(
        'Failed to fetch user data. Please ensure you are logged in to Anilist Ultimate.',
        statusCode,
        'Viewer Query',
        0,
        error instanceof Error ? error : undefined
      );
    }

  }

  /**
   * Clear the request queue
   */
  public clearQueue(): void {
    this.queue = [];
    log.info('Request queue cleared');
  }

  /**
   * Get queue status
   */
  public getQueueStatus(): {
    queueLength: number;
    activeRequests: number;
    isRateLimited: boolean;
  } {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      isRateLimited: this.isRateLimited,
    };
  }
}

/**
 * The anilistClient proxy singleton export has been removed (BUG-013 fix).
 * All modules now use dependency injection via @inject(TOKENS.ApiClient).
 *
 * To use AnilistClient:
 *   constructor(@inject(TOKENS.ApiClient) private apiClient: IApiClient) {}
 */

