/**
 * @file NotificationFetchService.ts
 * @description Batch activity detail fetching with intelligent caching
 *
 * Extracts activity IDs from notification DOM elements and fetches
 * extended details (media title, type, progress) in a single batched
 * GraphQL request using alias queries. Uses short-lived LRU cache
 * to avoid redundant fetches when users toggle merge/unmerge repeatedly.
 *
 * Caching:
 *   - In-memory cache keyed by activity ID
 *   - LRU eviction (max 100 entries)
 *   - TTL 2 minutes (notifications are real-time, cache must be fresh)
 *   - Manual clearing via clearCache()
 *
 * @see NotificationGroupService.ts for the grouping consumer
 * @see docs/MODULES.md#2-notification-cleaner-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';

export interface ActivityData {
  status?: string;
  media?: {
    id: number;
    type: 'ANIME' | 'MANGA';
    title: {
      romaji: string;
      english: string | null;
    };
  };
  text?: string;
  message?: string;
}

export interface ActivityDetails {
  text: string;
  mediaId?: number;
  mediaTitle?: string;
  status?: string;
}

@injectable()
export class NotificationFetchService {
  private activityCache: Map<number, ActivityDetails> = new Map();

  /** Intelligent Caching: LRU eviction to prevent unbounded growth */
  private readonly MAX_CACHE_SIZE = 100;
  private cacheOrder: number[] = []; // LRU tracking

  /** Intelligent Caching: TTL for stale data invalidation (2 minutes for real-time notifications) */
  private readonly CACHE_TTL_MS = 2 * 60 * 1000;
  private cacheTimestamps: Map<number, number> = new Map();

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {}

  /**
   * Extract activity ID from notification element
   */
  public extractActivityId(notification: HTMLElement): number | null {
    // Check if we cached it first
    const dataId = notification.getAttribute('data-activity-id');
    if (dataId) return parseInt(dataId, 10);

    // Collect all links that might point to an activity
    const links = Array.from(notification.querySelectorAll<HTMLAnchorElement>('a[href*="/activity/"]'));
    
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        return id;
      }
    }

    return null;
  }

  /**
   * Fetch activity details in batch using GraphQL alias with intelligent caching
   */
  public async fetchActivityDetails(activityIds: number[]): Promise<Map<number, ActivityDetails>> {
    if (activityIds.length === 0) return new Map();

    // Filter out invalid IDs (must be positive integers)
    const validIds = activityIds.filter(id => id > 0 && Number.isInteger(id));
    if (validIds.length === 0) {
      log.warn('[NotificationFetch] No valid activity IDs to fetch');
      return new Map();
    }

    if (validIds.length !== activityIds.length) {
      log.warn(`[NotificationFetch] Filtered out ${activityIds.length - validIds.length} invalid activity IDs`);
    }

    // Check cache for existing entries
    const results = new Map<number, ActivityDetails>();
    const pendingIds: number[] = [];

    validIds.forEach(id => {
      const cached = this.getCachedActivity(id);
      if (cached !== undefined) {
        results.set(id, cached);
      } else {
        pendingIds.push(id);
      }
    });

    if (pendingIds.length === 0) {
      log.debug(`[NotificationFetch] All ${validIds.length} activities served from cache`);
      return results;
    }

    log.debug(`[NotificationFetch] Cache: ${results.size} hits, ${pendingIds.length} misses`);

    const fields = `
      ... on ListActivity {
        status
        media {
          id
          type
          title {
            romaji
            english
          }
        }
      }
      ... on TextActivity {
        text(asHtml: false)
      }
      ... on MessageActivity {
        message(asHtml: false)
      }
    `;

    const aliases = pendingIds.map(id => `a${id}: Activity(id: ${id}) { ${fields} }`);
    const query = `query { ${aliases.join('\n')} }`;

    try {
      // Use silent mode to suppress user-facing errors for 404s (deleted activities)
      const response = await this.apiClient.query<Record<string, ActivityData>>(query, {}, true);

      Object.entries(response).forEach(([alias, activity]) => {
        if (!activity) return;

        const id = parseInt(alias.substring(1), 10);
        let text = '';
        let mediaId: number | undefined;
        let mediaTitle: string | undefined;
        let status: string | undefined;

        if (activity.text) text = activity.text;
        else if (activity.message) text = activity.message;
        else if (activity.media) {
          mediaId = activity.media.id;
          mediaTitle = activity.media.title.english || activity.media.title.romaji;
          status = activity.status;
          text = `${status} ${mediaTitle}`;
        }

        const details: ActivityDetails = { text, mediaId, mediaTitle, status };
        this.setCachedActivity(id, details);
        results.set(id, details);
      });

      return results;
    } catch (error: any) {
      // Gracefully handle 404 errors (deleted/unavailable activities)
      // These are expected and shouldn't spam the console
      if (error?.response?.status === 404) {
        log.debug(`[NotificationFetch] Activities not found (likely deleted): ${validIds.join(', ')}`);
        return new Map();
      }

      log.error('[NotificationFetch] Failed to fetch activity details', error);
      log.debug(`[NotificationFetch] Failed activity IDs: ${pendingIds.join(', ')}`);
      return new Map();
    }
  }

  // ─── LRU Cache Helpers with TTL ────────────────────────────────────────────

  /**
   * Get from cache with LRU tracking and TTL validation
   * @returns cached activity details or undefined if not found or expired
   */
  private getCachedActivity(id: number): ActivityDetails | undefined {
    if (!this.activityCache.has(id)) return undefined;

    // Check if entry is still fresh
    const timestamp = this.cacheTimestamps.get(id);
    if (timestamp && (Date.now() - timestamp) > this.CACHE_TTL_MS) {
      // Expired - evict and return undefined
      this.activityCache.delete(id);
      this.cacheTimestamps.delete(id);
      this.cacheOrder = this.cacheOrder.filter(k => k !== id);
      log.debug(`[NotificationFetch] Cache expired for activity ${id}`);
      return undefined;
    }

    // Move to end (most recently used)
    this.cacheOrder = this.cacheOrder.filter(k => k !== id);
    this.cacheOrder.push(id);

    return this.activityCache.get(id)!;
  }

  /**
   * Set cache with LRU eviction and TTL tracking
   */
  private setCachedActivity(id: number, data: ActivityDetails): void {
    // Evict oldest if at capacity
    if (this.activityCache.size >= this.MAX_CACHE_SIZE && !this.activityCache.has(id)) {
      const oldest = this.cacheOrder.shift();
      if (oldest !== undefined) {
        this.activityCache.delete(oldest);
        this.cacheTimestamps.delete(oldest);
        log.debug(`[NotificationFetch] LRU evicted activity ${oldest} (cache size: ${this.activityCache.size})`);
      }
    }

    this.activityCache.set(id, data);
    this.cacheTimestamps.set(id, Date.now());

    // Update LRU order
    this.cacheOrder = this.cacheOrder.filter(k => k !== id);
    this.cacheOrder.push(id);
  }

  /**
   * Manually clear the activity cache
   * Useful when user navigates away from notifications page
   */
  public clearCache(): void {
    const size = this.activityCache.size;
    if (size > 0) {
      this.activityCache.clear();
      this.cacheTimestamps.clear();
      this.cacheOrder = [];
      log.info(`[NotificationFetch] Cache cleared (${size} entries)`);
    }
  }
}
