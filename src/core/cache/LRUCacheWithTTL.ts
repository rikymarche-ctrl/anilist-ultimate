/**
 * @file LRUCacheWithTTL.ts
 * @description High-performance Least Recently Used (LRU) cache implementation with Time-To-Live (TTL) support.
 *
 * ARCHITECTURE:
 * This class uses a hybrid data structure consisting of a `Map` and a `Doubly Linked List`.
 * - The `Map` provides O(1) access to any node given its key.
 * - The `Doubly Linked List` maintains the access order, allowing O(1) update (move-to-front) 
 *   and O(1) eviction of the oldest item (remove from tail).
 *
 * COMPLEXITY:
 * - get, set, delete, has: O(1)
 */

/**
 * Internal node structure for the doubly linked list
 * @template K The type of the cache key
 * @template V The type of the cache value
 */
interface ListNode<K, V> {
  key: K;
  value: V;
  timestamp: number;
  prev: ListNode<K, V> | null;
  next: ListNode<K, V> | null;
}

/**
 * Configuration options for the LRU Cache
 * @template K The type of the cache key
 * @template V The type of the cache value
 */
export interface CacheOptions<K, V> {
  /** Maximum number of items allowed in the cache before eviction occurs */
  maxSize: number;
  /** Time-To-Live in milliseconds for cached entries */
  ttlMs: number;
  /** Optional callback triggered when an item is evicted or deleted */
  onEvict?: (key: K, value: V) => void;
}

/**
 * Enterprise-grade LRU Cache with TTL support.
 * Designed for high-frequency access patterns in browser environments.
 * 
 * @template K The type of the cache key
 * @template V The type of the cache value
 */
export class LRUCacheWithTTL<K, V> {
  /** Map for O(1) node lookup */
  private map = new Map<K, ListNode<K, V>>();
  /** Head of the linked list (Most Recently Used) */
  private head: ListNode<K, V> | null = null;
  /** Tail of the linked list (Least Recently Used) */
  private tail: ListNode<K, V> | null = null;

  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: K, value: V) => void;

  /**
   * @param options Cache configuration options
   * @throws Error if maxSize is less than or equal to zero
   */
  constructor(options: CacheOptions<K, V>) {
    if (options.maxSize <= 0) {
      throw new Error('LRUCache maxSize must be greater than zero');
    }
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict;
  }

  /**
   * Retrieves a value from the cache.
   * Updates the item's position to 'Most Recently Used'.
   * 
   * @param key The key to look up
   * @returns The cached value, or undefined if not found or expired
   */
  public get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Check if the entry has expired based on TTL
    if (Date.now() - node.timestamp > this.ttlMs) {
      this.delete(key);
      return undefined;
    }

    // Refresh position: move the accessed node to the head of the list
    this.moveToFront(node);
    return node.value;
  }

  /**
   * Stores a value in the cache.
   * If the key exists, its value and timestamp are updated.
   * If the cache is at capacity, the Least Recently Used item is evicted.
   * 
   * @param key Unique identifier for the cached item
   * @param value The data to store
   */
  public set(key: K, value: V): void {
    const existing = this.map.get(key);

    if (existing) {
      existing.value = value;
      existing.timestamp = Date.now();
      this.moveToFront(existing);
      return;
    }

    // Capacity management: evict the tail if we exceed maxSize
    if (this.map.size >= this.maxSize && this.tail) {
      this.evictTail();
    }

    // Create a new head node
    const newNode: ListNode<K, V> = {
      key,
      value,
      timestamp: Date.now(),
      prev: null,
      next: null
    };

    this.map.set(key, newNode);
    this.addToFront(newNode);
  }

  /**
   * Explicitly removes an item from the cache.
   * 
   * @param key The key of the item to delete
   */
  public delete(key: K): void {
    const node = this.map.get(key);
    if (!node) return;

    this.removeNode(node);
    this.map.delete(key);

    if (this.onEvict) {
      this.onEvict(key, node.value);
    }
  }

  /**
   * Clears all items from the cache.
   * Reset head, tail, and lookup map.
   */
  public clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * Checks for key existence without updating its LRU position.
   * Performs a TTL check and deletes the item if it's stale.
   * 
   * @param key The key to check
   * @returns True if the key exists and is fresh
   */
  public has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    if (Date.now() - node.timestamp > this.ttlMs) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Returns the current number of items in the cache.
   */
  public get size(): number {
    return this.map.size;
  }

  // --- Internal List Management ---

  /**
   * Re-positions an existing node to the head of the list.
   * @param node The node that was just accessed
   */
  private moveToFront(node: ListNode<K, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToFront(node);
  }

  /**
   * Inserts a node at the head of the list.
   * @param node New node or existing node to be moved
   */
  private addToFront(node: ListNode<K, V>): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    // If it's the first node, it's also the tail
    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Unlinks a node from the linked list.
   * Handles head/tail re-assignment.
   * @param node The node to remove
   */
  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  /**
   * Evicts the Least Recently Used item (at the tail of the list).
   */
  private evictTail(): void {
    if (!this.tail) return;
    const key = this.tail.key;
    const val = this.tail.value;

    this.removeNode(this.tail);
    this.map.delete(key);

    if (this.onEvict) {
      this.onEvict(key, val);
    }
  }

  /**
   * Serializes cache data for persistent storage.
   * Maintains the MRU -> LRU order.
   * 
   * @returns Array of serialized cache entries
   */
  public export(): Array<{ key: K; value: V; timestamp: number }> {
    const result: Array<{ key: K; value: V; timestamp: number }> = [];
    let current = this.head;
    while (current) {
      result.push({
        key: current.key,
        value: current.value,
        timestamp: current.timestamp
      });
      current = current.next;
    }
    return result;
  }

  /**
   * Populates the cache from serialized data.
   * Validates TTL for each entry before importing.
   * 
   * @param data Array of serialized cache entries
   */
  public import(data: Array<{ key: K; value: V; timestamp: number }>): void {
    this.clear();
    // Import in reverse to preserve original order via addToFront
    for (let i = data.length - 1; i >= 0; i--) {
      const entry = data[i];
      if (Date.now() - entry.timestamp <= this.ttlMs) {
        this.set(entry.key, entry.value);
        // Explicitly restore original timestamp (set() would update it to now)
        const node = this.map.get(entry.key);
        if (node) node.timestamp = entry.timestamp;
      }
    }
  }
}
