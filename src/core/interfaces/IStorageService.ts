/**
 * @file IStorageService.ts
 * @description Contract for persistent key-value storage operations
 *
 * Abstracts chrome.storage (sync/local) behind a generic interface.
 * Supports single/batch get/set, existence checks, removal, clear,
 * and reactive onChange subscriptions.
 *
 * @see StorageManager.ts for the concrete implementation
 */

export interface IStorageService {
  /**
   * Get a value from storage
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in storage
   */
  set<T>(key: string, value: T): Promise<boolean>;

  /**
   * Remove a value from storage
   */
  remove(key: string): Promise<boolean>;

  /**
   * Clear all storage
   */
  clear(): Promise<boolean>;

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get multiple values at once
   */
  getMultiple<T extends Record<string, any>>(keys: string[]): Promise<Partial<T>>;

  /**
   * Set multiple values at once
   */
  setMultiple<T extends Record<string, any>>(items: Partial<T>): Promise<boolean>;

  /**
   * Watch for storage changes
   */
  onChange<T>(
    key: string,
    callback: (newValue: T | null, oldValue: T | null) => void
  ): () => void;
}
