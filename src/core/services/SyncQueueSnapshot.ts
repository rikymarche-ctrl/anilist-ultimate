import type { QueuedMutation, SyncQueueSnapshot } from '@core/interfaces/ISyncQueueService';

function queueEntries(value: unknown): QueuedMutation[] {
  if (!Array.isArray(value) || !value.every(entry => entry && typeof entry.id === 'string'
    && typeof entry.payload === 'object' && entry.payload !== null && Number.isSafeInteger(entry.retries) && entry.retries >= 0)) {
    throw new Error('Invalid persisted sync queue; original data preserved');
  }
  return structuredClone(value);
}

/** Opaque revision and records are returned from the same durable storage read. */
export function syncQueueSnapshot(value: unknown): SyncQueueSnapshot {
  if (!value || typeof value !== 'object' || !('revision' in value) || typeof value.revision !== 'string'
    || !/^[a-zA-Z0-9-]{1,100}$/.test(value.revision) || !('entries' in value)) throw new Error('Invalid sync queue snapshot');
  return { revision: value.revision, entries: queueEntries(value.entries) };
}

export function persistedSyncQueueSnapshot(value: unknown): SyncQueueSnapshot {
  if (value === null) return { revision: 'empty', entries: [] };
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 2) {
    throw new Error('Invalid persisted sync queue; original data preserved');
  }
  return syncQueueSnapshot(value);
}
