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
 *   - Persistent cache via chrome.storage.local
 *   - LRU eviction (max 1000 entries)
 *   - TTL 30 days (notification contents are static once generated)
 *
 * @see NotificationGroupService.ts for the grouping consumer
 * @see docs/MODULES.md#2-notification-cleaner-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { STORAGE_KEYS, TIME } from '@core/constants';

import { LRUCacheWithTTL, type CacheEntry } from '@core/cache/LRUCacheWithTTL';

export interface CachedActivity {
  details: ActivityDetails;
  timestamp: number;
}

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
  private activityCache = new LRUCacheWithTTL<number, ActivityDetails>({
    maxSize: 1000,
    ttlMs: 30 * TIME.DAY_MS,
    onPersistenceNeeded: () => this.savePersistentCache()
  });

  private persistentCacheLoaded = false;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
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
    // Ensure persistent cache is loaded into memory first
    await this.ensureCacheLoaded();

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
      const cached = this.activityCache.get(id);
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
        this.activityCache.set(id, details);
        results.set(id, details);
      });

      return results;
    } catch (error) {
      // Gracefully handle 404 errors (deleted/unavailable activities)
      // These are expected and shouldn't spam the console
      const err = error as any;
      if (err?.response?.status === 404) {
        log.debug(`[NotificationFetch] Activities not found (likely deleted): ${validIds.join(', ')}`);
        return new Map();
      }

      log.error('[NotificationFetch] Failed to fetch activity details', error);
      log.debug(`[NotificationFetch] Failed activity IDs: ${pendingIds.join(', ')}`);
      return new Map();
    }
  }

  // ─── Persistent Cache Management ──────────────────────────────────────────

  /**
   * Load the persistent cache from storage into memory
   */
  private async ensureCacheLoaded(): Promise<void> {
    if (this.persistentCacheLoaded) return;

    try {
      const data = await this.storage.get<Record<number, CacheEntry<ActivityDetails>>>(STORAGE_KEYS.CACHE_NOTIFICATIONS);
      if (data) {
        this.activityCache.import(data);
        log.debug(`[NotificationFetch] Loaded ${this.activityCache.size} activities from persistent cache`);
      }
    } catch (error) {
      log.error('[NotificationFetch] Failed to load persistent cache', error);
    } finally {
      this.persistentCacheLoaded = true;
    }
  }

  /**
   * Save the in-memory cache to persistent storage
   */
  private async savePersistentCache(): Promise<void> {
    if (!this.persistentCacheLoaded) return; // Don't overwrite if not loaded yet

    try {
      const exported = this.activityCache.export();
      const data: Record<number, CacheEntry<ActivityDetails>> = {};
      exported.forEach((entry, id) => {
        data[id] = entry;
      });
      await this.storage.set(STORAGE_KEYS.CACHE_NOTIFICATIONS, data);
    } catch (error) {
      log.error('[NotificationFetch] Failed to save persistent cache', error);
    }
  }

  /**
   * Manually clear the activity cache
   * Useful for testing or manual resets
   */
  public async clearCache(): Promise<void> {
    const size = this.activityCache.size;
    if (size > 0) {
      this.activityCache.clear();
      await this.storage.remove(STORAGE_KEYS.CACHE_NOTIFICATIONS);
      log.info(`[NotificationFetch] Persistent cache cleared (${size} entries)`);
    }
  }
}
