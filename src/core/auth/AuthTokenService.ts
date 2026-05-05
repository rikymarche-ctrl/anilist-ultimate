/**
 * @file AuthTokenService.ts
 * @description Centralized OAuth token storage and lifecycle management.
 *
 * Pattern: **Async-init, sync-read**
 */

import { injectable, inject } from 'tsyringe';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, type UserCache } from '@shared/messages';

/**
 * Auth Token Service
 * Single source of truth for OAuth access token.
 */
@injectable()
export class AuthTokenService {
  private cachedToken: string | null = null;
  private cachedUserCache: UserCache | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    this.setupStorageListener();
  }

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.logger.info('[AuthTokenService] Initializing...');

      try {
        const token = await this.storage.get<string>(AUTH_STORAGE_KEY);
        const userCache = await this.storage.get<UserCache>(AUTH_USER_CACHE_KEY);

        this.cachedToken = token || null;
        this.cachedUserCache = userCache || null;
        this.initialized = true;

        if (this.cachedToken) {
          this.logger.info('[AuthTokenService] Token loaded');
          this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
            isAuthenticated: true,
            userId: this.cachedUserCache?.userId,
            timestamp: new Date()
          });
        }
      } catch (error) {
        this.logger.error('[AuthTokenService] Initialization failed', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    return this.initialize();
  }

  getToken(): string | null {
    return this.cachedToken;
  }

  hasToken(): boolean {
    return this.cachedToken !== null;
  }

  getUserCache(): UserCache | null {
    return this.cachedUserCache;
  }

  async setToken(token: string, userCache?: UserCache): Promise<void> {
    await this.storage.set(AUTH_STORAGE_KEY, token);

    if (userCache) {
      await this.storage.set(AUTH_USER_CACHE_KEY, userCache);
      this.cachedUserCache = userCache;
    }

    this.cachedToken = token;
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: userCache?.userId,
      timestamp: new Date(),
    });
  }

  async clearToken(): Promise<void> {
    await this.storage.remove(AUTH_STORAGE_KEY);
    await this.storage.remove(AUTH_USER_CACHE_KEY);

    this.cachedToken = null;
    this.cachedUserCache = null;

    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: false,
      userId: undefined,
      timestamp: new Date(),
    });
  }

  private setupStorageListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes[AUTH_STORAGE_KEY]) {
        const newToken = changes[AUTH_STORAGE_KEY].newValue as string | undefined;
        this.cachedToken = newToken || null;
        
        this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
          isAuthenticated: !!newToken,
          userId: this.cachedUserCache?.userId,
          timestamp: new Date(),
        });
      }

      if (changes[AUTH_USER_CACHE_KEY]) {
        this.cachedUserCache = (changes[AUTH_USER_CACHE_KEY].newValue as UserCache) || null;
      }
    });
  }
}
