import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from 'tsyringe';
import { EventBus } from '../events/EventBus';
import { EVENT_TYPES } from '../events/EventTypes';
import { CacheFactory } from './CacheFactory';

function fixture(bus = new EventBus()) {
  const storage = { get: vi.fn(async () => null), set: vi.fn(async () => true), remove: vi.fn(async () => true) };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const factory = new CacheFactory(storage as never, logger as never, bus);
  const dispose = () => (factory as CacheFactory & Disposable).dispose();
  return { factory, storage, logger, bus, dispose };
}

describe('cache factory lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('removes only its own auth subscription and disposes public and private caches', async () => {
    const { factory, storage, bus, dispose } = fixture();
    const other = vi.fn();
    bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, other);
    const privateCache = factory.create<string, number>({ namespace: 'social_friends' });
    const publicCache = factory.create<string, number>({ namespace: 'metadata' });
    await privateCache.set('friend', 1); await publicCache.set('media', 2);
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(2);
    dispose(); dispose();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    expect(privateCache.size()).toBe(0); expect(publicCache.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(privateCache.set('friend', 3)).rejects.toThrow('disposed');
    await expect(publicCache.get('media')).rejects.toThrow('disposed');
    expect(() => factory.create({ namespace: 'new' })).toThrow('disposed');
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(other).toHaveBeenCalledTimes(1);
    expect(storage.set).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  });

  it('ignores its callback already snapshotted by the real event bus before disposal', async () => {
    const bus = new EventBus();
    let dispose!: () => void;
    bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => dispose());
    const state = fixture(bus); dispose = state.dispose;
    const cache = state.factory.create<string, number>({ namespace: 'reviews_session' });
    await cache.set('review', 1);
    const clear = vi.spyOn(cache, 'clear');
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await Promise.resolve();
    expect(clear).not.toHaveBeenCalled();
    expect(state.logger.error).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it('continues to invalidate private caches without clearing public caches while active', async () => {
    const { factory, bus, dispose } = fixture();
    const privateCache = factory.create<string, number>({ namespace: 'reviews_session' });
    const publicCache = factory.create<string, number>({ namespace: 'metadata', persistent: false });
    await privateCache.set('review', 1); await publicCache.set('media', 2);
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(privateCache.size()).toBe(0); expect(await publicCache.get('media')).toBe(2);
    dispose();
  });

  it('never restores or persists private cache data and clears all namespaces on account change', async () => {
    const { factory, storage, bus, dispose } = fixture();
    try {
      for (const namespace of ['calendar_schedule', 'social_friends', 'social_followings', 'social_followers', 'notifications_activity', 'activity_scores', 'reviews_session']) {
        const cache = factory.create<string, string>({ namespace, persistent: true });
        await cache.set('entry', 'private');
        expect(await cache.get('entry')).toBe('private');
        bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
        expect(await cache.get('entry')).toBeUndefined();
      }
      await vi.advanceTimersByTimeAsync(3000);
      expect(storage.get).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    } finally { dispose(); }
  });
});
