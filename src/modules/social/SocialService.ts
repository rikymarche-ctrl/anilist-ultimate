/**
 * @file SocialService.ts
 * @description Friend activity data service with intelligent caching
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
 * Caching Strategy:
 *   - Friend activity: in-memory Map with daily invalidation
 *   - Followings: persistent chrome.storage.local with 24h TTL (PERF-001 fix)
 *   - Manual cache management: refreshFollowings(), invalidateFollowingsCache()
 *   - Viewer ID: fetched once and cached for session
 *
 * Performance:
 *   - Followings fetch: 0 API calls for 24h after first load (was 40+ per load)
 *   - 90% reduction in API calls (PERF-001 resolved)
 *
 * @see docs/MODULES.md#shared-services
 * @see docs/PERFORMANCE.md#perf-001 for followings cache details
 */
import { injectable, singleton, inject } from 'tsyringe';

import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';
import { FriendActivity, MediaListStatus, SocialActivityDetailed, SocialFilter } from '@core/types';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { 
  FriendActivityResponse, 
  DetailedActivityResponse, 
  FollowingsResponse
} from '@/api/AnilistTypes';

import { LRUCacheWithTTL } from '@core/cache/LRUCacheWithTTL';

@injectable()
@singleton()
export class SocialService {
  private friendCache = new LRUCacheWithTTL<number, FriendActivity[]>({
    maxSize: 100,
    ttlMs: 24 * 60 * 60 * 1000 // 24 hours
  });

  private viewerId: number | null = null;

  // PERF-001 fix: Persistent cache for followings
  private readonly FOLLOWINGS_CACHE_KEY = 'au_followings_cache';
  private readonly FOLLOWINGS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_FOLLOWINGS = 200; // Limit to prevent rate-limit

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {}

