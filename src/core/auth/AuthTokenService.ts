/**
 * @file AuthTokenService.ts
 * @description Centralized OAuth token storage and lifecycle management (v2 - chrome.storage)
 *
 * Pattern: **Async-init, sync-read**
 *   - initialize() (async): carica il token da chrome.storage.local nella cache in-memory
 *   - getToken() (sync): legge dalla cache - tutti i chiamanti esistenti continuano a funzionare
 *   - setToken() (async): salva in chrome.storage.local
 *   - clearToken() (async): rimuove da chrome.storage.local
 *
 * Token Storage:
 *   - Primary storage: chrome.storage.local (accessibile da tutti i contesti)
 *   - In-memory cache per lettura sincrona
 *   - Legacy migration: migra da localStorage (dominio anilist.co) a chrome.storage.local (one-time)
 *
 * Events:
 *   - AUTH_STATE_CHANGED emesso su setToken() e clearToken()
 *   - chrome.storage.onChanged listener per sincronizzare cache quando il background/popup modifica il token
 *
 * @warning Questo servizio deve essere l'UNICO token manager.
 *          La migrazione OAuth a chrome.identity risolve il dual-management con AnilistClient.
 *
 * @see docs/ARCHITECTURE.md#48-authentication
 * @author ExAstra
 * @version 1.0.0
 */

import { injectable, inject } from 'tsyringe';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, type UserCache } from '@shared/messages';

/**
 * Auth Token Service v2
 * Single source of truth per OAuth access token (migrato a chrome.storage.local)
 */
@injectable()
export class AuthTokenService {
  /**
   * Legacy keys da controllare per migrazione da localStorage
   */
  private readonly LEGACY_KEYS = [
    'anilist_ultimate_access_token',
    'access_token',
    'accessToken',
    'token',
    'auth_token',
    'jwt',
  ];

  /**
   * Flag per indicare se la migrazione legacy è stata completata
   */
  private readonly MIGRATION_FLAG_KEY = '_auth_migrated';

  /**
   * Cache in-memory del token (per lettura sincrona)
   */
  private cachedToken: string | null = null;

  /**
   * Cache in-memory dei dati utente
   */
  private cachedUserCache: UserCache | null = null;

