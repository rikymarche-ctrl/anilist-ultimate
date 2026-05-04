/**
 * @file NotificationFetchService.ts
 * @description Enterprise service for batched activity detail fetching for the Notification module.
 *
 * Optimizes network traffic by batching individual activity detail requests into
 * combined GraphQL alias queries and provides long-term persistent caching
 * for static activity data.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import type { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { TIME } from '@core/constants';

/**
 * Raw activity data structure from AniList API
 */
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

/**
 * Simplified activity details used for notification grouping
 */
export interface ActivityDetails {
  text: string;
  mediaId?: number;
  mediaTitle?: string;
  status?: string;
}

/**
 * Service responsible for fetching and caching activity metadata.
 */
@injectable()
export class NotificationFetchService {
  /** Centralized persistent cache for notification activity details */
  private cache: ICacheService<number, ActivityDetails>;

  /** Cache configuration constants */
  private readonly CACHE_CONFIG = {
    namespace: 'notifications_activity',
    maxSize: 1000,
    ttlMs: 30 * TIME.DAY_MS // Notification content is mostly static
  };

  /**
   * @param batcher GraphQL alias batching engine
   * @param cacheFactory Factory to create isolated cache instances
   */
  constructor(
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(CacheFactory) cacheFactory: CacheFactory
  ) {
    this.cache = cacheFactory.create<number, ActivityDetails>(this.CACHE_CONFIG);
  }

  /**
   * Extracts the activity ID from a notification DOM element.
   * Scans for data attributes and specific URL patterns in anchor tags.
   * 
   * @param notification Notification HTML element
   * @returns The extracted activity ID or null if not found
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
   * Fetches detailed metadata for multiple activity IDs.
   * Prioritizes persistent cache and uses batcher for pending items.
   * 
   * @param activityIds Array of IDs to query
   * @returns Map of activityId to its details
   */
  public async fetchActivityDetails(activityIds: number[]): Promise<Map<number, ActivityDetails>> {
    const results = new Map<number, ActivityDetails>();
    const pendingIds: number[] = [];

    // Prioritize cache
    for (const id of activityIds) {
      const cached = await this.cache.get(id);
      if (cached) {
        results.set(id, cached);
      } else if (id > 0) {
        pendingIds.push(id);
      }
    }

    if (pendingIds.length === 0) return results;

    const fields = `
      ... on ListActivity {
        status
        media { id type title { romaji english } }
      }
      ... on TextActivity { text(asHtml: false) }
      ... on MessageActivity { message(asHtml: false) }
    `;

    // Dispatch queries through the batcher
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
          await this.cache.set(id, details);
          results.set(id, details);
        }
      } catch (error) {
        log.debug(`[NotificationFetch] Failed to fetch activity ${id}`, error);
      }
    });

    await Promise.all(fetchPromises);
    return results;
  }

  /**
   * Clears the entire notification activity cache.
   */
  public async clearCache(): Promise<void> {
    await this.cache.clear();
    log.info('[NotificationFetch] Activity cache cleared');
  }
}