  /**
   * Fetches friend activity for a list of media IDs using GraphQL batching
   *
   * Now uses GraphQLBatcher for automatic query batching (70-90% HTTP reduction).
   * Individual queries are accumulated in 50ms window and combined into single request.
   */
  public async getFriendActivityBatch(mediaIds: number[]): Promise<Map<number, FriendActivity[]>> {
    const results = new Map<number, FriendActivity[]>();
    const pendingIds: number[] = [];

    // Check cache first
    mediaIds.forEach(id => {
      const cached = this.friendCache.get(id);
      if (cached !== undefined) {
        results.set(id, cached);
      } else {
        pendingIds.push(id);
      }
    });

    if (pendingIds.length === 0) return results;

    // Fetch Viewer ID if not already known
    if (this.viewerId === null && this.api.isAuthenticated()) {
      this.viewerId = await this.getViewerId();
    }

    // Single-media query template (GraphQLBatcher will batch these)
    const FRIEND_ACTIVITY_QUERY = `
      query ($mediaId: Int!) {
        Page(perPage: 6) {
          mediaList(mediaId: $mediaId, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
            user { id name avatar { medium } }
            status
            progress
            score
          }
        }
      }
    `;

    // Create individual query promises - GraphQLBatcher accumulates and batches
    const queryPromises = pendingIds.map(async (mediaId) => {
      try {
        const response = await this.batcher.query<FriendActivityResponse>(FRIEND_ACTIVITY_QUERY, { mediaId });
        const rawList = response?.Page?.mediaList || [];

        let activities: FriendActivity[] = rawList.map((item) => ({
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

        this.friendCache.set(mediaId, activities);
        results.set(mediaId, activities);
      } catch (e) {
        log.error(`[SocialService] Failed to fetch activity for media ${mediaId}`, e);
        // Set empty array on error
        this.friendCache.set(mediaId, []);
        results.set(mediaId, []);
      }
    });

    // Wait for all batched queries to complete
    await Promise.all(queryPromises);

    log.info(`[SocialService] Fetched friend activity for ${pendingIds.length} media (batched via GraphQLBatcher)`);

    return results;
  }

  /**
   * Returns the current viewer's ID (cached for session)
   */
  public async getViewerId(): Promise<number | null> {
    if (this.viewerId !== null) return this.viewerId;
    if (!this.api.isAuthenticated()) return null;

    try {
      this.viewerId = await this.api.getCurrentUserId();
      return this.viewerId;
    } catch (e) {
      log.error('[SocialService] Failed to fetch viewer ID', e);
      return null;
    }
  }

  /**
   * Fetches detailed activity entries for the Social Sidebar
   */
  public async getDetailedActivity(
    mediaId: number, 
    filter: SocialFilter, 
    page: number = 1,
    status?: MediaListStatus | 'all'
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
      const response = await this.api.query<DetailedActivityResponse>(query, variables);
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
  public async getAllFollowings(): Promise<Array<{ id: number; name: string; avatar: { medium: string } }>> {
    // PERF-001 fix: Check persistent cache first
    try {
      const cached = await this.storage.get<{ data: any[]; timestamp: number }>(this.FOLLOWINGS_CACHE_KEY);
      if (cached) {
        const { data, timestamp } = cached;
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
        const response = await this.api.query<FollowingsResponse>(query, { userId: this.viewerId, page });
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
      await this.storage.set(this.FOLLOWINGS_CACHE_KEY, {
        data: allFollowing,
        timestamp: Date.now()
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
      await this.storage.remove(this.FOLLOWINGS_CACHE_KEY);
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

  private readonly USER_CACHE_KEY_PREFIX = 'au_user_cache_';
  private readonly USER_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

  /**
   * Unified method to fetch full user data (info + social counts)
   * Uses persistent cache to prevent API rate limiting.
   */
  public async getFullUser(name: string): Promise<{
    id: number;
    name: string;
    avatar: { medium: string };
    following: number;
    followers: number;
  } | null> {
    const cacheKey = `${this.USER_CACHE_KEY_PREFIX}${name.toLowerCase()}`;

    // 1. Check persistent cache
    try {
      const cached = await this.storage.get<{ data: any; timestamp: number }>(cacheKey);
      if (cached && (Date.now() - cached.timestamp < this.USER_TTL_MS)) {
        return cached.data;
      }
    } catch (e) {
      log.warn(`[SocialService] Cache read error for ${name}`, e);
    }

    // 2. Fetch User ID and basic info first
    const userQuery = `
      query ($name: String) {
        User(name: $name) {
          id
          name
          avatar { medium }
        }
      }
    `;

    try {
      const userResponse = await this.api.query<any>(userQuery, { name });
      if (!userResponse.User) return null;

      const user = userResponse.User;
      
      // 3. Fetch counts using userId (only valid argument in AniList schema)
      const countsQuery = `
        query ($userId: Int!) {
          following: Page(perPage: 1) {
            pageInfo { total }
            following(userId: $userId) { id }
          }
          followers: Page(perPage: 1) {
            pageInfo { total }
            followers(userId: $userId) { id }
          }
        }
      `;

      const countsResponse = await this.api.query<any>(countsQuery, { userId: user.id });

      const userData = {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        following: countsResponse.following.pageInfo.total || 0,
        followers: countsResponse.followers.pageInfo.total || 0
      };

      // 4. Save to cache
      await this.storage.set(cacheKey, {
        data: userData,
        timestamp: Date.now()
      });

      return userData;
    } catch (e) {
      log.error(`[SocialService] Failed to fetch full user ${name}`, e);
      return null;
    }
  }

  /**
   * Clear all caches
   */
  public async clearAllCaches(): Promise<void> {
    this.friendCache.clear();
    this.viewerId = null;
    
    // Clear persistent following cache
    await this.storage.remove(this.FOLLOWINGS_CACHE_KEY);
    
    log.info('[SocialService] All caches cleared (in-memory + followings)');
  }
}
