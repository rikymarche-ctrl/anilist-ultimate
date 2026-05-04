/**
 * @file SocialService.ts
 * @description Enterprise service for AniList social features and friend activity tracking.
 *
 * Provides high-performance access to social data through optimized API batching
 * and multi-layered persistent caching.
 *
 * CACHING ARCHITECTURE:
 * 1. FriendActivity: In-memory cache for recent activity thumbnails.
 * 2. Followings: Persistent cache for viewer's follow list (prevents massive API pagination).
 * 3. UserInfo: Persistent cache for detailed user profiles.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { log } from '@core/logger';
import { FriendActivity, MediaListStatus, SocialActivityDetailed, SocialFilter } from '@core/types';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import type { 
  DetailedActivityResponse, 
  FollowingsResponse
} from '@/api/AnilistTypes';

/**
 * Detailed user information structure used for social interactions.
 */
export interface FullUserData {
  id: number;
  name: string;
  avatar: { medium: string };
  following: number;
  followers: number;
}

/**
 * Social Service implementation.
 * Orchestrates social data fetching, batching, and persistence.
 */
@injectable()
export class SocialService {
  /** In-memory cache for friend activity thumbnails */
  private friendCache: ICacheService<number, FriendActivity[]>;
  /** Persistent cache for following list (TTL 24h) */
  private followingCache: ICacheService<string, any[]>;
  /** Persistent cache for user profiles (TTL 12h) */
  private userCache: ICacheService<string, FullUserData>;

  /** Cached ID of the current authenticated user */
  private viewerId: number | null = null;

  /** Cache configuration constants */
  private readonly CONFIG = {
    FRIEND_CACHE: { namespace: 'social_friends', maxSize: 100, ttlMs: 24 * 60 * 60 * 1000, persistent: false },
    FOLLOWING_CACHE: { namespace: 'social_followings', maxSize: 1, ttlMs: 24 * 60 * 60 * 1000 },
    USER_CACHE: { namespace: 'social_users', maxSize: 200, ttlMs: 12 * 60 * 60 * 1000 }
  };

  /**
   * @param api AniList API client
   * @param batcher GraphQL batching engine
   * @param cacheFactory Factory for generating cache instances
   */
  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(CacheFactory) cacheFactory: CacheFactory
  ) {
    this.friendCache = cacheFactory.create<number, FriendActivity[]>(this.CONFIG.FRIEND_CACHE);
    this.followingCache = cacheFactory.create<string, any[]>(this.CONFIG.FOLLOWING_CACHE);
    this.userCache = cacheFactory.create<string, FullUserData>(this.CONFIG.USER_CACHE);
  }

  /**
   * Fetches friend activity for a list of media IDs.
   * Utilizes GraphQLBatcher to minimize HTTP overhead.
   * 
   * @param mediaIds Array of media IDs to query
   * @returns Map of mediaId to friend activity entries
   */
  public async getFriendActivityBatch(mediaIds: number[]): Promise<Map<number, FriendActivity[]>> {
    const results = new Map<number, FriendActivity[]>();
    const pendingIds: number[] = [];

    // Prioritize cached results
    for (const id of mediaIds) {
      const cached = await this.friendCache.get(id);
      if (cached !== undefined) {
        results.set(id, cached);
      } else {
        pendingIds.push(id);
      }
    }

    if (pendingIds.length === 0) return results;

    if (this.viewerId === null && this.api.isAuthenticated()) {
      this.viewerId = await this.getViewerId();
      log.debug(`[SocialService] Viewer ID initialized: ${this.viewerId}`);
    } else if (!this.api.isAuthenticated()) {
      log.warn('[SocialService] API is not authenticated, results might be limited');
    }

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

    // Process pending IDs through the batcher
    const queryPromises = pendingIds.map(async (mediaId) => {
      try {
        const response = await this.batcher.query<any>(FRIEND_ACTIVITY_QUERY, { mediaId });
        const rawList = response?.mediaList || [];

        let activities: FriendActivity[] = rawList.map((item: any) => ({
          id: item.user.id,
          status: item.status,
          progress: item.progress,
          score: item.score,
          user: item.user
        }));

        if (this.viewerId) {
          const beforeFilterCount = activities.length;
          activities = activities.filter(a => a.user.id !== this.viewerId);
          if (beforeFilterCount !== activities.length) {
            log.debug(`[SocialService] Filtered out self (viewerId: ${this.viewerId}) for media ${mediaId}`);
          }
        }

        log.debug(`[SocialService] Media ${mediaId}: Found ${activities.length} friends`, activities);
        await this.friendCache.set(mediaId, activities);
        results.set(mediaId, activities);
      } catch (e) {
        log.error(`[SocialService] Failed to fetch activity for media ${mediaId}`, e);
        await this.friendCache.set(mediaId, []);
        results.set(mediaId, []);
      }
    });

    await Promise.all(queryPromises);
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
   * Fetches the complete list of users followed by the current viewer.
   * Leverages persistence to avoid expensive deep pagination on every load.
   */
  public async getAllFollowings(): Promise<any[]> {
    const cached = await this.followingCache.get('all');
    if (cached) return cached;

    const vId = await this.getViewerId();
    if (!vId) throw new Error('User not authenticated');

    const query = `
      query($userId: Int!, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          following(userId: $userId) { id name avatar { medium } }
        }
      }
    `;

    let allFollowing: any[] = [];
    let hasNextPage = true;
    let page = 1;
    const maxPages = 4; // Safety limit (200 users)

    while (hasNextPage && page <= maxPages) {
      try {
        const response = await this.api.query<FollowingsResponse>(query, { userId: vId, page });
        allFollowing = [...allFollowing, ...response.Page.following];
        hasNextPage = response.Page.pageInfo.hasNextPage;
        page++;
      } catch (e) {
        log.error(`[SocialService] Followings page ${page} failed`, e);
        break;
      }
    }

    await this.followingCache.set('all', allFollowing);
    return allFollowing;
  }

  /**
   * Invalidates followings cache and triggers a re-fetch.
   */
  public async refreshFollowings(): Promise<any[]> {
    await this.followingCache.clear();
    return this.getAllFollowings();
  }

  /**
   * Fetches full user profile data with persistent caching.
   * 
   * @param name User name to query
   * @returns User data or null if not found
   */
  public async getFullUser(name: string): Promise<FullUserData | null> {
    const cached = await this.userCache.get(name.toLowerCase());
    if (cached) return cached;

    const userQuery = `query ($name: String) { User(name: $name) { id name avatar { medium } } }`;

    try {
      const userResponse = await this.api.query<any>(userQuery, { name });
      if (!userResponse.User) return null;

      const user = userResponse.User;
      const countsQuery = `
        query ($userId: Int!) {
          following: Page(perPage: 1) { pageInfo { total } following(userId: $userId) { id } }
          followers: Page(perPage: 1) { pageInfo { total } followers(userId: $userId) { id } }
        }
      `;

      const countsResponse = await this.api.query<any>(countsQuery, { userId: user.id });

      const userData: FullUserData = {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        following: countsResponse.following.pageInfo.total || 0,
        followers: countsResponse.followers.pageInfo.total || 0
      };

      await this.userCache.set(name.toLowerCase(), userData);
      return userData;
    } catch (e) {
      log.error(`[SocialService] Full user fetch failed for ${name}`, e);
      return null;
    }
  }

  /**
   * Clears all social-related caches.
   */
  public async clearAllCaches(): Promise<void> {
    await this.friendCache.clear();
    await this.followingCache.clear();
    await this.userCache.clear();
    this.viewerId = null;
    log.info('[SocialService] All social caches cleared');
  }
}
