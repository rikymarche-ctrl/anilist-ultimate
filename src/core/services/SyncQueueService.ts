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
import type { ILogger } from '@core/interfaces/ILogger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { ISyncQueueService, QueuedMutation, type SyncQueueSnapshot } from '@core/interfaces/ISyncQueueService';
import { SAVE_ASTRA_ENTRY, DELETE_ASTRA_ENTRY } from '@/api/queries/astra';
import { persistedSyncQueueSnapshot } from './SyncQueueSnapshot';
import { validateSyncPayload } from './SyncPayload';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import { diagnosticText } from '@core/errors/DiagnosticPrivacy';
import type { SyncPayload } from './SyncPayload';
import type { AstraProgressResult } from '@/modules/astra/interfaces/IAstraRatingService';
import { SYNC_PROGRESS_QUERY, SYNC_NOTES_QUERY, SYNC_DELETE_ENTRY_QUERY } from '@/api/queries/sync';
import { isSyncId, isNotFoundFailure, syncProgressResponse, syncNotesResponse, assertSyncAcknowledgement,
  syncDeletionEntryResponse, assertDeletionAcknowledgement } from './SyncResponse';
import type { GraphQLResponse } from '@/api/GraphQLResponse';
import { statusAfterProgress } from '@core/utils/ProgressStatus';

/** Queue entry plus internal replacement-chain evidence (not part of the public QueuedMutation contract). */
type ChainedMutation = QueuedMutation & { supersededNotes?: string[] };
const MAX_SUPERSEDED_NOTES = 8;
const MAX_NOTES_LENGTH = 512 * 1024;

/**
 * Notes that an earlier entry of the same replacement chain carried. Its request may already have
 * landed on AniList before newer saves replaced it, so those texts are our own writes, not external edits.
 */
function supersededChain(replaced: ChainedMutation): string[] {
  const earlier = replaced.supersededNotes ?? [];
  const own = replaced.payload.notes === undefined ? [] : [replaced.payload.notes ?? ''];
  return [...new Set([...earlier, ...own])].slice(-MAX_SUPERSEDED_NOTES);
}

/** Persisted chain evidence is trusted only after validation; malformed values preserve the queue. */
function assertSupersededNotes(entries: QueuedMutation[]): void {
  for (const entry of entries as ChainedMutation[]) {
    const value: unknown = entry.supersededNotes;
    if (value !== undefined && (!Array.isArray(value) || value.length > MAX_SUPERSEDED_NOTES
      || !value.every(item => typeof item === 'string' && item.length <= MAX_NOTES_LENGTH))) {
      throw new Error('Invalid persisted sync queue; original data preserved');
    }
  }
}

