/**
 * @file AuthTokenService.ts
 * @description Centralized OAuth token storage and lifecycle management
 *
 * Single source of truth for the AniList OAuth access token.
 * Replaces the previous pattern of 6 duplicate localStorage keys.
 *
 * Token Storage:
 *   - Primary key: localStorage['anilist_ultimate_v2_access_token']
 *   - Legacy migration: checks 5 legacy keys and migrates to primary
 *   - In-memory cache to avoid repeated localStorage reads
 *
 * Events:
 *   - AUTH_STATE_CHANGED emitted on setToken() and clearToken()
 *
 * @warning AnilistClient.ts also manages tokens independently.
 *          See docs/SECURITY.md#sec-004 for the dual-management issue.
 *          This service should be the ONLY token manager.
 *
 * @see docs/ARCHITECTURE.md#48-authentication
 */

import { injectable, inject } from 'tsyringe';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

/**
 * Auth Token Service
 * Single source of truth for OAuth access token
 */
@injectable()
export class AuthTokenService {
  /**
   * Single standardized storage key
   */
  private readonly STORAGE_KEY = 'anilist_ultimate_v2_access_token';

  /**
   * Legacy keys to check for migration
   */
  private readonly LEGACY_KEYS = [
    'access_token',
    'accessToken',
    'token',
    'auth_token',
    'jwt',
  ];

  private cachedToken: string | null = null;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {}

  /**
   * Get OAuth access token
   * Migrates from legacy keys if needed
   */
  getToken(): string | null {
    // Return cached if available
    if (this.cachedToken) {
      return this.cachedToken;
    }

    // Check primary key in localStorage
    let token = localStorage.getItem(this.STORAGE_KEY);

    // Also check sessionStorage for primary key (BUG-001 fix: was missing)
    if (!token) {
      token = sessionStorage.getItem(this.STORAGE_KEY);
      if (token) {
        this.logger.info('[AuthTokenService] Found token in sessionStorage, migrating to localStorage');
        // Migrate to localStorage
        localStorage.setItem(this.STORAGE_KEY, token);
      }
    }

    // If not found, check legacy keys and migrate
    if (!token) {
      token = this.migrateFromLegacyKeys();
    }

    // Strip quotes if any
    if (token) {
      token = token.replace(/"/g, '');
      this.cachedToken = token;
    }

    return token;
  }

  /**
   * Set OAuth access token
   */
  setToken(token: string): void {
    // Save to primary key only
    localStorage.setItem(this.STORAGE_KEY, token);
    this.cachedToken = token;

    // Clean up legacy keys
    this.cleanupLegacyKeys();

    this.logger.info('[AuthTokenService] Token saved');

    // Emit AUTH_STATE_CHANGED event
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: undefined, // Will be populated by modules if needed
      timestamp: new Date(),
    });
  }

  /**
   * Clear OAuth access token
   */
  clearToken(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.cachedToken = null;

    // Clean up legacy keys
    this.cleanupLegacyKeys();

    this.logger.info('[AuthTokenService] Token cleared');

    // Emit AUTH_STATE_CHANGED event
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: false,
      userId: undefined,
      timestamp: new Date(),
    });
  }

  /**
   * Check if token exists
   */
  hasToken(): boolean {
    return this.getToken() !== null;
  }

  /**
   * Migrate token from legacy keys
   */
  private migrateFromLegacyKeys(): string | null {
    // Try each legacy key
    for (const key of this.LEGACY_KEYS) {
      const token = localStorage.getItem(key);
      if (token) {
        this.logger.info(`[AuthTokenService] Migrating token from legacy key: ${key}`);

        // Save to new key
        localStorage.setItem(this.STORAGE_KEY, token);

        // Clean up legacy keys
        this.cleanupLegacyKeys();

        return token;
      }
    }

    // Also check sessionStorage
    for (const key of this.LEGACY_KEYS) {
      const token = sessionStorage.getItem(key);
      if (token) {
        this.logger.info(`[AuthTokenService] Migrating token from sessionStorage: ${key}`);

        // Save to localStorage with new key
        localStorage.setItem(this.STORAGE_KEY, token);

        // Clean up legacy keys
        this.cleanupLegacyKeys();

        return token;
      }
    }

    return null;
  }

  /**
   * Remove all legacy keys
   */
  private cleanupLegacyKeys(): void {
    this.LEGACY_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }
}
