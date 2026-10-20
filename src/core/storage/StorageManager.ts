import { logger } from '@core/logger';
/**
 * @file StorageManager.ts
 * @description Type-safe wrapper around Chrome Extension storage APIs
 *
 * Provides a unified interface for both chrome.storage.sync (small data,
 * synced across devices) and chrome.storage.local (large data, device-local).
 *
 * Features:
 *   - Automatic key prefixing (anilist_ultimate_) to avoid collisions
 *   - Anti-double-prefix protection
 *   - Batch get/set operations
 *   - Change listeners via chrome.storage.onChanged
 *   - Storage quota monitoring
 *   - Scoped clear (only removes prefixed keys)
 *
 * Instances are registered by the composition root and injected into consumers.
 *
 * @see docs/ARCHITECTURE.md#45-storage-manager
 */

import { injectable, inject } from 'tsyringe';
import type { StorageArea } from '@core/types';
import { STORAGE_PREFIX } from '@core/constants';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IErrorHandler } from '@core/errors/ErrorHandler';
import { localStorageOperation, needsLocalStorageBridge } from './LocalStorageBridge';
import { MSG } from '@shared/messages';

/**
 * StorageManager - Chrome storage wrapper with type safety
 * Implements IStorageService interface for dependency injection
 */
@injectable()
export class StorageManager implements IStorageService {
  constructor(
    private area: StorageArea = 'sync',
    @inject(TOKENS.Logger) private logger?: ILogger,
    @inject(TOKENS.ErrorHandler) private errorHandler?: IErrorHandler
  ) {}

  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      const result = this.area === 'local' ? await localStorageOperation('get', prefixedKey) : await chrome.storage.sync.get(prefixedKey);

      if (result[prefixedKey] !== undefined) {
        return result[prefixedKey] as T;
      }