@singleton()
@injectable()
export class SyncQueueService implements ISyncQueueService {
  private readonly STORAGE_KEY = 'sync_queue_v1';
  private processing = false;
  private processPromise: Promise<void> | null = null;
  private wakeup: ReturnType<typeof setTimeout> | null = null;
  private mediaLocks = new Map<string, Promise<unknown>>();
  private serializeMedia<T>(mediaId: number, owner: number, operation: () => Promise<T>): Promise<T> {
    const key = `${owner}:${mediaId}`;
    const pending = (this.mediaLocks.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.mediaLocks.set(key, pending);
    void pending.finally(() => { if (this.mediaLocks.get(key) === pending) this.mediaLocks.delete(key); }).catch(() => undefined);
    return pending;
  }
  private schedule(delay: number): void {
    if (this.wakeup) clearTimeout(this.wakeup);
    this.wakeup = setTimeout(() => {
      this.wakeup = null;
      void this.process().catch(error => this.logger.error('[SyncQueue] Background sync failed', error));
    }, delay);
  }
  private async owner(expectedSession?: string): Promise<number> {
    await this.authToken?.ensureInitialized();
    const owner = this.authToken?.getUserCache()?.userId ?? await this.api.getCurrentUserId();
    if (!isSyncId(owner) || (this.authToken && !this.authToken.hasToken())) throw new Error('Authenticated sync owner required');
    this.assertOwner(owner, expectedSession);
    return owner;
  }
  private assertOwner(owner: number | undefined, session?: string): void {
    if (this.authToken && (!this.authToken.hasToken() || this.authToken.getUserCache()?.userId !== owner
      || (session !== undefined && this.authToken.getSessionId() !== session))) throw new Error('Sync account changed');
  }
  /** Null is the confirmed empty baseline for a viewer without a list entry yet; other failures still throw. */
  private async remoteNotes(mediaId: number, userId: number): Promise<string | null> {
    let response: GraphQLResponse<unknown>;
    try {
      response = await this.api.queryRaw<unknown>(SYNC_NOTES_QUERY, { mediaId, userId });
    } catch (error: unknown) {
      // A bare HTTP 404 for this lookup is AniList's no-entry answer; other transport failures still throw.
      if (isNotFoundFailure(error)) return null;
      throw error;
    }
    return syncNotesResponse(response, mediaId, userId);
  }

  /**
   * Serializes all queue read-modify-write operations within this context so
   * concurrent enqueue() / process() calls cannot interleave and clobber each
   * other (e.g. rapid saves + the post-enqueue process cycle).
   *
   * Only the background worker owns this service in production. Other contexts
   * use SyncQueueClient; all enqueue/process/clear operations share this lock.
   * Reconcile remains defensive against writes from an older extension context.
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
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.AuthTokenService) private authToken?: AuthTokenService,
    @inject(TOKENS.AstraEntryDeletionCleanup, { isOptional: true }) private deleteLocalEntry?: (mediaId: number, sessionId: string) => Promise<void>,
    @inject(TOKENS.AstraNotesSyncPolicy, { isOptional: true }) private canSyncAstraNotes?: (mediaId: number, updatedAt: number, sessionId: string) => Promise<boolean>
  ) {}

  /**
   * Enqueue a new mutation.
   * Validates payload and deduplicates by mediaId.
   */
  public async enqueue(type: QueuedMutation['type'], payload: unknown, expectedSession?: string): Promise<void> {
    validateSyncPayload(type, payload);
    payload = structuredClone(payload);
    validateSyncPayload(type, payload);
    const copy = payload;
    await this.authToken?.ensureInitialized();
    const userId = this.authToken?.getUserCache()?.userId;
    if (this.authToken && (!this.authToken.hasToken() || !isSyncId(userId))) throw new Error('Authenticated sync owner required');
    if (type === 'ASTRA_DELETE' && (!this.authToken || !isSyncId(userId))) throw new Error('Authenticated deletion owner required');

    // Atomic read-modify-write under the lock to avoid races with process()
    // or other concurrent enqueue() calls.
    await this.withLock(async () => {
      if (expectedSession && this.authToken && this.authToken.getSessionId() !== expectedSession) throw new Error('Sync account changed');
      if (this.authToken && this.authToken.getUserCache()?.userId !== userId) throw new Error('Sync account changed');
      const queue = await this.getQueue();
      this.assertOwner(userId, expectedSession);

      // 2. Advanced Deduplication: If we already have a pending update for this specific mediaId, merge/replace it
      const mediaId = copy.mediaId;
      let existingIndex = -1;

      if (mediaId) {
        existingIndex = queue.findIndex((m) => m.userId === userId
          && m.payload.mediaId === mediaId);
      }
      if (type === 'ASTRA_SAVE' && queue.some(item => item.userId === userId && item.payload.mediaId === mediaId && item.type === 'ASTRA_DELETE')) {
        throw new Error('Entry deletion is pending; wait before editing this entry');
      }

      const previousPayload = type === 'ASTRA_SAVE' && existingIndex >= 0 ? { ...queue[existingIndex].payload } : {};
      if (copy.notes !== undefined) {
        // A deliberate editor replacement must not inherit a previous automatic-report policy.
        delete previousPayload.expectedNotes;
        delete previousPayload.astraNotesUpdatedAt;
      }
      const mutation: ChainedMutation = {
        id: `mut_${crypto.randomUUID()}`,
        type,
        payload: structuredClone({ ...previousPayload, ...Object.fromEntries(Object.entries(copy).filter(([, value]) => value !== undefined)) }),
        retries: 0,
        userId,
      };
      validateSyncPayload(type, mutation.payload);
      const replaced = existingIndex >= 0 ? queue[existingIndex] as ChainedMutation : undefined;
      if (type === 'ASTRA_SAVE' && replaced?.baseNotes !== undefined) {
        mutation.baseNotes = replaced.baseNotes;
        const superseded = supersededChain(replaced);
        if (superseded.length > 0) mutation.supersededNotes = superseded;
      }
      else if (copy.notes !== undefined && copy.expectedNotes !== undefined) mutation.baseNotes = copy.expectedNotes;
      else if (copy.notes !== undefined && this.authToken) {
        mutation.baseNotes = await this.remoteNotes(mediaId!, userId!);
        this.assertOwner(userId, expectedSession);
      }
      // A conflict remains held until the user reviews and explicitly retries it.
      if (type === 'ASTRA_SAVE' && existingIndex >= 0 && queue[existingIndex].blocked) { mutation.blocked = true; mutation.retries = 10; }

      if (type === 'ASTRA_DELETE') {
        // Cancel every older save for this account/media, including duplicate
        // durable records, so no offline retry can recreate the deleted entry.
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].userId === userId && queue[i].payload.mediaId === mediaId) queue.splice(i, 1);
        }
        queue.push(mutation);
      } else if (existingIndex > -1) {
        this.logger.info(`[SyncQueue] Replacing pending ${type} mutation for mediaId ${mediaId}`);
        queue[existingIndex] = mutation;
      } else {
        queue.push(mutation);
      }

      await this.saveQueue(queue);
    });

    // 3. Proactive Processing
    // We use a small delay to allow multiple rapid updates (e.g. settings toggle) to batch
    this.schedule(500);
  }

  async updateProgress(mediaId: number, progress?: number, expectedSession?: string): Promise<AstraProgressResult> {
    validateSyncPayload('ASTRA_SAVE', { mediaId, progress });
    const owner = await this.owner(expectedSession);
    const session = expectedSession ?? this.authToken?.getSessionId();
    return this.serializeMedia(mediaId, owner, async () => {
      this.assertOwner(owner, session);
      const response: unknown = await this.api.query(SYNC_PROGRESS_QUERY, { mediaId, userId: owner });
      this.assertOwner(owner, session);
      const entry = syncProgressResponse(response, mediaId, owner);
      const queue = await this.getQueue();
      this.assertOwner(owner, session);
      const baseline = queue.find(item => (!this.authToken || item.userId === owner) && item.payload.mediaId === mediaId);
      if (baseline) validateSyncPayload(baseline.type, baseline.payload);
      const previousProgress = baseline?.payload.progress ?? entry.progress;
      const next = progress ?? previousProgress + 1;
      validateSyncPayload('ASTRA_SAVE', { mediaId, progress: next });
      const previousStatus = (baseline?.payload.status ?? entry.status) as typeof entry.status;
      const status = statusAfterProgress(previousStatus, next, entry.total);
      await this.enqueue('ASTRA_SAVE', { mediaId, progress: next,
        ...(status !== previousStatus ? { status } : {}) }, session);
      await this.process();
      this.assertOwner(owner, session);
      const pending = await this.getQueue();
      this.assertOwner(owner, session);
      const latest = pending.find(item => (!this.authToken || item.userId === owner) && item.payload.mediaId === mediaId);
      if (latest) validateSyncPayload(latest.type, latest.payload);
      // A newer durable save can supersede this increment while its mutation is in flight.
      const desired = latest ? latest.payload : undefined;
      return { mediaId, progress: desired?.progress ?? next, previousProgress, userId: owner,
        status: (desired?.status ?? status) as typeof entry.status, title: entry.title,
        syncState: latest ? 'queued' : 'synced' };
    });
  }

  async appendNote(mediaId: number, episode: number, notes: string, expectedSession?: string): Promise<void> {
    if (!Number.isSafeInteger(episode) || episode <= 0 || typeof notes !== 'string') throw new Error('Invalid episode note');
    validateSyncPayload('ASTRA_SAVE', { mediaId, notes });
    const owner = await this.owner(expectedSession);
    const session = expectedSession ?? this.authToken?.getSessionId();
    await this.serializeMedia(mediaId, owner, async () => {
      this.assertOwner(owner, session);
      const remote = await this.remoteNotes(mediaId, owner);
      this.assertOwner(owner, session);
      const queue = await this.getQueue();
      this.assertOwner(owner, session);
      const pending = queue.find(item => item.userId === owner && item.payload.mediaId === mediaId);
      const existing = pending?.payload.notes ?? remote ?? '';
      const note = `[Ep ${episode}] ${notes}`;
      // A pending append already carries its baseline; the conflict check accepts that chain's superseded writes.
      const chainBaseline = pending?.baseNotes;
      await this.enqueue('ASTRA_SAVE', { mediaId, notes: existing.endsWith(note) ? existing : [existing, note].filter(Boolean).join('\n\n'),
        ...(chainBaseline === undefined ? { expectedNotes: remote } : {}) }, session);
      await this.process();
      this.assertOwner(owner, session);
    });
  }

  /** Trusted extension pages only: callers must explicitly select records. */
  async recovery(operation: 'export' | 'retry' | 'notes', ids: string[] = [], expectedSession?: string): Promise<QueuedMutation[]> {
    const owner = await this.owner(expectedSession);
    const session = expectedSession ?? this.authToken?.getSessionId();
    if (!['export', 'retry', 'notes'].includes(operation) || !Array.isArray(ids) || ids.length > 1000
      || !ids.every(id => typeof id === 'string' && id.length <= 200) || (operation === 'retry' && ids.length === 0)) throw new Error('Invalid queue recovery command');
    return this.withLock(async () => {
      this.assertOwner(owner, session);
      if (operation === 'notes') {
        const entries = persistedSyncQueueSnapshot(await this.storage.get<unknown>(`sync_recovery_notes_${owner}`)).entries;
        this.assertOwner(owner, session);
        if (entries.some(item => item.userId !== owner)) throw new Error('Invalid Notes backup owner');
        return entries;
      }
      const queue = await this.getQueue();
      this.assertOwner(owner, session);
      const visible = queue.filter(item => item.userId === owner);
      if (operation === 'export') return visible;
      const selected = visible.filter(item => ids.includes(item.id));
      if (selected.length !== new Set(ids).size || selected.some(item => item.userId !== owner)) throw new Error('Invalid recovery selection');
      if (selected.some(item => queue.some(other => other.id !== item.id && (other.userId === owner || selected.includes(other))
        && other.payload.mediaId === item.payload.mediaId))) throw new Error('Multiple pending versions for one media; export and resolve before recovery');
      if (!(await this.storage.set(`sync_recovery_${crypto.randomUUID()}`, { schemaVersion: 1, recoveredAt: Date.now(), entries: structuredClone(selected) }))) throw new Error('Recovery backup write failed');
      for (const item of selected) {
        validateSyncPayload(item.type, item.payload);
        item.retries = 0;
        delete item.lastAttempt; delete item.error; delete item.blocked; delete (item as ChainedMutation).supersededNotes;
        // Accept the reviewed version, but still protect edits made AFTER this retry.
        if (item.payload.notes !== undefined) {
          item.baseNotes = await this.remoteNotes(item.payload.mediaId!, owner);
          item.payload.expectedNotes = item.baseNotes;
          this.assertOwner(owner, session);
        }
      }
      this.assertOwner(owner, session);
      await this.saveQueue(queue);
      return queue.filter(item => item.userId === owner);
    });
  }

  /**
   * Process pending mutations with exponential backoff and atomic failure handling.
   */
  public async process(): Promise<void> {
    if (this.processPromise) return this.processPromise;
    this.processPromise = this.processInternal().finally(() => { this.processPromise = null; });
    return this.processPromise;
  }

  private async processInternal(): Promise<void> {
    if (this.processing) return;
    await this.authToken?.ensureInitialized();
    if (this.authToken && (!this.authToken.hasToken() || !this.authToken.getUserCache()?.userId)) return;

    // Check global API status before starting
    const apiStatus = this.api.getQueueStatus();
    if (apiStatus.isRateLimited) {
      this.logger.warn('[SyncQueue] API is currently rate limited. Skipping sync cycle.');
      return;
    }

    const queue = await this.withLock(() => this.getQueue());
    if (queue.length === 0) return;

    this.processing = true;
    this.logger.info(`[SyncQueue] Starting sync cycle for ${queue.length} mutations`);

    // Reconcile-by-id instead of overwriting the queue: we record which mutations
    // were synced/dropped (removeIds) and which were updated with new retry state
    // (updatedById), then merge against the LATEST queue at the end. This preserves
    // items enqueued concurrently — including from another context (service worker
    // vs content script sharing the same storage key) — instead of clobbering them.
    const removeIds = new Set<string>();
    const updatedById = new Map<string, QueuedMutation>();
    let stopProcessing = false;
    let pendingAfter = false;
    let freshRemaining = false;

    try {
      for (const mutation of queue) {
        // Never replay another account's save (or records without an owner) under
        // the current credential. Preserve their durable records without reassignment.
        if (this.authToken && (!this.authToken.hasToken() || mutation.userId !== this.authToken.getUserCache()?.userId)) {
          this.logger.warn('[SyncQueue] Holding mutation with a different or unknown account owner');
          continue;
        }
        if (mutation.retries >= 10 || mutation.blocked) continue;
        // A newer save may replace this snapshot while a previous request runs.
        const stillPending = await this.withLock(async () => (await this.getQueue()).some(entry => entry.id === mutation.id));
        if (!stillPending) continue;
        // If a previous mutation in this loop hit a critical error, skip the rest.
        if (stopProcessing) {
          pendingAfter = true;
          continue;
        }

        try {
          // Exponential backoff check
          if (mutation.lastAttempt && mutation.retries > 0) {
            const waitTime = Math.pow(2, mutation.retries) * 1000 * 60; // 2, 4, 8... minutes
            if (Date.now() - mutation.lastAttempt < waitTime) {
              pendingAfter = true;
              continue;
            }
          }

          // Await the API's abortable request/retry lifecycle. A detached race
          // timeout would leave the older mutation running behind a newer save.
          await this.executeMutation(mutation);

          this.logger.success(`[SyncQueue] Synced ${mutation.type} (ID: ${mutation.id})`);
          removeIds.add(mutation.id);
        } catch (failure: unknown) {
          const error: Error & { statusCode?: number } = failure instanceof Error ? failure : new Error('Synchronization failed');
          const isRateLimit = error.message?.includes('rate limit') || error.statusCode === 429;
          const isAuthError = error.statusCode === 401 || error.statusCode === 403;

          mutation.retries = mutation.blocked ? 10 : mutation.retries + 1;
          mutation.lastAttempt = Date.now();
          mutation.error = diagnosticText(typeof error.message === 'string' ? error.message : 'Synchronization failed');

          if (isRateLimit || isAuthError) {
            this.logger.error(
              `[SyncQueue] Critical API error (${error.statusCode}). Suspending queue.`,
              error
            );
            updatedById.set(mutation.id, mutation); // persist the incremented retry
            stopProcessing = true; // ATOMIC BREAK: stop processing current queue
            pendingAfter = true;
            continue;
          }

          if (mutation.retries < 10) {
            this.logger.warn(
              `[SyncQueue] Mutation failed, attempt ${mutation.retries}/10. Retrying later.`,
              error
            );
            updatedById.set(mutation.id, mutation);
            pendingAfter = true;
          } else {
            this.logger.error(
              `[SyncQueue] Mutation ${mutation.id} exhausted retries. Preserved for recovery.`,
              error
            );
            updatedById.set(mutation.id, mutation);
          }
        }
      }

      // Merge against the current queue (re-read) so concurrent enqueues survive.
      await this.withLock(async () => {
        const current = await this.getQueue();
        const reconciled = current
          .filter((m) => !removeIds.has(m.id))
          .map((m) => updatedById.get(m.id) ?? m);
        // No-op retry/held passes must not broadcast a new revision to every tab.
        if (JSON.stringify(reconciled) !== JSON.stringify(current)) await this.saveQueue(reconciled);
        const eligible = reconciled.filter(m => m.retries < 10 && (!this.authToken || m.userId === this.authToken.getUserCache()?.userId));
        pendingAfter = eligible.length > 0;
        freshRemaining = eligible.some(m => m.retries === 0);
      });
    } finally {
      this.processing = false;
    }

    if (pendingAfter && !stopProcessing) {
      // If there are still items but no critical error, schedule another pass later
      this.schedule(freshRemaining ? 0 : 60000 * 5);
    }
  }

  /**
   * Delegates mutation to specific handlers based on type.
   */
  private async executeMutation(mutation: ChainedMutation): Promise<void> {
    validateSyncPayload(mutation.type, mutation.payload);
    const session = this.authToken?.getSessionId();
    this.assertOwner(mutation.userId, session);
    if (mutation.type === 'ASTRA_DELETE') {
      if (!isSyncId(mutation.userId) || !session || !this.deleteLocalEntry) throw new Error('Authenticated entry deletion unavailable');
      const response: unknown = await this.api.query(SYNC_DELETE_ENTRY_QUERY, { mediaId: mutation.payload.mediaId });
      this.assertOwner(mutation.userId, session);
      const entryId = syncDeletionEntryResponse(response, mutation.payload.mediaId!, mutation.userId);
      if (entryId !== null) {
        const deleted: unknown = await this.api.mutate(DELETE_ASTRA_ENTRY, { id: entryId });
        this.assertOwner(mutation.userId, session);
        assertDeletionAcknowledgement(deleted);
      }
      // A retry after a lost acknowledgement can observe an already absent
      // remote entry. Local cleanup is idempotent and remains in the queue
      // until its durable account-scoped commit also succeeds.
      await this.deleteLocalEntry(mutation.payload.mediaId!, session);
      this.assertOwner(mutation.userId, session);
      return;
    }
    // Internal metadata must never reach the provider's mutation variables.
    const astraNotesUpdatedAt = mutation.payload.astraNotesUpdatedAt;
    const payload = { ...mutation.payload };
    delete payload.expectedNotes;
    delete payload.astraNotesUpdatedAt;
    const notesAllowed = async () => {
      if (astraNotesUpdatedAt === undefined || payload.notes === undefined || !this.authToken) return true;
      if (!this.canSyncAstraNotes || !session) throw new Error('Automatic Astra Notes policy unavailable; update held safely');
      const allowed = await this.canSyncAstraNotes(payload.mediaId!, astraNotesUpdatedAt, session);
      this.assertOwner(mutation.userId, session);
      return allowed;
    };
    if (!(await notesAllowed())) delete payload.notes;
    if (payload.notes !== undefined && this.authToken && mutation.baseNotes === undefined) {
      mutation.blocked = true;
      throw new Error('Notes update has no original baseline; export and review before retrying');
    }
    if (mutation.baseNotes !== undefined && payload.notes !== undefined && this.authToken) {
      if (mutation.baseNotes !== null && typeof mutation.baseNotes !== 'string') throw new Error('Invalid Notes baseline');
      const remote = await this.remoteNotes(mutation.payload.mediaId!, mutation.userId!);
      this.assertOwner(mutation.userId, session);
      // Remote text may be this replacement chain's own earlier write that landed before newer saves superseded it.
      const ownEarlierWrite = mutation.supersededNotes?.includes(remote ?? '') ?? false;
      const matchesOriginal = ownEarlierWrite || (remote ?? '') === (mutation.baseNotes ?? '');
      const matchesPrepared = mutation.payload.expectedNotes === undefined
        || (remote ?? '') === (mutation.payload.expectedNotes ?? '');
      if ((!matchesOriginal || !matchesPrepared) && (remote ?? '') !== (payload.notes ?? '')) {
        mutation.blocked = true;
        throw new Error('Remote notes changed; export and review this update before retrying');
      }
      if ((remote ?? '') === (payload.notes ?? '')) delete payload.notes;
      else {
        await this.backupNotes(mutation, remote);
        this.assertOwner(mutation.userId, session);
      }
    }
    // A setting change or a newer local save while the read/backup was pending cancels this report.
    if (!(await notesAllowed())) delete payload.notes;
    if (mutation.payload.notes !== undefined && payload.notes === undefined
      && Object.keys(payload).every(key => key === 'mediaId' || payload[key as keyof typeof payload] === undefined)) return;
    let response: unknown;
    switch (mutation.type) {
      case 'ASTRA_SAVE':
        response = await this.handleAstraSave(payload);
        break;
      default:
        throw new Error('Unknown sync mutation type');
    }
    this.assertOwner(mutation.userId, session);
    assertSyncAcknowledgement(response, mutation.payload.mediaId!, mutation.userId);
  }

  private async handleAstraSave(payload: SyncPayload): Promise<unknown> {
    if (payload.notes !== undefined && this.api.mutateOnce) return this.api.mutateOnce(SAVE_ASTRA_ENTRY, { ...payload });
    return this.api.mutate(SAVE_ASTRA_ENTRY, { ...payload });
  }

  /** Bounded, account-scoped local history; a failed backup must stop the remote write. */
  private async backupNotes(mutation: QueuedMutation, notes: string | null): Promise<void> {
    await this.withLock(async () => {
      const key = `sync_recovery_notes_${mutation.userId}`;
      const entries = persistedSyncQueueSnapshot(await this.storage.get<unknown>(key)).entries;
      if (entries.some(item => item.userId !== mutation.userId)) throw new Error('Invalid Notes backup owner');
      // A lost acknowledgement/offline retry must not evict history with duplicate snapshots.
      if (entries.some(item => item.id === mutation.id && item.payload.notes === notes)) return;
      entries.push({ id: mutation.id, type: 'ASTRA_SAVE', userId: mutation.userId,
        payload: { mediaId: mutation.payload.mediaId, notes }, retries: 0, lastAttempt: Date.now() });
      if (!(await this.storage.set(key, { schemaVersion: 2, revision: crypto.randomUUID(), entries: entries.slice(-20) }))) {
        throw new Error('Notes backup write failed; remote notes preserved');
      }
    });
  }

  /**
   * Retrieves the current queue from persistent storage.
   */
  private async readSnapshot(): Promise<SyncQueueSnapshot> {
    try {
      const snapshot = persistedSyncQueueSnapshot(await this.storage.get<unknown>(this.STORAGE_KEY));
      assertSupersededNotes(snapshot.entries);
      return snapshot;
    }
    catch (error) { this.logger.error('[SyncQueue] Failed to read queue from storage', error); throw error; }
  }

  public async getQueue(): Promise<QueuedMutation[]> { return (await this.readSnapshot()).entries; }

  public async getSnapshot(): Promise<SyncQueueSnapshot> {
    return this.withLock(() => this.readSnapshot());
  }

  /**
   * Persists the queue to storage.
   */
  private async saveQueue(queue: QueuedMutation[]): Promise<void> {
    try {
      if (!(await this.storage.set(this.STORAGE_KEY, { schemaVersion: 2, revision: crypto.randomUUID(), entries: structuredClone(queue) }))) {
        throw new Error('Sync queue storage write failed');
      }
    } catch (err) {
      this.logger.error('[SyncQueue] Failed to save queue', err);
      throw err;
    }
  }

  /**
   * Clears all pending mutations.
   */
  public async clear(userId?: number): Promise<void> {
    await this.withLock(async () => {
      if (userId !== undefined) {
        if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid queue owner');
        await this.saveQueue((await this.getQueue()).filter(item => item.userId !== userId));
        return;
      }
      await this.saveQueue([]);
    });
    this.logger.info('[SyncQueue] Queue cleared successfully');
  }
}
