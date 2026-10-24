/**
 * @file AnilistClient.ts
 * @description GraphQL API client for the AniList API (https://graphql.anilist.co)
 *
 * Implements request queuing, rate limiting, and automatic retry with
 * exponential backoff. All GraphQL queries and mutations are funneled
 * through a single queue to respect AniList's rate limits.
 *
 * Rate Limiting Strategy:
 *   - Conservative shared budget of 25 requests/minute
 *   - 700ms minimum delay between requests
 *   - Max 2 concurrent in-flight requests
 *   - On HTTP 429: pause queue for 60 seconds
 *   - On failure: exponential backoff (1s, 2s, 4s) up to 3 retries
 *
 * Authentication:
 *   - OAuth bearer token held only in the trusted background context
 *   - Token auto-refreshed via AuthTokenService
 *
 * Fixed: Token management now fully delegated to AuthTokenService.
 *
 * @see docs/ARCHITECTURE.md#6-api-layer
 */

import { injectable, inject } from 'tsyringe';
import { GraphQLClient } from 'graphql-request';
import { getOperationAST, parse } from 'graphql';
import { API_CONFIG } from '@core/constants';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import { ApiError } from '@core/errors/ErrorTypes';
import type { IApiClient, ApiRequestOptions } from '@core/interfaces/IApiClient';
import type { IErrorHandler } from '@core/errors/ErrorHandler';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import {
  VIEWER_QUERY,
  viewerResponse,
  sameViewerContext,
  type ViewerCache,
} from './ViewerResponse';
import type { AniListUser } from '@/api/AnilistTypes';
import {
  getErrorResponse,
  getResponseStatus,
  isRecord,
  parseGraphQLErrors,
  validateGraphQLResponse,
  type GraphQLResponse,
  type GraphQLError,
} from './GraphQLResponse';

/** AniList rejects these requests deterministically; replaying them only spends the shared rate budget. */
function isDeterministicClientError(status: number | undefined): boolean {
  return status === 400 || status === 404 || status === 422;
}

interface RequestQueueItem {
  query: string;
  variables: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  retries: number;
  maxRetries: number;
  silent?: boolean;
  isRaw?: boolean;
  epoch: number;
  /** User-initiated work: dispatched ahead of background items and allowed into the reserved budget. */
  priority: boolean;
}

/**
 * AnilistClient - GraphQL API client with rate limiting
 * Implements IApiClient interface for dependency injection
 */
@injectable()
export class AnilistClient implements IApiClient {
  private client: GraphQLClient;
  private queue: RequestQueueItem[] = [];
  /** Shared only while pending; completed private responses are never cached here. */
  private sharedReads = new Map<string, { promise: Promise<unknown>; item: RequestQueueItem }>();
  private activeRequests = 0;
  private isRateLimited = false;
  private viewerCache: ViewerCache | null = null;
  /** Timestamps (ms) of dispatched requests within the last minute (sliding-window limiter). */
  private requestTimestamps: number[] = [];
  /** Consecutive browser-level network failures; a run of these means we're being throttled. */
  private consecutiveNetworkErrors = 0;
  /** Single reset timer for the current rate-limit cooldown. */
  private rateLimitResetTimer: ReturnType<typeof setTimeout> | null = null;
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wake-up time of queueTimer, so an earlier wake-up can replace a later one. */
  private queueTimerAt = 0;
  private retryTimers = new Map<ReturnType<typeof setTimeout>, RequestQueueItem>();
  private inFlight = new Map<RequestQueueItem, AbortController>();
  private dispatched = new Set<RequestQueueItem>();
  private authSubscription: EventSubscription;
  private destroyed = false;
  private queueEpoch = 0;
  private lastToken: string | null;
  private nextDispatchAt = 0;

