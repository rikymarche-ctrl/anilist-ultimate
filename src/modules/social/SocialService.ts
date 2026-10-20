/**
 * @file SocialService.ts
 * @description Validated AniList social reads and session-scoped disposable caches.
 *
 * Friend activity, followings and profiles use bounded caches. Viewer-dependent
 * entries remain in memory; unknown transport data is parsed before publication.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { logger } from '@core/logger';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { isRecord } from '@/api/GraphQLResponse';
import { FriendActivity, MediaListStatus, SocialActivityDetailed, SocialFilter } from '@core/types';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { isAniListId, isAniListStatus, parseDetailedActivity, parseFollowingPage, parseFriendActivity, parseSocialUser, SocialPaginationLimitError } from './SocialResponse';

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
type FollowingUser = FriendActivity['user'];

function parseCachedFriends(value: unknown): FriendActivity[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Invalid social cache');
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || !isAniListStatus(entry.status) || typeof entry.progress !== 'number'
      || !Number.isInteger(entry.progress) || entry.progress < 0 || entry.progress > 2147483647
      || typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 100) throw new Error('Invalid social cache');
    const user = parseSocialUser(entry.user);
    if (entry.id !== user.id) throw new Error('Invalid social cache');
    return { id: user.id, user, status: entry.status, progress: entry.progress, score: entry.score };
  });
}

function parseCachedFollowings(value: unknown): FollowingUser[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('Invalid social cache');
  return value.map(parseSocialUser);
}

/**
 * Social Service implementation.
 * Orchestrates social data fetching, batching, and persistence.
 */
@injectable()
export class SocialService {
  /** In-memory cache for friend activity thumbnails */
  private friendCache: ICacheService<number, unknown>;
  /** Viewer-scoped in-memory following list (TTL 24h) */
  private followingCache: ICacheService<string, unknown>;
  /** Viewer-scoped in-memory follower list (TTL 24h) */
  private followerCache: ICacheService<string, unknown>;
  /** Bounded user profiles (TTL 12h) */
  private userCache: ICacheService<string, FullUserData>;

  /** Track failed fetches to avoid "thundering herd" on 429s (TTL 2min) */
  private failedFetches: Map<string, number> = new Map();
  private readonly FAILURE_TTL_MS = 2 * 60 * 1000;
  private cacheGeneration = 0;
  private followingGeneration = 0;
  private followerGeneration = 0;
  private cacheWrites: Promise<unknown> = Promise.resolve();

