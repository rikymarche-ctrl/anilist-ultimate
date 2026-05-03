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
import { log } from '@core/logger';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { GraphQLBatcher } from '@core/api/GraphQLBatcher';
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
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {}

  /**
   * Extract activity ID from notification element
   */
  public extractActivityId(notification: HTMLElement): number | null {
    const dataId = notification.getAttribute('data-activity-id');
    if (dataId) return parseInt(dataId, 10);

    const links = Array.from(notification.querySelectorAll<HTMLAnchorElement>('a[href*="/activity/"]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  /**
   * Fetch activity details in batch using GraphQLBatcher
   */
  public async fetchActivityDetails(activityIds: number[]): Promise<Map<number, ActivityDetails>> {
    await this.ensureCacheLoaded();
    const results = new Map<number, ActivityDetails>();
    const pendingIds = activityIds.filter(id => {
      const cached = this.activityCache.get(id);
      if (cached) {
        results.set(id, cached);
        return false;
      }
      return id > 0;
    });

    if (pendingIds.length === 0) return results;

    const fields = `
      ... on ListActivity {
        status
        media { id type title { romaji english } }
      }
      ... on TextActivity { text(asHtml: false) }
      ... on MessageActivity { message(asHtml: false) }
    `;

    const fetchPromises = pendingIds.map(async id => {
      try {
        const query = `{ Activity(id: ${id}) { ${fields} } }`;
        const data = await this.batcher.query<ActivityData>(query);
        
        if (data) {
          let text = '';
          let mediaId: number | undefined;
          let mediaTitle: string | undefined;
          let status: string | undefined;

          if (data.text) text = data.text;
          else if (data.message) text = data.message;
          else if (data.media) {
            mediaId = data.media.id;
            mediaTitle = data.media.title.english || data.media.title.romaji;
            status = data.status;
            text = `${status} ${mediaTitle}`;
          }

          const details: ActivityDetails = { text, mediaId, mediaTitle, status };
          this.activityCache.set(id, details);
          results.set(id, details);
        }
      } catch (error) {
        log.debug(`[NotificationFetch] Failed to fetch activity ${id}`, error);
      }
    });

    await Promise.all(fetchPromises);
    return results;
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
