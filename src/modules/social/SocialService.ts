/**
 * @file SocialService.ts
 * @description Friend activity data service with batched GraphQL fetching
 *
 * Provides three main capabilities:
 *   1. getFriendActivityBatch(mediaIds) - Batch fetch friend watching status
 *      for multiple media IDs using GraphQL alias batching. Used by calendar
 *      and card overlays to show friend avatars.
 *
 *   2. getDetailedActivity(mediaId, filter, page) - Paginated detailed activity
 *      for a specific media. Used by the social sidebar.
 *
 *   3. getAllFollowings() - Fetch all users the current viewer follows.
 *      Paginates through all pages (max 40 pages safety limit).
 *
 * Caching:
 *   - Friend activity is cached in-memory with daily invalidation
 *   - Viewer ID is fetched once and cached for the session
 *
 * @see docs/MODULES.md#shared-services
 */
import { injectable, singleton, inject } from 'tsyringe';

import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';
import { FriendActivity, SocialActivityDetailed, SocialFilter } from '@core/types';
import { PERFORMANCE } from '@core/constants';

@injectable()
@singleton()
export class SocialService {
  private friendCache: Map<number, FriendActivity[]> = new Map();
  private viewerId: number | null = null;
  private cacheDate: string = '';

  // PERF-001 fix: Persistent cache for followings
  private readonly FOLLOWINGS_CACHE_KEY = 'au_followings_cache';
  private readonly FOLLOWINGS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_FOLLOWINGS = 200; // Limit to prevent rate-limit

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {
    this.refreshCacheIfNeeded();
  }