  private mutateCache<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.cacheWrites.then(operation);
    this.cacheWrites = pending.catch(() => undefined);
    return pending;
  }

  private readPrivateCache<K, T>(cache: ICacheService<K, unknown>, key: K, context: ApiContext | undefined,
    assertCurrent: () => void, parse: (value: unknown) => T): Promise<T | undefined> {
    return this.mutateCache(async () => {
      assertCurrent();
      const cached = await cache.get(key);
      assertCurrent();
      if (cached === undefined) return undefined;
      try {
        if (!isRecord(cached) || cached.sessionId !== (context?.sessionId ?? null)
          || cached.userId !== (context?.userId ?? null)) throw new Error('Invalid social cache identity');
        return parse(cached.value);
      } catch {
        // This read and deletion precede any replacement queued by a newer request.
        await cache.delete(key);
        assertCurrent();
        return undefined;
      }
    });
  }

  private writePrivateCache<K, T>(cache: ICacheService<K, unknown>, key: K, value: T, context: ApiContext | undefined,
    assertCurrent: () => void, parse: (value: unknown) => T): Promise<void> {
    const entry = { sessionId: context?.sessionId ?? null, userId: context?.userId ?? null, value: parse(value) };
    return this.mutateCache(async () => {
      assertCurrent();
      try {
        await cache.set(key, entry);
        assertCurrent();
      } catch (error) {
        // An external auth clear can run while set is suspended. Remove the stale
        // completion before the next session's queued write can replace it.
        await cache.delete(key);
        throw error;
      }
    });
  }

  private recordFailure(key: string, ttl: number): void {
    this.failedFetches.delete(key);
    if (this.failedFetches.size >= 200) this.failedFetches.delete(this.failedFetches.keys().next().value!);
    this.failedFetches.set(key, Date.now() + ttl);
  }

  /** Cache configuration constants */
  private readonly CONFIG = {
    FRIEND_CACHE: { namespace: 'social_friends', maxSize: 100, ttlMs: 24 * 60 * 60 * 1000, persistent: false },
    FOLLOWING_CACHE: { namespace: 'social_followings', maxSize: 1, ttlMs: 24 * 60 * 60 * 1000 },
    FOLLOWER_CACHE: { namespace: 'social_followers', maxSize: 1, ttlMs: 24 * 60 * 60 * 1000 },
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
    this.friendCache = cacheFactory.create<number, unknown>(this.CONFIG.FRIEND_CACHE);
    this.followingCache = cacheFactory.create<string, unknown>(this.CONFIG.FOLLOWING_CACHE);
    this.followerCache = cacheFactory.create<string, unknown>(this.CONFIG.FOLLOWER_CACHE);
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
    if (!Array.isArray(mediaIds) || mediaIds.length > 10000 || !mediaIds.every(isAniListId)) throw new Error('Invalid media IDs');
    const ids = [...new Set(mediaIds)];
    const generation = this.cacheGeneration;
    const context = await captureApiContext(this.api);
    const assertCurrent = () => {
      assertApiContext(this.api, context);
      if (generation !== this.cacheGeneration) throw new Error('Social cache context changed');
    };
    assertCurrent();
    const results = new Map<number, FriendActivity[]>();
    const pendingIds: number[] = [];
    for (const id of ids) {
      const cached = await this.readPrivateCache(this.friendCache, id, context, assertCurrent, parseCachedFriends);
      assertCurrent();
      if (cached !== undefined) results.set(id, structuredClone(cached));
      else pendingIds.push(id);
    }
    if (!pendingIds.length) return results;
    const viewerId = this.api.isAuthenticated() ? await this.getViewerId() : null;
    assertCurrent();
    const query = `query ($mediaId: Int!) {
      Page(perPage: 6) {
        mediaList(mediaId: $mediaId, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
          mediaId userId user { id name avatar { medium } } status progress score(format: POINT_100)
        }
      }
    }`;
    await Promise.all(pendingIds.map(async mediaId => {
      try {
        const response = await this.batcher.query<unknown>(query, { mediaId });
        assertCurrent();
        const activities = parseFriendActivity(response, mediaId).filter(entry => entry.user.id !== viewerId);
        await this.writePrivateCache(this.friendCache, mediaId, activities, context, assertCurrent, parseCachedFriends);
        assertCurrent();
        results.set(mediaId, activities);
      } catch (error) {
        assertCurrent();
        logger.error(`[SocialService] Failed to fetch activity for media ${mediaId}`, error);
      }
    }));
    assertCurrent();
    return results;
  }

  /** Public viewer metadata is already cached by the API/auth layer. */
  public async getViewerId(): Promise<number | null> {
    if (!this.api.isAuthenticated()) return null;
    const context = await captureApiContext(this.api);
    try {
      const id = await this.api.getCurrentUserId();
      assertApiContext(this.api, context);
      if (!isAniListId(id)) throw new Error('Invalid viewer ID');
      return id;
    } catch (error) {
      assertApiContext(this.api, context);
      logger.error('[SocialService] Failed to fetch viewer ID', error);
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
    status?: MediaListStatus | 'all',
    userIds?: readonly number[]
  ): Promise<{ nodes: SocialActivityDetailed[], hasNextPage: boolean }> {
    if (!isAniListId(mediaId) || !isAniListId(page) || !['self', 'following', 'friends', 'global'].includes(filter)
      || (status !== undefined && status !== 'all' && !isAniListStatus(status))
      || (userIds !== undefined && (!Array.isArray(userIds) || userIds.length > 10000 || !userIds.every(isAniListId)))) throw new Error('Invalid social filters');
    if (page > 167) throw new SocialPaginationLimitError();
    const selectedUsers = userIds === undefined ? undefined : [...new Set(userIds)];
    const selectedUserSet = selectedUsers === undefined ? undefined : new Set(selectedUsers);
    if (filter === 'friends' && selectedUsers === undefined) throw new Error('Invalid friends selection');
    if (selectedUsers?.length === 0) return { nodes: [], hasNextPage: false };
    const query = `
      query($mediaId: Int, $isFollowing: Boolean, $userId: Int, $page: Int, $perPage: Int, $status: MediaListStatus, $userIds: [Int]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          mediaList(mediaId: $mediaId, isFollowing: $isFollowing, userId: $userId, userId_in: $userIds, status: $status, sort: [UPDATED_TIME_DESC]) {
            id
            mediaId
            userId
            status
            progress
            score(format: POINT_100)
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

    const context = await captureApiContext(this.api);
    // 166 pages of 30 cover 4,980 entries. A final provider page of 20 at
    // index 250 covers the remaining 20 without exceeding page * perPage = 5000.
    const variables: Record<string, unknown> = { mediaId, page: page === 167 ? 250 : page, perPage: page === 167 ? 20 : 30 };
    if (status && status !== 'all') {
      variables.status = status.toUpperCase();
    }

    if (selectedUsers !== undefined) variables.userIds = selectedUsers;
    if (filter === 'following' || filter === 'friends') {
      // An explicit user snapshot already scopes the query; isFollowing would drop members the viewer does not follow.
      if (selectedUsers === undefined) variables.isFollowing = true;
    } else if (filter === 'self') {
      const viewerId = await this.getViewerId();
      assertApiContext(this.api, context);
      if (viewerId) {
        variables.userId = viewerId;
      } else {
        throw new Error('User not authenticated');
      }
    }

    try {
      const response = await this.api.query<unknown>(query, variables);
      assertApiContext(this.api, context);
      const result = parseDetailedActivity(response, mediaId, page === 167 ? 20 : 30);
      if (result.nodes.some(node => (selectedUserSet !== undefined && !selectedUserSet.has(node.user.id))
        || (variables.userId !== undefined && node.user.id !== variables.userId))) throw new Error('Invalid social identity');
      if (page === 167 && result.hasNextPage) throw new SocialPaginationLimitError();
      return result;
    } catch (e) {
      logger.error(`[SocialService] Failed to fetch detailed activity`, e);
      throw e;
    }
  }

  /**
   * Fetches the complete list of users followed by the current viewer.
   * Uses memory caching and rejects a provider-capped partial list as incomplete.
   */
  public async getAllFollowings(): Promise<FollowingUser[]> {
    return this.getAllRelationUsers('following');
  }

  /** Fetches and caches the complete list of users who follow the current viewer. */
  public async getAllFollowers(): Promise<FollowingUser[]> {
    return this.getAllRelationUsers('followers');
  }

  private async getAllRelationUsers(relation: 'following' | 'followers'): Promise<FollowingUser[]> {
    const generation = this.cacheGeneration;
    const relationGeneration = relation === 'following' ? this.followingGeneration : this.followerGeneration;
    const context = await captureApiContext(this.api);
    const assertCurrent = () => {
      assertApiContext(this.api, context);
      const currentRelationGeneration = relation === 'following' ? this.followingGeneration : this.followerGeneration;
      if (generation !== this.cacheGeneration || relationGeneration !== currentRelationGeneration) throw new Error('Social cache context changed');
    };
    const viewerId = await this.getViewerId();
    assertCurrent();
    const key = String(viewerId);
    const cache = relation === 'following' ? this.followingCache : this.followerCache;
    const cached = await this.readPrivateCache(cache, key, context, assertCurrent, parseCachedFollowings);
    assertCurrent();
    if (cached !== undefined) return cached;
    if (!viewerId) throw new Error('User not authenticated');

    const query = `query($userId: Int!, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        ${relation}(userId: $userId) { id name avatar { medium } }
      }
    }`;
    const allUsers: FollowingUser[] = [];
    let hasNextPage = true;
    let page = 1;
    const maxPages = 100; // Provider Page depth limit: page * perPage <= 5000.
    while (hasNextPage && page <= maxPages) {
      try {
        const response = await this.api.query<unknown>(query, { userId: viewerId, page });
        assertCurrent();
        const result = parseFollowingPage(response, relation);
        allUsers.push(...result.nodes);
        hasNextPage = result.hasNextPage;
        page++;
      } catch (error) {
        logger.error(`[SocialService] ${relation} page ${page} failed`, error);
        throw error;
      }
    }
    assertCurrent();
    if (hasNextPage) throw new SocialPaginationLimitError();
    const unique = [...new Map(allUsers.map(user => [user.id, user])).values()];
    await this.writePrivateCache(cache, key, unique, context, assertCurrent, parseCachedFollowings);
    assertCurrent();
    return unique;
  }

  /**
   * Invalidates followings cache and triggers a re-fetch.
   */
  public async refreshFollowings(): Promise<FollowingUser[]> {
    const context = await captureApiContext(this.api);
    assertApiContext(this.api, context);
    this.followingGeneration++;
    await this.mutateCache(async () => {
      assertApiContext(this.api, context);
      await this.followingCache.clear();
      assertApiContext(this.api, context);
    });
    return this.getAllFollowings();
  }

  /** Invalidates followers cache and triggers a re-fetch. */
  public async refreshFollowers(): Promise<FollowingUser[]> {
    const context = await captureApiContext(this.api);
    assertApiContext(this.api, context);
    this.followerGeneration++;
    await this.mutateCache(async () => {
      assertApiContext(this.api, context);
      await this.followerCache.clear();
      assertApiContext(this.api, context);
    });
    return this.getAllFollowers();
  }

  /**
   * Fetches full user profile data with persistent caching.
   * 
   * @param name User name to query
   * @returns User data or null if not found
   */
  public async getFullUser(name: string): Promise<FullUserData | null> {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('Invalid user name');
    const context = await captureApiContext(this.api);
    const generation = this.cacheGeneration;
    const cacheKey = name.toLowerCase();
    const assertCurrent = () => {
      assertApiContext(this.api, context);
      if (generation !== this.cacheGeneration) throw new Error('Social cache context changed');
    };
    for (const [key, expiresAt] of this.failedFetches) if (expiresAt <= Date.now()) this.failedFetches.delete(key);

    // Check if we previously failed this fetch recently
    const lastFailure = this.failedFetches.get(cacheKey);
    if (lastFailure !== undefined && lastFailure > Date.now()) {
      return null;
    }

    const cached = await this.userCache.get(cacheKey);
    assertCurrent();
    if (cached && Number.isSafeInteger(cached.id) && cached.id > 0 && typeof cached.name === 'string'
      && typeof cached.avatar?.medium === 'string' && Number.isSafeInteger(cached.following) && cached.following >= 0
      && Number.isSafeInteger(cached.followers) && cached.followers >= 0) return cached;

    const userQuery = `query ($name: String) { User(name: $name) { id name avatar { medium } } }`;

    try {
      const userResponse = await this.api.query<{ User: unknown }>(userQuery, { name });
      assertCurrent();
      if (userResponse?.User === null) {
        // Not found is a permanent failure for this session
        this.recordFailure(cacheKey, 24 * 60 * 60 * 1000);
        return null;
      }

      const user = userResponse?.User;
      if (!isRecord(user) || !Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.name !== 'string'
        || (user.avatar != null && (!isRecord(user.avatar) || (user.avatar.medium != null && typeof user.avatar.medium !== 'string')))) throw new Error('Invalid user response');
      const countsQuery = `
        query ($userId: Int!) {
          following: Page(perPage: 1) { pageInfo { total } following(userId: $userId) { id } }
          followers: Page(perPage: 1) { pageInfo { total } followers(userId: $userId) { id } }
        }
      `;

      const countsResponse = await this.api.query<{
        following: { pageInfo: { total: number | null } }; followers: { pageInfo: { total: number | null } };
      }>(countsQuery, { userId: user.id });
      assertCurrent();
      const following = countsResponse?.following?.pageInfo?.total;
      const followers = countsResponse?.followers?.pageInfo?.total;
      if ((following !== null && (!Number.isSafeInteger(following) || Number(following) < 0))
        || (followers !== null && (!Number.isSafeInteger(followers) || Number(followers) < 0))) throw new Error('Invalid user count response');

      const userData: FullUserData = {
        id: Number(user.id),
        name: user.name,
        avatar: { medium: isRecord(user.avatar) && typeof user.avatar.medium === 'string' ? user.avatar.medium : '' },
        following: following ?? 0,
        followers: followers ?? 0
      };

      await this.userCache.set(cacheKey, userData);
      this.failedFetches.delete(cacheKey);
      return userData;
    } catch (e) {
      assertCurrent();
      logger.error(`[SocialService] Full user fetch failed for ${name}`, e);
      this.recordFailure(cacheKey, this.FAILURE_TTL_MS);
      return null;
    }
  }

  /**
   * Clears all social-related caches.
   */
  public async clearAllCaches(): Promise<void> {
    this.cacheGeneration++;
    this.failedFetches.clear();
    await this.mutateCache(async () => {
      await this.friendCache.clear();
      await this.followingCache.clear();
      await this.followerCache.clear();
      await this.userCache.clear();
    });
    logger.info('[SocialService] All social caches cleared');
  }
}
