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
import { API_CONFIG } from '@core/constants';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { ApiError } from '@core/errors/ErrorTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IErrorHandler } from '@core/errors/ErrorHandler';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { AniListUser } from '@/api/AnilistTypes';

interface RequestQueueItem<T = unknown> {
  query: string;
  variables: Record<string, unknown>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  retries: number;
  silent?: boolean;
  isRaw?: boolean;
}

interface GraphQLError {
  message: string;
}

interface ApiErrorResponse {
  status?: number;
  errors?: GraphQLError[];
}

/**
 * Type guard for API errors with response status
 */
function isApiError(error: unknown): error is { message?: string; response?: ApiErrorResponse } {
  return typeof error === 'object' && error !== null;
}

/**
 * AnilistClient - GraphQL API client with rate limiting
 * Implements IApiClient interface for dependency injection
 */
@injectable()
export class AnilistClient implements IApiClient {
  private client: GraphQLClient;
  private queue: RequestQueueItem<any>[] = [];
  private activeRequests = 0;
  private isRateLimited = false;
  private viewerCache: AniListUser | null = null;
  /** Timestamps (ms) of dispatched requests within the last minute (sliding-window limiter). */
  private requestTimestamps: number[] = [];
  /** Consecutive browser-level network failures; a run of these means we're being throttled. */
  private consecutiveNetworkErrors = 0;

