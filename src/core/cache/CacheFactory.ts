/**
 * @file CacheFactory.ts
 * @description Factory for creating isolated CacheService instances.
 * 
 * This factory allows services to request their own named cache namespaces
 * with specific TTL and capacity constraints while sharing the same
 * underlying storage and logging infrastructure.
 */

import { singleton, inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/logger';
import { CacheService } from './CacheService';
import type { ICacheService, CacheOptions } from '@core/interfaces/ICacheService';

/**
 * Factory class for generating ICacheService instances.
 * Registered as a singleton to maintain consistent storage access.
 */
@singleton()
@injectable()
export class CacheFactory {
  /**
   * @param storage LocalStorageService injected from DI
   * @param logger Logger injected from DI
   */
  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.Logger) private logger: ILogger
  ) {}

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
  public create<K = string, V = any>(options: CacheOptions): ICacheService<K, V> {
    return new CacheService<K, V>(this.storage, this.logger, options);
  }
}