  /**
   * Flag per indicare se initialize() è stato chiamato
   */
  private initialized = false;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    // Listener per sincronizzare la cache quando storage cambia (es. da popup/background)
    this.setupStorageListener();
  }

  /**
   * Inizializza il servizio caricando il token da chrome.storage.local
   * Deve essere chiamato UNA VOLTA in setup.ts PRIMA che i moduli vengano risolti
   *
   * @returns Promise che si risolve quando il token è caricato
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('[AuthTokenService] Already initialized');
      return;
    }

    this.logger.info('[AuthTokenService] Initializing...');

    // Migra da localStorage (one-time)
    await this.migrateFromLegacyStorage();

    // Carica token e user cache da chrome.storage.local
    const result = await chrome.storage.local.get([
      AUTH_STORAGE_KEY,
      AUTH_USER_CACHE_KEY,
    ]);

    this.cachedToken = (result[AUTH_STORAGE_KEY] as string | undefined) || null;
    this.cachedUserCache = (result[AUTH_USER_CACHE_KEY] as UserCache | undefined) || null;

    this.initialized = true;

    if (this.cachedToken) {
      this.logger.info('[AuthTokenService] Token loaded from chrome.storage');
    } else {
      this.logger.info('[AuthTokenService] No token found');
    }
  }

  /**
   * Get OAuth access token (SINCRONO - legge dalla cache)
   * Deve essere chiamato DOPO initialize()
   *
   * @returns Token o null se non autenticato
   */
  getToken(): string | null {
    if (!this.initialized) {
      this.logger.warn('[AuthTokenService] getToken() called before initialize()');
    }
    return this.cachedToken;
  }

  /**
   * Check if token exists (SINCRONO)
   */
  hasToken(): boolean {
    return this.cachedToken !== null;
  }

  /**
   * Get cached user data
   */
  getUserCache(): UserCache | null {
    return this.cachedUserCache;
  }

  /**
   * Set OAuth access token (ASYNC - salva in chrome.storage.local)
   *
   * @param token - OAuth access token
   * @param userCache - Optional user cache (userId, userName)
   */
  async setToken(token: string, userCache?: UserCache): Promise<void> {
    // Salva in chrome.storage.local
    const data: Record<string, unknown> = {
      [AUTH_STORAGE_KEY]: token,
    };

    if (userCache) {
      data[AUTH_USER_CACHE_KEY] = userCache;
      this.cachedUserCache = userCache;
    }

    await chrome.storage.local.set(data);

    // Aggiorna cache in-memory
    this.cachedToken = token;

    this.logger.info('[AuthTokenService] Token saved to chrome.storage');

    // Emit AUTH_STATE_CHANGED event
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: userCache?.userId,
      timestamp: new Date(),
    });
  }

  /**
   * Clear OAuth access token (ASYNC - rimuove da chrome.storage.local)
   */
  async clearToken(): Promise<void> {
    // Rimuovi da chrome.storage.local
    await chrome.storage.local.remove([AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY]);

    // Aggiorna cache in-memory
    this.cachedToken = null;
    this.cachedUserCache = null;

    this.logger.info('[AuthTokenService] Token cleared from chrome.storage');

    // Emit AUTH_STATE_CHANGED event
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: false,
      userId: undefined,
      timestamp: new Date(),
    });
  }

  /**
   * Setup listener per sincronizzare cache quando storage cambia (es. da popup/background)
   */
  private setupStorageListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      // Controlla se il token è cambiato
      if (changes[AUTH_STORAGE_KEY]) {
        const newToken = changes[AUTH_STORAGE_KEY].newValue as string | undefined;
        const oldToken = this.cachedToken;

        this.cachedToken = newToken || null;

        if (newToken !== oldToken) {
          this.logger.info('[AuthTokenService] Token changed by external context');

          // Emit AUTH_STATE_CHANGED event
          this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
            isAuthenticated: !!newToken,
            userId: this.cachedUserCache?.userId,
            timestamp: new Date(),
          });
        }
      }

      // Controlla se user cache è cambiato
      if (changes[AUTH_USER_CACHE_KEY]) {
        const newUserCache = changes[AUTH_USER_CACHE_KEY].newValue as UserCache | undefined;
        this.cachedUserCache = newUserCache || null;
      }
    });
  }

  /**
   * Migra token da localStorage (dominio anilist.co) a chrome.storage.local (one-time)
   */
  private async migrateFromLegacyStorage(): Promise<void> {
    // Controlla se la migrazione è già stata eseguita
    const result = await chrome.storage.local.get(this.MIGRATION_FLAG_KEY);
    if (result[this.MIGRATION_FLAG_KEY]) {
      return; // Migrazione già completata
    }

    this.logger.info('[AuthTokenService] Checking for legacy token in localStorage...');

    // Prova a leggere da localStorage (dominio anilist.co)
    let legacyToken: string | null = null;

    for (const key of this.LEGACY_KEYS) {
      try {
        const token = localStorage.getItem(key);
        if (token) {
          this.logger.info(`[AuthTokenService] Found legacy token in localStorage: ${key}`);
          legacyToken = token.replace(/"/g, ''); // Strip quotes
          break;
        }
      } catch (error) {
        // localStorage potrebbe non essere accessibile in tutti i contesti
        this.logger.warn(`[AuthTokenService] Failed to read localStorage key: ${key}`, error);
      }
    }

    // Prova anche sessionStorage
    if (!legacyToken) {
      for (const key of this.LEGACY_KEYS) {
        try {
          const token = sessionStorage.getItem(key);
          if (token) {
            this.logger.info(`[AuthTokenService] Found legacy token in sessionStorage: ${key}`);
            legacyToken = token.replace(/"/g, '');
            break;
          }
        } catch (error) {
          this.logger.warn(`[AuthTokenService] Failed to read sessionStorage key: ${key}`, error);
        }
      }
    }

    // Se trovato, migra a chrome.storage.local
    if (legacyToken) {
      this.logger.info('[AuthTokenService] Migrating legacy token to chrome.storage.local');
      await chrome.storage.local.set({
        [AUTH_STORAGE_KEY]: legacyToken,
      });

      // Cleanup legacy keys
      this.cleanupLegacyKeys();
    }

    // Marca migrazione come completata
    await chrome.storage.local.set({
      [this.MIGRATION_FLAG_KEY]: true,
    });

    this.logger.info('[AuthTokenService] Legacy migration completed');
  }

  /**
   * Remove all legacy keys from localStorage/sessionStorage
   */
  private cleanupLegacyKeys(): void {
    this.LEGACY_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (error) {
        // Ignore - storage might not be accessible
      }
    });
  }
}
