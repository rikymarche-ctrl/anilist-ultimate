/**
 * Storage Manager
 * Handles chrome.storage operations with type safety
 */

import { injectable } from 'tsyringe';
import type { StorageArea } from '@core/types';
import { STORAGE_PREFIX } from '@core/constants';
import type { IStorageService } from '@core/interfaces/IStorageService';

/**
 * StorageManager - Chrome storage wrapper with type safety
 * Implements IStorageService interface for dependency injection
 */
@injectable()
export class StorageManager implements IStorageService {
  private area: StorageArea;

  constructor(area: StorageArea = 'sync') {
    this.area = area;
  }

  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      const result = await chrome.storage[this.area].get(prefixedKey);

      if (result[prefixedKey] !== undefined) {
        return result[prefixedKey] as T;
      }

      return null;
    } catch (error) {
      console.error(`[StorageManager] Error getting key "${key}":`, error);
      return null;
    }
  }

  /**
   * Get multiple values from storage
   */
  async getMultiple<T extends Record<string, any>>(keys: string[]): Promise<Partial<T>> {
    try {
      const prefixedKeys = keys.map(k => this.getPrefixedKey(k));
      const result = await chrome.storage[this.area].get(prefixedKeys);

      // Remove prefix from keys in result
      const unprefixed: Partial<T> = {};
      for (const prefixedKey in result) {
        const originalKey = this.removePrefixFromKey(prefixedKey);
        unprefixed[originalKey as keyof T] = result[prefixedKey];
      }

      return unprefixed;
    } catch (error) {
      console.error('[StorageManager] Error getting multiple keys:', error);
      return {};
    }
  }

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      await chrome.storage[this.area].set({ [prefixedKey]: value });
      return true;
    } catch (error) {
      console.error(`[StorageManager] Error setting key "${key}":`, error);
      return false;
    }
  }

  /**
   * Set multiple values in storage
   */
  async setMultiple<T extends Record<string, any>>(items: T): Promise<boolean> {
    try {
      const prefixedItems: Record<string, any> = {};
      for (const key in items) {
        const prefixedKey = this.getPrefixedKey(key);
        prefixedItems[prefixedKey] = items[key];
      }

      await chrome.storage[this.area].set(prefixedItems);
      return true;
    } catch (error) {
      console.error('[StorageManager] Error setting multiple keys:', error);
      return false;
    }
  }

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      const prefixedKey = this.getPrefixedKey(key);
      await chrome.storage[this.area].remove(prefixedKey);
      return true;
    } catch (error) {
      console.error(`[StorageManager] Error removing key "${key}":`, error);
      return false;
    }
  }

  /**
   * Clear all values with our prefix
   */
  async clear(): Promise<boolean> {
    try {
      const all = await chrome.storage[this.area].get(null);
      const keysToRemove = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));

      if (keysToRemove.length > 0) {
        await chrome.storage[this.area].remove(keysToRemove);
      }

      return true;
    } catch (error) {
      console.error('[StorageManager] Error clearing storage:', error);
      return false;
    }
  }

  /**
   * Get all storage items with our prefix
   */
  async getAll<T extends Record<string, any>>(): Promise<T> {
    try {
      const all = await chrome.storage[this.area].get(null);
      const filtered: Record<string, any> = {};

      for (const key in all) {
        if (key.startsWith(STORAGE_PREFIX)) {
          const originalKey = this.removePrefixFromKey(key);
          filtered[originalKey] = all[key];
        }
      }

      return filtered as T;
    } catch (error) {
      console.error('[StorageManager] Error getting all items:', error);
      return {} as T;
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
        const bytesInUse = await chrome.storage.local.getBytesInUse();
        return {
          bytesInUse,
          quota: chrome.storage.local.QUOTA_BYTES,
        };
      }
    } catch (error) {
      console.error('[StorageManager] Error getting usage:', error);
      return { bytesInUse: 0 };
    }
  }

  /**
   * Watch for changes to a specific key
   */
  onChange<T>(key: string, callback: (newValue: T | null, oldValue: T | null) => void): () => void {
    const prefixedKey = this.getPrefixedKey(key);

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
    // Don't double-prefix
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

/**
 * Singleton instances for backward compatibility
 * Will be replaced by DI container resolution in Phase 4
 */
export const syncStorage = new StorageManager('sync');
export const localStorage = new StorageManager('local');

// Helper functions for common operations
export const storage = {
  /**
   * Get from sync storage
   */
  get: <T>(key: string) => syncStorage.get<T>(key),

  /**
   * Set to sync storage
   */
  set: <T>(key: string, value: T) => syncStorage.set(key, value),

  /**
   * Get from local storage (for large data)
   */
  getLocal: <T>(key: string) => localStorage.get<T>(key),

  /**
   * Set to local storage (for large data)
   */
  setLocal: <T>(key: string, value: T) => localStorage.set(key, value),

  /**
   * Remove from both storages
   */
  remove: async (key: string) => {
    await syncStorage.remove(key);
    await localStorage.remove(key);
  },
};