      return null;
    } catch (error) {
      this.handleStorageError(error as Error, `getting key "${key}"`);
      // A failed read is not a missing key: callers must never overwrite durable
      // data with defaults after an API/storage error.
      throw error;
    }
  }

  /**
   * Get multiple values from storage
   */
  async getMultiple<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    try {
      const prefixedKeys = keys.map(k => this.getPrefixedKey(k));
      const result = this.area === 'local' ? await localStorageOperation('get', prefixedKeys) : await chrome.storage.sync.get(prefixedKeys);

      // Preserve each caller's key. Some contracts (notably auth) already use
      // fully prefixed keys; stripping them would make persisted values appear
      // absent and can restart initialization indefinitely.
      const values: Partial<T> = {};
      for (const key of keys) {
        const prefixedKey = this.getPrefixedKey(key);
        if (Object.prototype.hasOwnProperty.call(result, prefixedKey)) {
          Object.defineProperty(values, key, { value: result[prefixedKey], enumerable: true, configurable: true, writable: true });
        }
      }

      return values;
    } catch (error) {
      this.handleStorageError(error as Error, 'getting multiple keys');
      throw error;
    }
  }

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      if (this.area === 'local') await localStorageOperation('set', { [prefixedKey]: value });
      else await chrome.storage.sync.set({ [prefixedKey]: value });
      return true;
    } catch (error) {
      this.handleStorageError(error as Error, `setting key "${key}"`);
      return false;
    }
  }

  /**
   * Set multiple values in storage
   */
  async setMultiple<T extends Record<string, unknown>>(items: T): Promise<boolean> {
    try {
      const prefixedItems: Record<string, unknown> = {};
      for (const key in items) {
        const prefixedKey = this.getPrefixedKey(key);
        prefixedItems[prefixedKey] = items[key];
      }

      if (this.area === 'local') await localStorageOperation('set', prefixedItems);
      else await chrome.storage.sync.set(prefixedItems);
      return true;
    } catch (error) {
      this.handleStorageError(error as Error, 'setting multiple keys');
      return false;
    }
  }

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      if (this.area === 'local') await localStorageOperation('remove', prefixedKey);
      else await chrome.storage.sync.remove(prefixedKey);
      return true;
    } catch (error) {
      this.handleStorageError(error as Error, `removing key "${key}"`);
      return false;
    }
  }

  /**
   * Clear all values with our prefix
   */
  async clear(): Promise<boolean> {
    try {
      const all = this.area === 'local' ? await localStorageOperation('all') : await chrome.storage.sync.get(null);
      const keysToRemove = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));

      if (keysToRemove.length > 0) {
        if (this.area === 'local') await localStorageOperation('remove', keysToRemove);
        else await chrome.storage.sync.remove(keysToRemove);
      }

      return true;
    } catch (error) {
      this.handleStorageError(error as Error, 'clearing storage');
      return false;
    }
  }

  /**
   * Get all storage items with our prefix
   */
  async getAll<T extends Record<string, unknown>>(): Promise<T> {
    try {
      const all = this.area === 'local' ? await localStorageOperation('all') : await chrome.storage.sync.get(null);
      const filtered: Record<string, unknown> = {};

      for (const key in all) {
        if (key.startsWith(STORAGE_PREFIX)) {
          const originalKey = this.removePrefixFromKey(key);
          filtered[originalKey] = all[key];
        }
      }

      return filtered as T;
    } catch (error) {
      this.handleStorageError(error as Error, 'getting all items');
      throw error;
    }
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * Get storage usage info
   */
  async getUsage(): Promise<{ bytesInUse: number; quota?: number }> {
    try {
      if (this.area === 'sync') {
        const bytesInUse = await chrome.storage.sync.getBytesInUse();
        return {
          bytesInUse,
          quota: chrome.storage.sync.QUOTA_BYTES,
        };
      } else {
        const usage = await localStorageOperation('usage');
        return { bytesInUse: usage.bytesInUse as number, quota: usage.quota as number | undefined };
      }
    } catch (error) {
      this.handleStorageError(error as Error, 'getting usage');
      return { bytesInUse: 0 };
    }
  }

  /**
   * Handle storage errors gracefully
   */
  private handleStorageError(error: Error, context: string): void {
    const message = error.message;
    
    if (message.includes('Extension context invalidated') || message.includes('context_invalidated')) {
      StorageManager.contextDead = true;
      if (this.logger) {
        this.logger.warn(`[StorageManager] Extension updated/reloaded. Please refresh the page. (Context: ${context})`);
      }
    } else {
      if (this.errorHandler) {
        this.errorHandler.handle(error, `StorageManager (${this.area}) - ${context}`);
      } else {
        logger.error(`[StorageManager] [Fallback] Error ${context}:`, error);
      }
    }
  }

  private static contextDead = false;

  /**
   * Check if the extension context is dead
   */
  public static isContextDead(): boolean {
    if (StorageManager.contextDead) return true;
    try {
      return !chrome.runtime?.id;
    } catch {
      StorageManager.contextDead = true;
      return true;
    }
  }

  /**
   * Watch for changes to a specific key
   */
  onChange<T>(key: string, callback: (newValue: T | null, oldValue: T | null) => void): () => void {
    const prefixedKey = this.getPrefixedKey(key);

    if (this.area === 'local' && needsLocalStorageBridge()) {
      let active = true;
      let previous: T | null = null;
      const listener = (message: { type?: string; keys?: string[] }) => {
        if (message.type === MSG.LOCAL_CHANGED && message.keys?.includes(prefixedKey)) {
          void this.get<T>(key).then(value => { if (active) { callback(value, previous); previous = value; } }).catch(error => this.handleStorageError(error as Error, 'change notification'));
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => { active = false; chrome.runtime.onMessage.removeListener(listener); };
    }

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== this.area) return;

      const change = changes[prefixedKey];
      if (change) {
        callback(
          change.newValue !== undefined ? change.newValue : null,
          change.oldValue !== undefined ? change.oldValue : null
        );
      }
    };

    chrome.storage.onChanged.addListener(listener);

    // Return cleanup function
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  /**
   * Add prefix to key
   */
  private getPrefixedKey(key: string): string {
    if (key.startsWith(STORAGE_PREFIX)) {
      return key;
    }
    return STORAGE_PREFIX + key;
  }

  /**
   * Remove prefix from key
   */
  private removePrefixFromKey(key: string): string {
    if (key.startsWith(STORAGE_PREFIX)) {
      return key.slice(STORAGE_PREFIX.length);
    }
    return key;
  }
}
