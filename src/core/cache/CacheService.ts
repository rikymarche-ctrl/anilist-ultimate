/**
 * @file CacheService.ts
 * @description Optimized enterprise cache service with debounced background persistence.
 *
 * This service implements the ICacheService interface and wraps LRUCacheWithTTL to provide:
 * 1. O(1) in-memory operations.
 * 2. Optimized debounced persistence to chrome.storage.local to avoid "Serialization Storms".
 * 3. TTL-based expiration and automatic cleanup.
 * 4. Automatic initialization from storage.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/logger';
import { LRUCacheWithTTL } from './LRUCacheWithTTL';
import type { ICacheService, CacheOptions } from '@core/interfaces/ICacheService';

/**
 * Generic Cache Service implementation.
 * Handles the orchestration between high-speed memory and persistent storage.
 * 
 * @template K Type of the cache key
 * @template V Type of the cache value
 */
@injectable()
export class CacheService<K = string, V = any> implements ICacheService<K, V> {
  /** Internal LRU engine */
  private lru: LRUCacheWithTTL<K, V>;
  /** Unique namespace for storage isolation */
  private namespace: string;
  /** Whether to persist data to disk */
  private persistent: boolean;
  /** Guard for lazy initialization from storage */
  private initialized = false;
  /** Promise guard for concurrent initialization */
  private initPromise: Promise<void> | null = null;
  /** Timer for debounced persistence */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Flag to track changes since last persistence */
  private isDirty = false;

  /** Constants for optimization */
  private readonly DEBOUNCE_MS = 2000; // 2 seconds

  /**
   * @param storage Injected storage service (usually LocalStorageService)
   * @param logger Injected logger
   * @param options Cache configuration (maxSize, ttl, namespace, etc.)
   */
  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.Logger) private logger: ILogger,
    options: CacheOptions = {}
  ) {
    this.namespace = options.namespace || 'default';
    this.persistent = options.persistent ?? true;
    
    this.lru = new LRUCacheWithTTL<K, V>({
      maxSize: options.maxSize || 100,
      ttlMs: options.ttlMs || 30 * 60 * 1000, // 30 mins default
    });
  }

  /**
   * Ensures the cache is populated from persistent storage before use.
   * This is called lazily on the first operation.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized || !this.persistent) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      try {
        const data = await this.storage.get<any[]>(`cache_${this.namespace}`);
        if (data) {
          this.lru.import(data);
          this.logger.debug(`[CacheService:${this.namespace}] Restored ${data.length} items from storage`);
        }
      } catch (error) {
        this.logger.error(`[CacheService:${this.namespace}] Failed to restore cache`, error);
      } finally {
        this.initialized = true;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Retrieves a value from the cache.
   */
  public async get(key: K): Promise<V | undefined> {
    await this.ensureInitialized();
    return this.lru.get(key);
  }

  /**
   * Sets a value in the cache and schedules debounced persistence.
   */
  public async set(key: K, value: V): Promise<void> {
    await this.ensureInitialized();
    this.lru.set(key, value);
    this.markDirty();
  }

  /**
   * Removes an item from the cache and schedules debounced persistence.
   */
  public async delete(key: K): Promise<void> {
    await this.ensureInitialized();
    this.lru.delete(key);
    this.markDirty();
  }

  /**
   * Clears all items from the cache and removes the entry from storage.
   */
  public async clear(): Promise<void> {
    this.lru.clear();
    this.isDirty = false;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persistent) {
      await this.storage.remove(`cache_${this.namespace}`);
    }
  }

  /**
   * Checks if a key exists and is fresh.
   */
  public async has(key: K): Promise<boolean> {
    await this.ensureInitialized();
    return this.lru.has(key);
  }

  /**
   * Returns the current size of the in-memory cache.
   */
  public size(): number {
    return this.lru.size;
  }

  /**
   * Schedules a debounced persistence operation.
   */
  private markDirty(): void {
    if (!this.persistent) return;
    this.isDirty = true;
    
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    
    this.persistTimer = setTimeout(() => {
      this.persist();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Synchronizes the current in-memory state to persistent storage.
   * Performs an internal "Sweep" to remove expired items before saving.
   */
  public async persist(): Promise<void> {
    if (!this.persistent || !this.isDirty) return;
    
    try {
      this.persistTimer = null;
      
      // OPTIMIZATION: The export() call already filters by order.
      // We perform a sweep-on-persist to avoid bloating storage with stale data.
      const data = this.lru.export();
      
      await this.storage.set(`cache_${this.namespace}`, data);
      this.isDirty = false;
      this.logger.debug(`[CacheService:${this.namespace}] Persisted ${data.length} items (Serialization Storm avoided)`);
    } catch (error) {
      this.logger.error(`[CacheService:${this.namespace}] Failed to persist cache`, error);
    }
  }

  /**
   * Forces immediate persistence if there are pending changes.
   * Useful for teardown scenarios.
   */
  public async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      await this.persist();
    }
  }
}
