/**
 * @file LRUCacheWithTTL.ts
 * @description Generic LRU cache with TTL support and optional persistence
 * 
 * Pattern: Least Recently Used (LRU) eviction + Time-To-Live (TTL)
 */

export interface CacheOptions<V> {
  maxSize: number;
  ttlMs: number;
  onEvict?: (key: any, value: V) => void;
  onPersistenceNeeded?: () => void;
}

export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export class LRUCacheWithTTL<K, V> {
  private cache = new Map<K, V>();
  private timestamps = new Map<K, number>();
  private order: K[] = [];

  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: K, value: V) => void;
  private readonly onPersistenceNeeded?: () => void;

  constructor(options: CacheOptions<V>) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict;
    this.onPersistenceNeeded = options.onPersistenceNeeded;
  }

  /**
   * Get value from cache
   */
  public get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    // Check TTL
    const timestamp = this.timestamps.get(key);
    if (timestamp && (Date.now() - timestamp) > this.ttlMs) {
      this.delete(key);
      return undefined;
    }

    // Refresh order (LRU)
    this.refresh(key);
    return this.cache.get(key);
  }

  /**
   * Set value in cache
   */
  public set(key: K, value: V): void {
    // If key exists, just update and refresh
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.timestamps.set(key, Date.now());
      this.refresh(key);
      return;
    }

    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.order.shift();
      if (oldest !== undefined) {
        const oldValue = this.cache.get(oldest);
        this.cache.delete(oldest);
        this.timestamps.delete(oldest);
        if (this.onEvict && oldValue !== undefined) {
          this.onEvict(oldest, oldValue);
        }
      }
    }

    // Add new entry
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
    this.order.push(key);

    if (this.onPersistenceNeeded) {
      this.onPersistenceNeeded();
    }
  }

  /**
   * Delete entry from cache
   */
  public delete(key: K): void {
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.timestamps.delete(key);
    this.order = this.order.filter(k => k !== key);

    if (this.onEvict && value !== undefined) {
      this.onEvict(key, value);
    }

    if (this.onPersistenceNeeded) {
      this.onPersistenceNeeded();
    }
  }

  /**
   * Clear entire cache
   */
  public clear(): void {
    this.cache.clear();
    this.timestamps.clear();
    this.order = [];

    if (this.onPersistenceNeeded) {
      this.onPersistenceNeeded();
    }
  }

  /**
   * Check if key exists and is fresh
   */
  public has(key: K): boolean {
    if (!this.cache.has(key)) return false;
    const timestamp = this.timestamps.get(key);
    if (timestamp && (Date.now() - timestamp) > this.ttlMs) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Move key to the end (most recent)
   */
  private refresh(key: K): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) {
      this.order.splice(idx, 1);
    }
    this.order.push(key);
  }

  /**
   * Get size of cache
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Export cache for persistence
   */
  public export(): Map<K, CacheEntry<V>> {
    const data = new Map<K, CacheEntry<V>>();
    this.cache.forEach((value, key) => {
      const timestamp = this.timestamps.get(key);
      if (timestamp) {
        data.set(key, { value, timestamp });
      }
    });
    return data;
  }

  /**
   * Import cache from persistence
   */
  public import(data: Record<string, CacheEntry<V>> | Map<K, CacheEntry<V>>): void {
    if (data instanceof Map) {
      data.forEach((entry, key) => {
        if (Date.now() - entry.timestamp <= this.ttlMs) {
          this.cache.set(key, entry.value);
          this.timestamps.set(key, entry.timestamp);
          this.order.push(key);
        }
      });
    } else {
      Object.entries(data).forEach(([keyStr, entry]) => {
        const key = keyStr as unknown as K; // Potential type issue if K is not string, but usually it is
        if (Date.now() - entry.timestamp <= this.ttlMs) {
          this.cache.set(key, entry.value);
          this.timestamps.set(key, entry.timestamp);
          this.order.push(key);
        }
      });
    }

    // Enforce max size
    while (this.order.length > this.maxSize) {
      const oldest = this.order.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
        this.timestamps.delete(oldest);
      }
    }
  }
}
