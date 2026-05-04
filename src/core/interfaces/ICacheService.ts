/**
 * @file ICacheService.ts
 * @description Standard interface for all caching implementations within the application.
 */

/**
 * Standard entry format for cached data
 */
export interface CacheEntry<V> {
  /** The cached data */
  value: V;
  /** UNIX timestamp (ms) of when the data was stored */
  timestamp: number;
}

/**
 * Options for configuring a cache instance via the CacheFactory
 */
export interface CacheOptions {
  /** Maximum number of items in memory (LRU policy) */
  maxSize?: number;
  /** Time-To-Live in milliseconds */
  ttlMs?: number;
  /** Unique key for storage isolation */
  namespace?: string;
  /** Whether data should persist across sessions/reloads */
  persistent?: boolean;
}

/**
 * Generic Cache Service Interface.
 * Implementations must handle TTL validation and optional persistence.
 */
export interface ICacheService<K, V> {
  /**
   * Retrieves a value from the cache.
   * @param key The unique key to look up
   */
  get(key: K): Promise<V | undefined>;

  /**
   * Stores a value in the cache.
   * @param key Unique key
   * @param value Data to store
   */
  set(key: K, value: V): Promise<void>;

  /**
   * Removes a specific key from the cache.
   * @param key Key to remove
   */
  delete(key: K): Promise<void>;

  /**
   * Removes all entries from the cache instance.
   */
  clear(): Promise<void>;

  /**
   * Checks for key existence without refreshing LRU position.
   * @param key Key to check
   */
  has(key: K): Promise<boolean>;

  /**
   * Returns the current number of items stored in memory.
   */
  size(): number;
}
