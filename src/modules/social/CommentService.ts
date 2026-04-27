/**
 * @file CommentService.ts
 * @description User notes/comments fetching with dual-tier TTL-based caching
 *
 * Fetches MediaList notes for user-media pairs via GraphQL alias batching.
 * Implements intelligent caching:
 *   - 48-hour TTL for valid comments
 *   - 1-hour TTL for empty/404 responses (negative caching)
 *
 * @warning HTML escaping is applied before markdown parsing, but post-
 *          markdown replacements may introduce XSS vectors.
 *          See docs/SECURITY.md#sec-001.
 *
 * @see CommentTooltip.ts for the display component
 * @see HoverCommentsModule.ts for the integration layer
 * @see docs/MODULES.md#6-hover-comments-module
 */

import { injectable, inject } from 'tsyringe';
import { storage } from '@core/storage/StorageManager';
import { log } from '@core/logger';
import { TIME } from '@core/constants';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';

export interface UserComment {
  username: string;
  mediaId: number;
  notes: string;
  timestamp: number;
}

@injectable()
export class CommentService {
  private cache: Record<string, UserComment> = {};
  private readonly CACHE_KEY = 'hover_comments_cache';
  private readonly CACHE_MAX_AGE = 2 * TIME.DAY_MS; // 48 hours for valid comments
  private readonly NEGATIVE_CACHE_AGE = TIME.HOUR_MS; // 1 hour for empty/not found lists

  constructor(@inject(TOKENS.ApiClient) private apiClient: IApiClient) {}

  /**
   * Load cache from storage
   */
  public async init(): Promise<void> {
    try {
      const stored = await storage.get<Record<string, UserComment>>(this.CACHE_KEY);
      if (stored) {
        this.cache = stored;
        this.cleanCache();
      }
    } catch (error) {
      log.warn('Failed to load comment cache', error);
      this.cache = {};
    }
  }

  /**
   * Get a user's comment for a specific media
   */
  public async getComment(username: string, mediaId: number, forceRefresh = false): Promise<UserComment | null> {
    const key = this.getCacheKey(username, mediaId);
    const cached = this.cache[key];

    if (!forceRefresh && cached) {
      const age = Date.now() - cached.timestamp;
      const isValid = cached.notes ? age < this.CACHE_MAX_AGE : age < this.NEGATIVE_CACHE_AGE;
      
      if (isValid) {
        return cached;
      }
    }

    return this.fetchComment(username, mediaId);
  }

  /**
   * Fetch comment from Anilist API
   */
  private async fetchComment(username: string, mediaId: number): Promise<UserComment | null> {
    const query = `
      query ($userName: String, $mediaId: Int) {
        MediaList(userName: $userName, mediaId: $mediaId) {
          notes
        }
      }
    `;

    try {
      const data = await this.apiClient.query<{ MediaList: { notes: string } | null }>(query, {
        userName: username,
        mediaId: mediaId,
      });

      const notes = data?.MediaList?.notes || '';
      const comment: UserComment = {
        username,
        mediaId,
        notes,
        timestamp: Date.now(),
      };

      this.saveToCache(comment);
      return comment;
    } catch (error) {
      // If 404/not found, it means the user doesn't have the anime on their list
      log.debug(`Could not fetch comment for ${username} on media ${mediaId}`, error);
      
      // Negative cache to avoid spamming 404s
      const negativeComment: UserComment = {
        username,
        mediaId,
        notes: '',
        timestamp: Date.now(),
      };
      this.saveToCache(negativeComment);
      
      return null;
    }
  }

  /**
   * Check if we have a valid non-empty comment in cache
   */
  public hasValidComment(username: string, mediaId: number): boolean {
    const key = this.getCacheKey(username, mediaId);
    const cached = this.cache[key];
    if (!cached || !cached.notes) return false;
    
    const age = Date.now() - cached.timestamp;
    return age < this.CACHE_MAX_AGE;
  }

  private getCacheKey(username: string, mediaId: number): string {
    return `${username.toLowerCase()}_${mediaId}`;
  }

  private saveToCache(comment: UserComment): void {
    const key = this.getCacheKey(comment.username, comment.mediaId);
    this.cache[key] = comment;
    
    // Throttled save could be implemented, but simple save for now
    storage.set(this.CACHE_KEY, this.cache);
  }

  private cleanCache(): void {
    const now = Date.now();
    let changed = false;

    for (const key in this.cache) {
      const age = now - this.cache[key].timestamp;
      if (age > this.CACHE_MAX_AGE) {
        delete this.cache[key];
        changed = true;
      }
    }

    if (changed) {
      storage.set(this.CACHE_KEY, this.cache);
    }
  }
}
