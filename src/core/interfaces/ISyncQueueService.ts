/**
 * @file ISyncQueueService.ts
 * @description Interface for the persistent mutation synchronization queue.
 */

export interface QueuedMutation {
  id: string;
  type: 'ASTRA_SAVE' | 'MEDIA_LIST_UPDATE';
  payload: any;
  retries: number;
  lastAttempt?: number;
  error?: string;
}

export interface ISyncQueueService {
  /**
   * Enqueue a new mutation for background synchronization
   */
  enqueue(type: QueuedMutation['type'], payload: any): Promise<void>;

  /**
   * Process all pending mutations in the queue
   */
  process(): Promise<void>;

  /**
   * Get all pending mutations (for UI display/diagnostics)
   */
  getQueue(): Promise<QueuedMutation[]>;

  /**
   * Clear the entire queue
   */
  clear(): Promise<void>;
}
