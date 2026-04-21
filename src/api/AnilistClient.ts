/**
 * Anilist GraphQL API Client
 * Handles all API communication with rate limiting
 */

import { GraphQLClient } from 'graphql-request';
import { API_CONFIG, OAUTH_CONFIG } from '@core/constants';
import { log } from '@core/logger';
// GraphQLResponse type imported but reserved for future use

interface RequestQueueItem {
  query: string;
  variables: Record<string, any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  retries: number;
}

export class AnilistClient {
  private client: GraphQLClient;
  private queue: RequestQueueItem[] = [];
  private activeRequests = 0;
  private isRateLimited = false;
  private accessToken: string | null = null;

  constructor() {
    this.client = new GraphQLClient(API_CONFIG.ENDPOINT, {
      headers: this.getHeaders(),
    });

    // Try to load token from storage
    this.loadAccessToken();
  }

  /**
   * Load access token from localStorage
   */
  private loadAccessToken(): void {
    try {
      // Check all possible storage keys (for compatibility with v1 and Anilist native)
      const possibleKeys = [
        'anilist_ultimate_v2_access_token', // V2 prefixed key
        'access_token',                      // Generic key
        'accessToken',                       // Camel case variant
        'token',                             // Short variant
        'auth_token',                        // Alternative name
        'jwt'                                // JWT variant
      ];

      let token: string | null = null;

      // Try localStorage first
      for (const key of possibleKeys) {
        token = localStorage.getItem(key);
        if (token) {
          log.info(`Access token found in localStorage[${key}]`);
          break;
        }
      }

      // If not found, try sessionStorage
      if (!token) {
        for (const key of possibleKeys) {
          token = sessionStorage.getItem(key);
          if (token) {
            log.info(`Access token found in sessionStorage[${key}]`);
            break;
          }
        }
      }

      if (token) {
        // Strip quotes if any
        this.accessToken = token.replace(/"/g, '');
        this.updateHeaders();
        log.info('Access token loaded successfully');
      } else {
        log.warn('No access token found in any storage location');
      }
    } catch (error) {
      log.error('Failed to load access token', error);
    }
  }

  /**
   * Set access token manually and persist to storage
   */
  public setAccessToken(token: string): void {
    this.accessToken = token;
    this.updateHeaders();

    // Save to all possible keys for v1/v2 compatibility
    try {
      localStorage.setItem('anilist_ultimate_v2_access_token', token); // V2 prefixed key
      localStorage.setItem('access_token', token);                      // Generic key
      localStorage.setItem('accessToken', token);                       // Camel case variant
      localStorage.setItem('token', token);                             // Short variant
      localStorage.setItem('auth_token', token);                        // Alternative name
      localStorage.setItem('jwt', token);                               // JWT variant
      log.info('Access token set and saved to all storage locations');
    } catch (error) {
      log.error('Failed to persist access token', error);
    }
  }

  /**
   * Get current access token
   */
  public getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.accessToken;
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
  public async query<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        query,
        variables,
        resolve,
        reject,
        retries: 0,
      });

      this.processQueue();
    });
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
    } catch (error) {
      // Handle rate limiting
      if (this.isRateLimitError(error)) {
        log.warn('Rate limit hit, retrying after delay');
        this.handleRateLimit(item);
      } else if (item.retries < API_CONFIG.RETRY_ATTEMPTS) {
        log.warn(`Request failed, retry ${item.retries + 1}/${API_CONFIG.RETRY_ATTEMPTS}`);
        item.retries++;
        this.queue.unshift(item); // Put back at front of queue
      } else {
        log.error('Request failed after max retries', error);
        item.reject(error);
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
    } catch (error: any) {
      // Check for authentication errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        log.error('Authentication error - token may be invalid');
        this.accessToken = null;
        throw new Error('Authentication required');
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
    } catch (error) {
      log.error('Failed to fetch user data. Please ensure you are logged in to Anilist Ultimate.', error);
      throw new Error('Failed to fetch user data. Please ensure you are logged in to Anilist Ultimate.');
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

// Singleton instance
export const anilistClient = new AnilistClient();