  constructor(
    @inject(TOKENS.ErrorHandler) private errorHandler: IErrorHandler,
    @inject(TOKENS.AuthTokenService) private authTokenService: AuthTokenService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    // Now create client with correct headers (including auth if available)
    this.client = new GraphQLClient(API_CONFIG.ENDPOINT, {
      headers: this.getHeaders(),
    });

    // Subscribe to auth state changes to update headers
    this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.updateHeaders();
    });
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
   * Update request headers
   */
  private updateHeaders(): void {
    this.viewerCache = null; // Invalidate cache on token change
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

    const token = this.authTokenService.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Execute a GraphQL query with rate limiting
   */
  public async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
    silent: boolean = false
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        query,
        variables,
        resolve,
        reject,
        retries: 0,
        silent,
      } as RequestQueueItem<T>);

      this.processQueue();
    });
  }

  /**
   * Execute a GraphQL mutation with rate limiting
   * (Mutations use same queue as queries for rate limiting)
   */
  public async mutate<T>(mutation: string, variables: Record<string, unknown> = {}): Promise<T> {
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

    // Safety check for invalidated context
    if (!chrome.runtime?.id) {
      log.warn('[AnilistClient] Context invalidated, clearing queue');
      this.clearQueue();
      return;
    }

    // Sliding-window rate limiter: never exceed AniList's per-minute budget.
    // Previously the queue only spaced requests 700ms apart, which still let a
    // media page burst far past the limit and trip a 429 ("rate exhausted")
    // cascade the moment the page opened. Defer dispatch until a slot frees up.
    if (!this.canDispatchNow()) {
      const waitMs = this.timeUntilNextSlot();
      log.debug(`[AnilistClient] Per-minute request cap reached, deferring ${waitMs}ms`);
      setTimeout(() => this.processQueue(), waitMs);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.requestTimestamps.push(Date.now());
    this.activeRequests++;

    try {
      const response = await this.executeRequest(item);
      this.consecutiveNetworkErrors = 0;

      // Standard queries expect just the data, queryRaw expects the full response
      if (item.isRaw) {
        item.resolve(response);
      } else if (response && (response as any).data !== undefined) {
        item.resolve((response as any).data);
      } else {
        item.resolve(response);
      }
    } catch (error: unknown) {
      const networkError = this.isNetworkError(error);
      this.consecutiveNetworkErrors = networkError ? this.consecutiveNetworkErrors + 1 : 0;

      // Handle rate limiting. A hard 429 from AniList/Cloudflare frequently reaches
      // the browser as an opaque "Failed to fetch" (a TypeError with no readable
      // status, because the throttled response carries no CORS headers). So once
      // several network errors pile up back-to-back we treat it as a rate limit and
      // pause the whole queue, instead of letting every request hammer its own
      // retries and spam "Failed to fetch" toasts until everything stops working.
      if (this.isRateLimitError(error) || (networkError && this.consecutiveNetworkErrors >= 3)) {
        log.warn('Rate limit / network throttling detected, pausing queue');
        this.handleRateLimit(item, error);
      } else if (item.retries < API_CONFIG.RETRY_ATTEMPTS) {
        const delay = Math.pow(2, item.retries) * 1000; // Exponential backoff: 1s, 2s, 4s...
        log.warn(
          `Request failed, retry ${item.retries + 1}/${API_CONFIG.RETRY_ATTEMPTS} in ${delay}ms`
        );

        item.retries++;
        setTimeout(() => {
          this.queue.unshift(item);
          this.processQueue();
        }, delay);
      } else {
        log.error('Request failed after max retries', error);

        let errorMessage = 'Anilist API request failed';
        const statusCode = isApiError(error) ? error.response?.status : undefined;

        // Try to extract detailed GraphQL error message
        if (isApiError(error) && error.response?.errors && error.response.errors.length > 0) {
          errorMessage = error.response.errors.map((e) => e.message).join(' | ');
        } else if (isApiError(error) && error.message) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        const apiError = new ApiError(
          errorMessage,
          statusCode,
          'GraphQL',
          item.retries,
          error instanceof Error ? error : undefined
        );

        // Transient network errors ("Failed to fetch") are not actionable for the
        // user and were the source of the toast spam — surface them only to the
        // logs, never as a toast. Real API/GraphQL errors still notify.
        if (!item.silent && !networkError) {
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
   * Execute a GraphQL query and return the raw response (data + errors)
   */
  public async queryRaw<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<{ data: T; errors?: any[] }> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        query,
        variables,
        resolve: (response: any) => resolve(response),
        reject,
        retries: 0,
        silent: true,
        isRaw: true,
      } as RequestQueueItem<T>);

      this.processQueue();
    });
  }

  /**
   * Execute a single request
   */
  private async executeRequest<T>(item: RequestQueueItem<T>): Promise<T> {
    log.debug('Executing GraphQL request', { variables: item.variables });

    // Ensure AuthTokenService is initialized before accessing token
    await this.authTokenService.ensureInitialized();

    // Ensure headers are fresh before each request (BUG-FIX: stale token on init)
    this.updateHeaders();

    if (!chrome.runtime?.id) {
      throw new Error('Extension context invalidated.');
    }

    try {
      // Use raw fetch to get access to both data and errors if needed
      // Actually, we can use the client.rawRequest if we want to be clean
      const response = await this.client.rawRequest<T>(item.query, item.variables);

      // If the caller used queryRaw, we return the whole thing
      // We detect this by checking if the resolve expectation matches
      // (This is a bit hacky but keeps the interface clean for now)
      return response as unknown as T;
    } catch (error: unknown) {
      // Check for authentication errors
      const statusCode = isApiError(error) ? error.response?.status : undefined;
      if (statusCode === 401 || statusCode === 403) {
        log.error('Authentication error - token may be invalid');
        this.clearQueue();
        throw new ApiError(
          'Authentication required',
          statusCode,
          'GraphQL',
          0,
          error instanceof Error ? error : undefined
        );
      }

      throw error;
    }
  }

  /**
   * Sliding-window check: are we still under the per-minute request budget?
   */
  private canDispatchNow(): boolean {
    this.pruneTimestamps();
    return this.requestTimestamps.length < API_CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE;
  }

  /**
   * Milliseconds until the oldest in-window request ages out and frees a slot.
   */
  private timeUntilNextSlot(): number {
    this.pruneTimestamps();
    if (this.requestTimestamps.length === 0) return 0;
    const oldest = this.requestTimestamps[0];
    return Math.max(0, 60000 - (Date.now() - oldest)) + 50;
  }

  /**
   * Drop request timestamps older than one minute.
   */
  private pruneTimestamps(): void {
    const cutoff = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > cutoff);
  }

  /**
   * Detects browser-level network failures (offline, DNS, CORS-stripped 429, etc.)
   * which arrive as a TypeError "Failed to fetch" with no readable HTTP status.
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    const msg = error instanceof Error ? error.message : (error as { message?: unknown })?.message;
    if (typeof msg !== 'string') return false;
    return /failed to fetch|networkerror|network request failed|load failed/i.test(msg);
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (isApiError(error)) {
      return (
        error.response?.status === 429 ||
        (error.message ? error.message.includes('rate limit') : false) ||
        (error.message ? error.message.includes('Too Many Requests') : false)
      );
    }
    if (error instanceof Error) {
      return error.message.includes('rate limit') || error.message.includes('Too Many Requests');
    }
    return false;
  }

  /**
   * Handle rate limiting
   */
  private handleRateLimit(item: RequestQueueItem, originalError: unknown): void {
    this.isRateLimited = true;

    // Notify user that we are paused due to rate limits
    if (!item.silent) {
      this.eventBus.emit(EVENT_TYPES.API_ERROR, {
        error: originalError instanceof Error ? originalError : new Error('Rate limit hit'),
        context: 'Anilist API Rate Limit',
        statusCode: 429,
        timestamp: new Date(),
        severity: 'medium',
      });
    }

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
    const user = await this.getCurrentUser();
    return user.id;
  }

  /**
   * Get current user details
   */
  public async getCurrentUser(): Promise<AniListUser> {
    if (this.viewerCache) return this.viewerCache;

    const query = `
      query {
        Viewer {
          id
          name
          avatar { medium }
          options { 
            titleLanguage
          }
          mediaListOptions {
            scoreFormat
            rowOrder
          }
        }
      }
    `;

    try {
      const data = await this.query<{ Viewer: AniListUser }>(query);
      this.viewerCache = data.Viewer;
      return this.viewerCache;
    } catch (error: unknown) {
      log.error('Failed to fetch user details', error);
      const statusCode = isApiError(error) ? error.response?.status : undefined;
      throw new ApiError(
        'Failed to fetch user details',
        statusCode,
        'Viewer Detail Query',
        0,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Clear the request queue
   */
  public clearQueue(): void {
    // Reject all pending promises so awaiting callers don't hang forever
    // (e.g. on 401/403 or invalidated extension context).
    const pending = this.queue;
    this.queue = [];
    pending.forEach((item) => {
      try {
        item.reject(new ApiError('Request queue cleared', undefined, 'GraphQL', item.retries));
      } catch {
        /* ignore individual rejection failures */
      }
    });
    log.info(`Request queue cleared (${pending.length} pending request(s) rejected)`);
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
