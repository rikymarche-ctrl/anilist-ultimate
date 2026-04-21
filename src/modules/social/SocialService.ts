/**
 * Social Service
 * Handles batched fetching of friend activity and detailed social entries
 */

import { anilistClient } from '@/api/AnilistClient';
import { log } from '@core/logger';
import { FriendActivity, SocialActivityDetailed, SocialFilter } from '@core/types';

export class SocialService {
  private static instance: SocialService;
  private friendCache: Map<number, FriendActivity[]> = new Map();
  private viewerId: number | null = null;
  private cacheDate: string = '';

  private constructor() {
    this.refreshCacheIfNeeded();
  }

  public static getInstance(): SocialService {
    if (!SocialService.instance) {
      SocialService.instance = new SocialService();
    }
    return SocialService.instance;
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
    if (this.viewerId === null && anilistClient.isAuthenticated()) {
      try {
        this.viewerId = await anilistClient.getCurrentUserId();
      } catch (e) {
        log.warn('[SocialService] Failed to fetch Viewer ID');
      }
    }

    const chunkSize = 10;
    for (let i = 0; i < pendingIds.length; i += chunkSize) {
      const chunk = pendingIds.slice(i, i + chunkSize);
      
      const aliases = chunk.map(id => `
        m${id}: Page(perPage: 6) {
          mediaList(mediaId: ${id}, isFollowing: true, sort: [UPDATED_TIME_DESC]) {
            user { id name avatar { medium } }
            status
            progress
            score
          }
        }
      `);

      const query = `query { ${aliases.join('\n')} }`;

      try {
        const response = await anilistClient.query<Record<string, any>>(query);
        
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
        this.viewerId = await anilistClient.getCurrentUserId();
      }
      if (this.viewerId) {
        variables.userId = this.viewerId;
      } else {
        throw new Error('User not authenticated');
      }
    }

    try {
      const response = await anilistClient.query<any>(query, variables);
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
    if (!this.viewerId) {
      try {
        this.viewerId = await anilistClient.getCurrentUserId();
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

    while (hasNextPage) {
      try {
        const response = await anilistClient.query<any>(query, { userId: this.viewerId, page });
        const pageData = response.Page;
        allFollowing = [...allFollowing, ...pageData.following];
        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;
        
        // Safety break for extremely large lists
        if (page > 40) break; 
      } catch (e) {
        log.error(`[SocialService] Failed to fetch following page ${page}`, e);
        break;
      }
    }

    return allFollowing;
  }
}
