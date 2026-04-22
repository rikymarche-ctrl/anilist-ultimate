/**
 * Auth Token Service
 * Centralizes OAuth token storage and management
 * Eliminates 6 duplicate localStorage keys
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

    // Check primary key
    let token = localStorage.getItem(this.STORAGE_KEY);

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
