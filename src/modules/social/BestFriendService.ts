/**
 * @file BestFriendService.ts
 * @description Manages a curated "best friends" list for activity feed filtering
 *
 * Singleton with lazy init from chrome.storage.local. Provides add/remove/
 * toggle operations for user IDs, and an isBestFriend() check used by
 * the SocialSidebar filter. Map-based in-memory cache for O(1) lookups.
 *
 * @see SocialSidebar.ts for the best-friend filter toggle
 * @see docs/MODULES.md#shared-services
 */

import { storage } from '@core/storage/StorageManager';
import { log } from '@core/logger';

export interface BestFriend {
  id: number;
  name: string;
}

export class BestFriendService {
  private static instance: BestFriendService;
  private bestFriends: Map<number, string> = new Map();
  private readonly STORAGE_KEY = 'au_best_friends';
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    // Don't call async methods in constructor - violates constructor contract
  }

  public static getInstance(): BestFriendService {
    if (!BestFriendService.instance) {
      BestFriendService.instance = new BestFriendService();
    }
    return BestFriendService.instance;
  }

  /**
   * Initialize the service - MUST be called before using
   * Safe to call multiple times (idempotent)
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.load();
    await this.initPromise;
    this.initialized = true;
  }

  private async load(): Promise<void> {
    const list = await storage.get<BestFriend[]>(this.STORAGE_KEY) || [];
    this.bestFriends = new Map(list.map(bf => [bf.id, bf.name]));
  }

  public isBestFriend(userId: number): boolean {
    return this.bestFriends.has(userId);
  }

  public async toggleBestFriend(userId: number, userName: string): Promise<boolean> {
    const isBf = this.isBestFriend(userId);
    
    if (isBf) {
      this.bestFriends.delete(userId);
    } else {
      this.bestFriends.set(userId, userName);
    }

    const list: BestFriend[] = Array.from(this.bestFriends.entries()).map(([id, name]) => ({ id, name }));
    await storage.set(this.STORAGE_KEY, list);
    
    log.info(`[BestFriendService] ${isBf ? 'Removed' : 'Added'} ${userName} to best friends`);
    return !isBf;
  }

  public getBestFriendsList(): BestFriend[] {
    return Array.from(this.bestFriends.entries()).map(([id, name]) => ({ id, name }));
  }
}