  constructor(
    @inject(TOKENS.ErrorHandler) private errorHandler: IErrorHandler,
    @inject(TOKENS.AuthTokenService) private authTokenService: AuthTokenService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    this.lastToken = this.authTokenService.getToken();
    // Now create client with correct headers (including auth if available)
    this.client = new GraphQLClient(API_CONFIG.ENDPOINT, {
      headers: this.getHeaders(),
    });

    // Subscribe to auth state changes to update headers
    this.authSubscription = this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      const token = this.authTokenService.getToken();
      if (token !== this.lastToken) {
        this.clearQueue();
        this.lastToken = token;
      }
      this.updateHeaders();
    });
  }

  public getContext() {
    return {
      sessionId: this.authTokenService.getSessionId(),
      userId: this.authTokenService.getUserCache()?.userId ?? null,
    };
  }
  public async ensureContext() {
    await this.authTokenService.ensureInitialized();
    return this.getContext();
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
    silent: boolean = false,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    return this.enqueueRequest<T>(
      query,
      variables,
      silent,
      false,
      true,
      API_CONFIG.RETRY_ATTEMPTS,
      options.priority === true
    );
  }

  public queryOnce<T>(
    query: string,
    variables: Record<string, unknown> = {},
    silent = true
  ): Promise<T> {
    return this.enqueueRequest<T>(query, variables, silent, false, true, 0);
  }

  private readKey(
    query: string,
    variables: Record<string, unknown>,
    isRaw: boolean,
    maxRetries: number
  ): string | null {
    try {
      if (getOperationAST(parse(query))?.operation !== 'query') return null;
      const sorted = JSON.stringify(variables, (_key, value: unknown) =>
        isRecord(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
            )
          : value
      );
      const context = this.getContext();
      return JSON.stringify([
        this.queueEpoch,
        context.sessionId,
        context.userId,
        isRaw,
        maxRetries,
        query,
        sorted,
      ]);
    } catch {
      return null;
    }
  }

  private enqueueRequest<T>(
    query: string,
    variables: Record<string, unknown>,
    silent: boolean,
    isRaw: boolean,
    share: boolean,
    maxRetries: number = API_CONFIG.RETRY_ATTEMPTS,
    priority = false
  ): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('API client destroyed'));
    const copied = structuredClone(variables);
    const key = share ? this.readKey(query, copied, isRaw, maxRetries) : null;
    if (!key) this.sharedReads.clear(); // A write separates earlier reads from later callers.
    const existing = key ? this.sharedReads.get(key) : undefined;
    if (existing) {
      existing.item.silent = existing.item.silent && silent;
      if (priority) this.promote(existing.item);
      return existing.promise.then((value) => structuredClone(value) as T);
    }
    let item!: RequestQueueItem;
    const promise = new Promise<unknown>((resolve, reject) => {
      item = {
        query,
        variables: copied,
        resolve,
        reject,
        retries: 0,
        maxRetries,
        silent,
        isRaw,
        epoch: this.queueEpoch,
        priority,
      };
    });
    if (key) {
      const entry = { promise, item };
      this.sharedReads.set(key, entry);
      const clear = () => {
        if (this.sharedReads.get(key) === entry) this.sharedReads.delete(key);
      };
      void promise.then(clear, clear);
    } else {
      const clear = () => this.sharedReads.clear();
      void promise.then(clear, clear);
    }
    this.insertQueued(item);
    void this.processQueue();
    // Each tab/service gets its own graph, even when it shares the transport.
    return promise.then((value) => structuredClone(value) as T);
  }

  /**
   * Execute a GraphQL mutation with rate limiting
   * (Mutations use same queue as queries for rate limiting)
   */
  public async mutate<T>(mutation: string, variables: Record<string, unknown> = {}): Promise<T> {
    // Writes are user actions, so they take the priority lane and may use the reserved budget.
    return this.enqueueRequest<T>(
      mutation,
      variables,
      false,
      false,
      false,
      API_CONFIG.RETRY_ATTEMPTS,
      true
    );
  }

  public mutateOnce<T>(mutation: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.enqueueRequest<T>(mutation, variables, false, false, false, 0, true);
  }

  /**
   * Priority items always sit in front of ordinary ones, so the queue is
   * [priority..., background...]. Each class stays FIFO; 'head' is used for retries.
   */
  private insertQueued(item: RequestQueueItem, where: 'tail' | 'head' = 'tail'): void {
    let boundary = 0;
    while (boundary < this.queue.length && this.queue[boundary].priority) boundary++;
    const index = item.priority
      ? where === 'head'
        ? 0
        : boundary
      : where === 'head'
        ? boundary
        : this.queue.length;
    this.queue.splice(index, 0, item);
  }

  /** A priority caller joined a read that is still waiting: move that read into the priority lane. */
  private promote(item: RequestQueueItem): void {
    if (item.priority) return;
    const index = this.queue.indexOf(item);
    if (index !== -1) this.queue.splice(index, 1);
    item.priority = true;
    // Items not waiting in the queue (in flight or in a retry delay) keep their place; the flag applies when requeued.
    if (index !== -1) this.insertQueued(item);
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    // Check if we can process more requests
    const head = this.queue[0];
    // A user action gets one extra concurrency slot, so two slow background reads never hold it back.
    const concurrency = API_CONFIG.RATE_LIMIT.MAX_CONCURRENT + (head?.priority ? 1 : 0);
    if (this.isRateLimited || this.activeRequests >= concurrency || !head) {
      return;
    }

    // Safety check for invalidated context
    if (!chrome.runtime?.id) {
      logger.warn('[AnilistClient] Context invalidated, clearing queue');
      this.clearQueue();
      return;
    }

    // Sliding-window rate limiter: never exceed AniList's per-minute budget.
    // Previously the queue only spaced requests 700ms apart, which still let a
    // media page burst far past the limit and trip a 429 ("rate exhausted")
    // cascade the moment the page opened. Defer dispatch until a slot frees up.
    if (!this.canDispatchNow(head)) {
      const waitMs = this.timeUntilNextSlot(head);
      logger.debug(`[AnilistClient] Per-minute request cap reached, deferring ${waitMs}ms`);
      this.scheduleQueue(waitMs);
      return;
    }
    // The spacing only smooths background bursts. A user action is already bounded by
    // the sliding window above, so it skips the gap instead of waiting up to 700ms.
    const dispatchDelay = this.nextDispatchAt - Date.now();
    if (dispatchDelay > 0 && !head.priority) {
      this.scheduleQueue(dispatchDelay);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.requestTimestamps.push(Date.now());
    this.nextDispatchAt = Date.now() + API_CONFIG.RATE_LIMIT.REQUEST_DELAY_MS;
    this.activeRequests++;
    this.dispatched.add(item);
    // Keep the other allowed slot moving even if this response is slow. Without
    // a wake-up here, work already in the queue waits for this request to finish.
    if (this.queue[0]?.priority) {
      this.scheduleQueue(0);
    } else if (this.activeRequests < API_CONFIG.RATE_LIMIT.MAX_CONCURRENT) {
      this.scheduleQueue(API_CONFIG.RATE_LIMIT.REQUEST_DELAY_MS);
    }

    try {
      const response = await this.executeRequest(item);
      if (item.epoch !== this.queueEpoch)
        throw new ApiError('Request context changed', undefined, 'GraphQL', 0);
      this.consecutiveNetworkErrors = 0;

      // Standard queries expect just the data, queryRaw expects the full response
      if (item.isRaw) {
        item.resolve(response);
      } else {
        item.resolve(response.data);
      }
    } catch (error: unknown) {
      if (item.epoch !== this.queueEpoch) {
        item.reject(error instanceof Error ? error : new Error('Request context changed'));
        return;
      }
      const status =
        getResponseStatus(error) ?? (error instanceof ApiError ? error.statusCode : undefined);
      if (status === 401 || status === 403) {
        item.reject(error instanceof Error ? error : new Error('Authentication required'));
        return;
      }
      const networkError = this.isNetworkError(error);
      this.consecutiveNetworkErrors = networkError ? this.consecutiveNetworkErrors + 1 : 0;

      // Handle rate limiting. A hard 429 from AniList/Cloudflare frequently reaches
      // the browser as an opaque "Failed to fetch" (a TypeError with no readable
      // status, because the throttled response carries no CORS headers). So once
      // several network errors pile up back-to-back we treat it as a rate limit and
      // pause the whole queue, instead of letting every request hammer its own
      // retries and spam "Failed to fetch" toasts until everything stops working.
      const retryable = item.retries < item.maxRetries && !isDeterministicClientError(status);
      if (this.isRateLimitError(error) || (networkError && this.consecutiveNetworkErrors >= 3)) {
        logger.warn('Rate limit / network throttling detected, pausing queue');
        this.handleRateLimit(item, error);
      } else if (retryable) {
        const delay = Math.pow(2, item.retries) * 1000; // Exponential backoff: 1s, 2s, 4s...
        logger.warn(`Request failed, retry ${item.retries + 1}/${item.maxRetries} in ${delay}ms`);

        item.retries++;
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          if (item.epoch !== this.queueEpoch) return;
          this.insertQueued(item, 'head');
          void this.processQueue().catch((error: unknown) =>
            logger.error('[AnilistClient] Queued request processing failed', error)
          );
        }, delay);
        this.retryTimers.set(timer, item);
      } else {
        logger.error(
          isDeterministicClientError(status)
            ? 'Request rejected (HTTP client error, not retried)'
            : 'Request failed after max retries',
          error
        );

        let errorMessage = 'Anilist API request failed';
        const statusCode =
          getResponseStatus(error) ?? (error instanceof ApiError ? error.statusCode : undefined);

        // Try to extract detailed GraphQL error message
        let errors: GraphQLError[] | undefined;
        try {
          errors = parseGraphQLErrors(getErrorResponse(error)?.errors);
        } catch {
          /* malformed transport stays an error */
        }
        if (errors?.length) {
          errorMessage = errors.map((e) => e.message).join(' | ');
        } else if (getErrorResponse(error)) {
          // graphql-request's message can serialize query variables, including
          // private notes. Keep transport diagnostics free of request payloads.
          errorMessage = statusCode
            ? `Anilist API request failed (HTTP ${statusCode})`
            : 'Anilist API request failed';
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
      this.dispatched.delete(item);

      // Spacing is measured from dispatch, not response completion.
      if (!this.isRateLimited) {
        this.scheduleQueue(Math.max(0, this.nextDispatchAt - Date.now()));
      }
    }
  }

  /**
   * Execute a GraphQL query and return the raw response (data + errors)
   */
  public async queryRaw<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: ApiRequestOptions = {}
  ): Promise<GraphQLResponse<T>> {
    return this.enqueueRequest<GraphQLResponse<T>>(
      query,
      variables,
      true,
      true,
      true,
      API_CONFIG.RETRY_ATTEMPTS,
      options.priority === true
    );
  }

  /**
   * Execute a single request
   */
  private async executeRequest(item: RequestQueueItem): Promise<GraphQLResponse<unknown>> {
    logger.debug('Executing GraphQL request', { variables: item.variables });

    // Ensure AuthTokenService is initialized before accessing token
    await this.authTokenService.ensureInitialized();
    if (item.epoch !== this.queueEpoch) throw new Error('Request context changed');

    // Ensure headers are fresh before each request (BUG-FIX: stale token on init)
    this.updateHeaders();

    if (!chrome.runtime?.id) {
      throw new Error('Extension context invalidated.');
    }

    const controller = new AbortController();
    this.inFlight.set(item, controller);
    const timeout = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);
    try {
      // Always return the envelope; processQueue selects data or the full
      // response using the caller's explicit isRaw flag.
      const response = validateGraphQLResponse(
        await this.client.rawRequest<unknown>({
          query: item.query,
          variables: item.variables,
          signal: controller.signal,
        })
      );
      // graphql-request includes a native Headers object. Chromium cannot clone
      // it for shared reads/RPC; keep the metadata as a plain, detached record.
      const headers = (response as GraphQLResponse<unknown> & { headers?: unknown }).headers;
      if (!(headers instanceof Headers)) return response;
      const normalized = { ...response, headers: Object.fromEntries(headers.entries()) };
      return normalized;
    } catch (error: unknown) {
      // Check for authentication errors
      const statusCode = getResponseStatus(error);
      // AniList uses HTTP 404 for a missing Activity, and can null every alias
      // in that request. graphql-request throws before batch consumers see it.
      // Raw readers need semantic GraphQL errors, including 4xx validation/not-
      // found responses, to isolate fields. Authentication, throttling and
      // server failures still follow the transport/retry path below.
      const response = getErrorResponse(error);
      if (
        item.isRaw &&
        [200, 400, 404, 422].includes(statusCode ?? 0) &&
        response?.errors !== undefined
      ) {
        const errors = parseGraphQLErrors(response.errors);
        if (errors?.length) return { data: response.data, errors };
      }
      if (statusCode === 401 || statusCode === 403) {
        logger.error('Authentication error - token may be invalid');
        const authError = new ApiError(
          'Authentication required',
          statusCode,
          'GraphQL',
          0,
          error instanceof Error ? error : undefined
        );
        this.clearQueue(authError);
        throw authError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      this.inFlight.delete(item);
    }
  }

  /**
   * Requests this item may dispatch into the sliding window. Background work
   * stops short of the reserved slots so a user read or write is never starved.
   */
  private dispatchBudget(item: RequestQueueItem): number {
    const { MAX_REQUESTS_PER_MINUTE, RESERVED_PRIORITY_SLOTS } = API_CONFIG.RATE_LIMIT;
    return item.priority
      ? MAX_REQUESTS_PER_MINUTE
      : MAX_REQUESTS_PER_MINUTE - RESERVED_PRIORITY_SLOTS;
  }

  /**
   * Sliding-window check: are we still under the per-minute budget for this item?
   */
  private canDispatchNow(item: RequestQueueItem): boolean {
    this.pruneTimestamps();
    return this.requestTimestamps.length < this.dispatchBudget(item);
  }

  /**
   * Milliseconds until this item's budget frees a slot: the (count - budget)th
   * oldest in-window request must age out first.
   */
  private timeUntilNextSlot(item: RequestQueueItem): number {
    this.pruneTimestamps();
    const budget = this.dispatchBudget(item);
    const count = this.requestTimestamps.length;
    if (count < budget) return 0;
    return Math.max(0, 60000 - (Date.now() - this.requestTimestamps[count - budget])) + 50;
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
    const msg =
      error instanceof Error ? error.message : isRecord(error) ? error.message : undefined;
    if (typeof msg !== 'string') return false;
    return /failed to fetch|networkerror|network request failed|load failed/i.test(msg);
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : isRecord(error) ? error.message : undefined;
    return (
      getResponseStatus(error) === 429 ||
      (error instanceof ApiError && error.statusCode === 429) ||
      (typeof message === 'string' && /rate limit|too many requests/i.test(message))
    );
  }

  /**
   * Handle rate limiting
   */
  private handleRateLimit(item: RequestQueueItem, originalError: unknown): void {
    const retry = item.retries < item.maxRetries;
    if (!retry) {
      item.reject(new ApiError('Rate limit retry budget exhausted', 429, 'GraphQL', item.retries));
    }
    if (retry) item.retries++;
    const alreadyRateLimited = this.isRateLimited;
    this.isRateLimited = true;
    // The pause itself ends the failure streak; the next lone network error must not trigger another freeze.
    this.consecutiveNetworkErrors = 0;

    // Two concurrent requests can receive a 429 at nearly the same time.
    // The first one starts the cooldown; subsequent failures must not create
    // duplicate user-facing warnings or reset timers.
    if (!alreadyRateLimited && !item.silent) {
      this.eventBus.emit(EVENT_TYPES.API_ERROR, {
        error: originalError instanceof Error ? originalError : new Error('Rate limit hit'),
        context: 'Anilist API Rate Limit',
        statusCode: 429,
        timestamp: new Date(),
        severity: 'medium',
      });
    }

    // Put item back in queue
    if (retry) this.insertQueued(item, 'head');

    // Wait for rate limit to reset (60 seconds)
    if (this.rateLimitResetTimer !== null) return;
    this.rateLimitResetTimer = setTimeout(() => {
      this.rateLimitResetTimer = null;
      this.isRateLimited = false;
      this.consecutiveNetworkErrors = 0;
      logger.info('Rate limit reset, resuming requests');
      void this.processQueue().catch((error: unknown) =>
        logger.error('[AnilistClient] Rate limit resume failed', error)
      );
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
    await this.authTokenService.ensureInitialized();
    if (this.destroyed) throw new Error('API client destroyed');
    const context = this.getContext();
    if (this.viewerCache && sameViewerContext(this.viewerCache.context, context))
      return structuredClone(this.viewerCache.user);
    this.viewerCache = null;
    const epoch = this.queueEpoch;

    try {
      // Account lookups sit on user-initiated paths, so a cold cache must not wait behind background work.
      const data = await this.query<unknown>(VIEWER_QUERY, {}, false, { priority: true });
      if (
        this.destroyed ||
        epoch !== this.queueEpoch ||
        !sameViewerContext(context, this.getContext())
      )
        throw new Error('Viewer context changed');
      const user = viewerResponse(data, context.userId);
      this.viewerCache = { context, user };
      return structuredClone(user);
    } catch (error: unknown) {
      logger.error('Failed to fetch user details', error);
      const statusCode = getResponseStatus(error);
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
  public clearQueue(reason?: ApiError): void {
    // Reject all pending promises so awaiting callers don't hang forever
    // (e.g. on 401/403 or invalidated extension context).
    this.queueEpoch++;
    this.sharedReads.clear();
    this.viewerCache = null;
    const pending = [...new Set([...this.queue, ...this.retryTimers.values(), ...this.dispatched])];
    this.dispatched.clear();
    this.queue = [];
    this.retryTimers.forEach((_, timer) => clearTimeout(timer));
    this.retryTimers.clear();
    this.inFlight.forEach((controller) => controller.abort());
    if (this.queueTimer !== null) clearTimeout(this.queueTimer);
    if (this.rateLimitResetTimer !== null) clearTimeout(this.rateLimitResetTimer);
    this.queueTimer = null;
    this.rateLimitResetTimer = null;
    this.isRateLimited = false;
    pending.forEach((item) => {
      try {
        item.reject(
          reason ?? new ApiError('Request queue cleared', undefined, 'GraphQL', item.retries)
        );
      } catch {
        /* ignore individual rejection failures */
      }
    });
    logger.info(`Request queue cleared (${pending.length} pending request(s) rejected)`);
  }

  private scheduleQueue(delay: number): void {
    if (!this.queue.length) return;
    const wakeAt = Date.now() + delay;
    // An earlier wake-up replaces a later one, so a freed spacing window or a
    // priority item is never stuck behind a long wait scheduled for background work.
    if (this.queueTimer !== null) {
      if (wakeAt >= this.queueTimerAt) return;
      clearTimeout(this.queueTimer);
    }
    this.queueTimerAt = wakeAt;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      void this.processQueue();
    }, delay);
  }

  public destroy(): void {
    this.destroyed = true;
    this.authSubscription?.unsubscribe();
    this.clearQueue();
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
