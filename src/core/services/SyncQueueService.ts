/**
 * @file SyncQueueService.ts
 * @description Enterprise implementation of a persistent, storage-backed mutation queue.
 *
 * Ensures that critical data updates (like Astra scores) are never lost due to
 * network failures or extension suspension. Implements exponential backoff
 * and deduplication.
 */

import { singleton, inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/logger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { ISyncQueueService, QueuedMutation } from '@core/interfaces/ISyncQueueService';

@singleton()
@injectable()
export class SyncQueueService implements ISyncQueueService {
  private readonly STORAGE_KEY = 'sync_queue_v1';
  private processing = false;

  /**
   * Serializes all queue read-modify-write operations within this context so
   * concurrent enqueue() / process() calls cannot interleave and clobber each
   * other (e.g. rapid saves + the post-enqueue process cycle).
   *
   * NOTE: this guards races within a single context. Cross-context coordination
   * (service worker vs content script sharing the same storage key) would require
   * routing all queue writes through a single owner via messaging.
   */
  private opLock: Promise<void> = Promise.resolve();

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.opLock.then(fn, fn);
    this.opLock = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  constructor(
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  /**
   * Enqueue a new mutation.
   * Validates payload and deduplicates by mediaId.
   */
  public async enqueue(type: QueuedMutation['type'], payload: any): Promise<void> {
    // 1. Basic validation (Enterprise Guard)
    if (!payload || (type === 'ASTRA_SAVE' && !payload.mediaId)) {
      this.logger.error(`[SyncQueue] Invalid payload for ${type}`, payload);
      return;
    }

    // Atomic read-modify-write under the lock to avoid races with process()
    // or other concurrent enqueue() calls.
    await this.withLock(async () => {
      const queue = await this.getQueue();

      // 2. Advanced Deduplication: If we already have a pending update for this specific mediaId, merge/replace it
      const mediaId = payload.mediaId;
      let existingIndex = -1;

      if (mediaId) {
        existingIndex = queue.findIndex((m) => m.type === type && m.payload.mediaId === mediaId);
      }

      const mutation: QueuedMutation = {
        id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type,
        payload: { ...payload }, // Shallow copy to detach from caller's reference
        retries: 0,
      };

      if (existingIndex > -1) {
        this.logger.info(`[SyncQueue] Replacing pending ${type} mutation for mediaId ${mediaId}`);
        queue[existingIndex] = mutation;
      } else {
        queue.push(mutation);
      }

      await this.saveQueue(queue);
    });

    // 3. Proactive Processing
    // We use a small delay to allow multiple rapid updates (e.g. settings toggle) to batch
    setTimeout(() => {
      this.process().catch((err) => this.logger.error('[SyncQueue] Background sync failed', err));
    }, 500);
  }

  /**
   * Process pending mutations with exponential backoff and atomic failure handling.
   */
  public async process(): Promise<void> {
    // Run under the lock so the final saveQueue(remaining) cannot clobber a
    // concurrent enqueue() (which also acquires the lock).
    return this.withLock(() => this.processInternal());
  }

  private async processInternal(): Promise<void> {
    if (this.processing) return;

    // Check global API status before starting
    const apiStatus = this.api.getQueueStatus();
    if (apiStatus.isRateLimited) {
      this.logger.warn('[SyncQueue] API is currently rate limited. Skipping sync cycle.');
      return;
    }

    const queue = await this.getQueue();
    if (queue.length === 0) return;

    this.processing = true;
    this.logger.info(`[SyncQueue] Starting sync cycle for ${queue.length} mutations`);

    const remaining: QueuedMutation[] = [];
    let stopProcessing = false;

    for (const mutation of queue) {
      // If a previous mutation in this loop hit a critical error, skip the rest
      if (stopProcessing) {
        remaining.push(mutation);
        continue;
      }

      try {
        // Exponential backoff check
        if (mutation.lastAttempt && mutation.retries > 0) {
          const waitTime = Math.pow(2, mutation.retries) * 1000 * 60; // 2, 4, 8... minutes
          if (Date.now() - mutation.lastAttempt < waitTime) {
            remaining.push(mutation);
            continue;
          }
        }

        // Add execution timeout (10s)
        await Promise.race([
          this.executeMutation(mutation),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Mutation Timeout')), 10000)
          ),
        ]);

        this.logger.success(`[SyncQueue] Synced ${mutation.type} (ID: ${mutation.id})`);
      } catch (error: any) {
        const isRateLimit = error.message?.includes('rate limit') || error.statusCode === 429;
        const isAuthError = error.statusCode === 401 || error.statusCode === 403;

        mutation.retries++;
        mutation.lastAttempt = Date.now();
        mutation.error = error.message;

        if (isRateLimit || isAuthError) {
          this.logger.error(
            `[SyncQueue] Critical API error (${error.statusCode}). Suspending queue.`,
            error
          );
          remaining.push(mutation);
          stopProcessing = true; // ATOMIC BREAK: stop processing current queue
          continue;
        }

        if (mutation.retries < 10) {
          this.logger.warn(
            `[SyncQueue] Mutation failed, attempt ${mutation.retries}/10. Retrying later.`,
            error
          );
          remaining.push(mutation);
        } else {
          this.logger.error(
            `[SyncQueue] Mutation ${mutation.id} permanently failed. Dropping.`,
            error
          );
        }
      }
    }

    await this.saveQueue(remaining);
    this.processing = false;

    if (remaining.length > 0 && !stopProcessing) {
      // If there are still items but no critical error, schedule another pass later
      setTimeout(() => this.process(), 60000 * 5); // Retry every 5 mins
    }
  }

  /**
   * Delegates mutation to specific handlers based on type.
   */
  private async executeMutation(mutation: QueuedMutation): Promise<void> {
    switch (mutation.type) {
      case 'ASTRA_SAVE':
        await this.handleAstraSave(mutation.payload);
        break;
      case 'MEDIA_LIST_UPDATE':
        await this.handleMediaListUpdate(mutation.payload);
        break;
      default:
        this.logger.error(`[SyncQueue] Unknown mutation type: ${mutation.type}`);
      // We don't throw here to avoid infinite loops on invalid types in storage
    }
  }

  private async handleAstraSave(payload: any): Promise<void> {
    const GQL = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$notes:String,$lists:[String]) {
      SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,notes:$notes,customLists:$lists) { id }
    }`;
    await this.api.mutate(GQL, payload);
  }

  private async handleMediaListUpdate(payload: any): Promise<void> {
    const GQL = `mutation($id:Int,$status:MediaListStatus,$progress:Int,$scoreRaw:Int) {
      SaveMediaListEntry(mediaId:$id,status:$status,progress:$progress,scoreRaw:$scoreRaw) { id }
    }`;
    await this.api.mutate(GQL, payload);
  }

  /**
   * Retrieves the current queue from persistent storage.
   */
  public async getQueue(): Promise<QueuedMutation[]> {
    try {
      return (await this.storage.get<QueuedMutation[]>(this.STORAGE_KEY)) || [];
    } catch (err) {
      this.logger.error('[SyncQueue] Failed to read queue from storage', err);
      return [];
    }
  }

  /**
   * Persists the queue to storage.
   */
  private async saveQueue(queue: QueuedMutation[]): Promise<void> {
    try {
      await this.storage.set(this.STORAGE_KEY, queue);
    } catch (err) {
      this.logger.error('[SyncQueue] Failed to save queue', err);
    }
  }

  /**
   * Clears all pending mutations.
   */
  public async clear(): Promise<void> {
    await this.storage.remove(this.STORAGE_KEY);
    this.logger.info('[SyncQueue] Queue cleared successfully');
  }
}
