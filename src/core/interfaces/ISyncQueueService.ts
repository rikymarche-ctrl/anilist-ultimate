/**
 * @file ISyncQueueService.ts
 * @description Interface for the persistent mutation synchronization queue.
 */

import type { SyncPayload } from '@core/services/SyncPayload';
import type { AstraProgressResult } from '@/modules/astra/interfaces/IAstraRatingService';

export interface QueuedMutation {
  id: string;
  type: 'ASTRA_SAVE' | 'ASTRA_DELETE';
  payload: SyncPayload;
  retries: number;
  /** Credential owner at enqueue time. */
  userId?: number;
  lastAttempt?: number;
  error?: string;
  /** Original remote notes used for optimistic conflict detection on retry. */
  baseNotes?: string | null;
  blocked?: boolean;
}

export interface SyncQueueSnapshot { revision: string; entries: QueuedMutation[]; }

export interface ISyncQueueService {
  /**
   * Enqueue a new mutation for background synchronization
   */
  enqueue(type: QueuedMutation['type'], payload: unknown, expectedSession?: string): Promise<void>;
  updateProgress(mediaId: number, progress?: number, expectedSession?: string): Promise<AstraProgressResult>;
  appendNote(mediaId: number, episode: number, notes: string, expectedSession?: string): Promise<void>;
  recovery(operation: 'export' | 'retry' | 'notes', ids?: string[], expectedSession?: string): Promise<QueuedMutation[]>;

  /**
   * Process all pending mutations in the queue
   */
  process(): Promise<void>;

  /**
   * Get all pending mutations (for UI display/diagnostics)
   */
  getQueue(): Promise<QueuedMutation[]>;
  /** Revision and queue from one durable read; retained even after successful sync empties the queue. */
  getSnapshot(): Promise<SyncQueueSnapshot>;

  /**
   * Clear the entire queue
   */
  clear(userId?: number): Promise<void>;
}
