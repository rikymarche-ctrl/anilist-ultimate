/**
 * @file CacheFactory.ts
 * @description Factory for creating isolated CacheService instances.
 * 
 * This factory allows services to request their own named cache namespaces
 * with specific TTL and capacity constraints while sharing the same
 * underlying storage and logging infrastructure.
 */

import { singleton, inject, injectable, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/interfaces/ILogger';
import { CacheService } from './CacheService';
import type { ICacheService, CacheOptions } from '@core/interfaces/ICacheService';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

/**
 * Factory class for generating ICacheService instances.
 * Registered as a singleton to maintain consistent storage access.
 */
@singleton()
@injectable()
export class CacheFactory implements Disposable {
  private privateCaches = new Set<CacheService<unknown, unknown>>();
  private caches = new Set<CacheService<unknown, unknown>>();
  private authSubscription?: EventSubscription;
  private disposed = false;
  /**
   * @param storage LocalStorageService injected from DI
   * @param logger Logger injected from DI
   */
  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) bus?: IEventBus,
  ) {
    this.authSubscription = bus?.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      if (this.disposed) return;
      for (const cache of this.privateCaches) void cache.clear().catch(error => {
        if (!this.disposed) this.logger.error('Private cache invalidation failed', error);
      });
    });
  }

  /**
   * Creates or retrieves a named cache instance.
   * Each instance is isolated by its namespace.
   * 
   * @template K Type of the cache key
   * @template V Type of the cache value
   * @param options Configuration for the cache instance
   * @returns An object implementing ICacheService
   * 
   * @example
   * const reviewsCache = factory.create<number, ReviewData>({ 
   *   namespace: 'reviews', 
   *   maxSize: 500, 
   *   ttlMs: 24 * 60 * 60 * 1000 
   * });
   */
  public create<K = string, V = unknown>(options: CacheOptions): ICacheService<K, V> {
    if (this.disposed) throw new Error('Cache factory is disposed');
    // Viewer-dependent results can include private messages/progress. Keep these
    // disposable caches in memory, avoiding account data in the generic bridge.
    const privateData = ['calendar_schedule', 'social_friends', 'social_followings', 'social_followers', 'notifications_activity', 'activity_scores', 'reviews_session'].includes(options.namespace ?? '');
    const cache = new CacheService<K, V>(this.storage, this.logger, privateData ? { ...options, persistent: false } : options);
    this.caches.add(cache as CacheService<unknown, unknown>);
    if (privateData) this.privateCaches.add(cache as CacheService<unknown, unknown>);
    return cache;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.authSubscription?.unsubscribe();
    this.authSubscription = undefined;
    for (const cache of this.caches) cache.dispose();
    this.caches.clear();
    this.privateCaches.clear();
  }
}