  private refreshCacheIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.cacheDate !== today) {
      this.friendCache.clear();
      this.cacheDate = today;
    }
  }

  /**
   * Fetches friend activity for a list of media IDs using GraphQL aliases
   */
  public async getFriendActivityBatch(mediaIds: number[]): Promise<Map<number, FriendActivity[]>> {
    this.refreshCacheIfNeeded();
    const results = new Map<number, FriendActivity[]>();
    const pendingIds: number[] = [];

    mediaIds.forEach(id => {
      if (this.friendCache.has(id)) {
        results.set(id, this.friendCache.get(id)!);
      } else {
        pendingIds.push(id);
      }
    });

    if (pendingIds.length === 0) return results;

    // Fetch Viewer ID if not already known
    if (this.viewerId === null && this.api.isAuthenticated()) {
      try {
        this.viewerId = await this.api.getCurrentUserId();
      } catch (e) {
        log.warn('[SocialService] Failed to fetch Viewer ID');
      }
    }

    const chunkSize = PERFORMANCE.GRAPHQL_CHUNK_SIZE_SOCIAL;
    for (let i = 0; i < pendingIds.length; i += chunkSize) {
      const chunk = pendingIds.slice(i, i + chunkSize);

      // Build GraphQL variables to prevent injection (BUG-029/SEC-018 fix)
      const varDecls = chunk.map((_, idx) => `$m${idx}: Int!`).join(', ');
      const aliases = chunk.map((id, idx) => `
        m${id}: Page(perPage: 6) {
          mediaList(mediaId: $m${idx}, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
            user { id name avatar { medium } }
            status
            progress
            score
          }
        }
      `);

      const query = `query (${varDecls}) { ${aliases.join('\n')} }`;
      const variables: Record<string, number> = {};
      chunk.forEach((id, idx) => { variables[`m${idx}`] = id; });

      try {
        const response = await this.api.query<Record<string, any>>(query, variables);
        
        chunk.forEach(id => {
          const alias = `m${id}`;
          const rawList = response[alias]?.mediaList || [];
          
          let activities: FriendActivity[] = rawList.map((item: any) => ({
            id: item.user.id,
            status: item.status,
            progress: item.progress,
            score: item.score,
            user: item.user
          }));

          // Filter out current viewer
          if (this.viewerId) {
            activities = activities.filter(a => a.user.id !== this.viewerId);
          }

          this.friendCache.set(id, activities);
          results.set(id, activities);
        });
      } catch (e) {
        log.error(`[SocialService] Batch fetch failed for chunk ${i}`, e);
        // Don't mark as null, maybe retry later? For now, empty list
        chunk.forEach(id => {
          this.friendCache.set(id, []);
          results.set(id, []);
        });
      }
    }

    return results;
  }

  /**
   * Fetches detailed activity entries for the Social Sidebar
   */
  public async getDetailedActivity(
    mediaId: number, 
    filter: SocialFilter, 
    page: number = 1,
    status?: string
  ): Promise<{ nodes: SocialActivityDetailed[], hasNextPage: boolean }> {
    const query = `
      query($mediaId: Int, $isFollowing: Boolean, $userId: Int, $page: Int, $status: MediaListStatus) {
        Page(page: $page, perPage: 30) {
          pageInfo {
            hasNextPage
          }
          mediaList(mediaId: $mediaId, isFollowing: $isFollowing, userId: $userId, status: $status, sort: [UPDATED_TIME_DESC]) {
            id
            status
            progress
            score
            notes
            updatedAt
            user {
              id
              name
              avatar { medium }
              mediaListOptions {
                scoreFormat
              }
            }
          }
        }
      }
    `;

    const variables: Record<string, any> = { mediaId, page };
    if (status && status !== 'all') {
      variables.status = status.toUpperCase();
    }
    
    if (filter === 'following') {
      variables.isFollowing = true;
    } else if (filter === 'self') {
      if (!this.viewerId) {
        this.viewerId = await this.api.getCurrentUserId();
      }
      if (this.viewerId) {
        variables.userId = this.viewerId;
      } else {
        throw new Error('User not authenticated');
      }
    }

    try {
      const response = await this.api.query<any>(query, variables);
      return {
        nodes: response.Page.mediaList,
        hasNextPage: response.Page.pageInfo.hasNextPage
      };
    } catch (e) {
      log.error(`[SocialService] Failed to fetch detailed activity`, e);
      throw e;
    }
  }

  /**
   * Fetches all users the current viewer is following
   */
  public async getAllFollowings(): Promise<any[]> {
    // PERF-001 fix: Check persistent cache first
    try {
      const cached = await chrome.storage.local.get(this.FOLLOWINGS_CACHE_KEY);
      if (cached[this.FOLLOWINGS_CACHE_KEY]) {
        const { data, timestamp } = cached[this.FOLLOWINGS_CACHE_KEY];
        const age = Date.now() - timestamp;

        if (age < this.FOLLOWINGS_TTL_MS) {
          log.info(`[SocialService] Using cached followings (${data.length} users, age: ${Math.floor(age / 1000 / 60)}min)`);
          return data;
        } else {
          log.info('[SocialService] Following cache expired, refetching');
        }
      }
    } catch (e) {
      log.warn('[SocialService] Failed to read followings cache', e);
    }

    // Fetch viewerId if needed
    if (!this.viewerId) {
      try {
        this.viewerId = await this.api.getCurrentUserId();
        log.info('[SocialService] Viewer ID fetched:', this.viewerId);
      } catch (e) {
        log.error('[SocialService] Failed to get viewer ID', e);
        throw new Error('Failed to get user ID. Please ensure you are logged in to Anilist Ultimate.');
      }
    }

    if (!this.viewerId) {
      throw new Error('User not authenticated - viewerId is null');
    }

    const query = `
      query($userId: Int!, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          following(userId: $userId) {
            id
            name
            avatar { medium }
          }
        }
      }
    `;

    let allFollowing: any[] = [];
    let hasNextPage = true;
    let page = 1;

    // PERF-001 fix: Limit to MAX_FOLLOWINGS to prevent rate-limit
    const maxPages = Math.ceil(this.MAX_FOLLOWINGS / 50);

    while (hasNextPage && page <= maxPages) {
      try {
        const response = await this.api.query<any>(query, { userId: this.viewerId, page });
        const pageData = response.Page;
        allFollowing = [...allFollowing, ...pageData.following];
        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;

        log.info(`[SocialService] Fetched following page ${page - 1}/${maxPages} (${allFollowing.length} users)`);
      } catch (e) {
        log.error(`[SocialService] Failed to fetch following page ${page}`, e);
        break;
      }
    }

    // PERF-001 fix: Save to persistent cache
    try {
      await chrome.storage.local.set({
        [this.FOLLOWINGS_CACHE_KEY]: {
          data: allFollowing,
          timestamp: Date.now()
        }
      });
      log.info(`[SocialService] Cached ${allFollowing.length} followings`);
    } catch (e) {
      log.warn('[SocialService] Failed to cache followings', e);
    }

    return allFollowing;
  }

  // ─── Manual Cache Management ──────────────────────────────────────────────

  /**
   * Invalidate the followings cache
   * Useful when user follows/unfollows someone or wants fresh data
   */
  public async invalidateFollowingsCache(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.FOLLOWINGS_CACHE_KEY);
      log.info('[SocialService] Followings cache invalidated');
    } catch (e) {
      log.error('[SocialService] Failed to invalidate followings cache', e);
    }
  }

  /**
   * Force refresh followings data
   * Clears cache and refetches from API
   */
  public async refreshFollowings(): Promise<any[]> {
    log.info('[SocialService] Force refreshing followings...');
    await this.invalidateFollowingsCache();
    return this.getAllFollowings();
  }

  /**
   * Clear all in-memory caches (friend activity + viewer ID)
   * Useful for testing or when user logs out
   */
  public clearAllCaches(): void {
    this.friendCache.clear();
    this.viewerId = null;
    this.cacheDate = '';
    log.info('[SocialService] All in-memory caches cleared');
  }
}
