import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCacheWithTTL } from './LRUCacheWithTTL';

describe('LRUCacheWithTTL', () => {
  it('throws when maxSize <= 0', () => {
    expect(() => new LRUCacheWithTTL({ maxSize: 0, ttlMs: 1000 })).toThrow();
  });

  it('stores and retrieves values', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 10000 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('returns undefined for missing keys', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 10000 });
    expect(cache.get('nope')).toBeUndefined();
  });

  it('evicts the least recently used entry when at capacity', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 2, ttlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' becomes most-recently-used, 'b' is now LRU
    cache.set('c', 3); // evicts 'b'

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('updates value and freshness for an existing key without growing', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 2, ttlMs: 10000 });
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('invokes onEvict for eviction and explicit delete', () => {
    const onEvict = vi.fn();
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 1, ttlMs: 10000, onEvict });

    cache.set('a', 1);
    cache.set('b', 2); // evicts 'a'
    expect(onEvict).toHaveBeenCalledWith('a', 1);

    cache.delete('b');
    expect(onEvict).toHaveBeenCalledWith('b', 2);
  });

  describe('TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('expires entries past the TTL on get()', () => {
      const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 1000 });
      cache.set('a', 1);

      vi.advanceTimersByTime(1001);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('has() returns false and prunes an expired entry', () => {
      const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 1000 });
      cache.set('a', 1);
      vi.advanceTimersByTime(1001);
      expect(cache.has('a')).toBe(false);
    });

    it('keeps fresh entries within the TTL', () => {
      const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 1000 });
      cache.set('a', 1);
      vi.advanceTimersByTime(500);
      expect(cache.get('a')).toBe(1);
    });
  });

  it('clear() empties the cache', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 3, ttlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('export/import preserves entries and order (MRU -> LRU)', () => {
    const cache = new LRUCacheWithTTL<string, number>({ maxSize: 5, ttlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    const dump = cache.export();
    expect(dump.map((e) => e.key)).toEqual(['c', 'b', 'a']);

    const restored = new LRUCacheWithTTL<string, number>({ maxSize: 5, ttlMs: 10000 });
    restored.import(dump);
    expect(restored.get('a')).toBe(1);
    expect(restored.get('b')).toBe(2);
    expect(restored.get('c')).toBe(3);
  });

  it('import drops entries that are already expired', () => {
    vi.useFakeTimers();
    try {
      const stale = [{ key: 'old', value: 1, timestamp: Date.now() - 5000 }];
      const cache = new LRUCacheWithTTL<string, number>({ maxSize: 5, ttlMs: 1000 });
      cache.import(stale);
      expect(cache.has('old')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
