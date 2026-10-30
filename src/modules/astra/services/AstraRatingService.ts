/**
 * @file AstraRatingService.ts
 * @description Enterprise-grade implementation of the Astra Rating Service.
 * Isolates AniList API interactions and persistence logic from UI controllers.
 */

import { injectable, inject, delay } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import { AstraService } from '../AstraService';
import type { AstraWork } from '../AstraInterfaces';
import type {
  IAstraRatingService,
  IRatingInitialData,
  AstraSaveOptions,
  AstraSaveResult,
  AstraProgressResult,
  AstraDispatchOutcome,
} from '../interfaces/IAstraRatingService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { ASTRA_RATING_QUERY } from '@/api/queries/astra-rating';
import { ratingInitialResponse } from './AstraRatingResponse';
import { isSyncId } from '@core/services/SyncResponse';
import type { IAstraParser } from '../interfaces/IAstraParser';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { copyAstraDates, queuedAstraDates, queuedAstraListState } from '../utils/AstraDates';
import { AstraSaveFailure, type AstraSaveStage } from './AstraSaveFailure';

/** A hover prefetch is only trusted briefly, so remote edits made elsewhere are not hidden. */
const PREFETCH_TTL_MS = 15_000;
/** Hover must rest this long before a prefetch starts: sweeping the cursor over a list costs nothing. */
const PREFETCH_DWELL_MS = 150;
/** At most this many prefetches per rolling window, a small slice of AniList's 30 req/min. */
const PREFETCH_BUDGET = 4;
const PREFETCH_WINDOW_MS = 60_000;

interface RatingPrefetch {
  userId: number;
  sessionId: string;
  startedAt: number;
  /** Sync-queue revision read before the query was sent; null until known. */
  revision: string | null;
  settled: boolean;
  /** Present once the request succeeded. */
  value?: unknown;
  response: Promise<unknown>;
}

/**
 * AniList accepts scores up to 10 with one decimal place as an integer (x10).
 * Returns undefined when there is no Astra rating, so the score key is omitted.
 * Astra's lode value (11) is kept local and clamped to 10 for AniList.
 */
export function anilistScore(overallScore: number): number | undefined {
  return Number.isFinite(overallScore) && overallScore > 0
    ? Math.round(Math.min(overallScore, 10) * 10)
    : undefined;
}

/** Notes fields of an ASTRA_SAVE payload: AniList Notes plus the conflict baseline of an Astra merge. */
interface AstraNotesPatch {
  notes?: string;
  expectedNotes?: string;
  astraNotesUpdatedAt?: number;
}

@injectable()
export class AstraRatingService implements IAstraRatingService {
  constructor(
    @inject(delay(() => AstraService)) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SyncQueue) private syncQueue: ISyncQueueService,
    @inject(TOKENS.AstraParserService) private parser: IAstraParser
  ) {}

  private prefetches = new Map<number, RatingPrefetch>();
  private prefetchStarts: number[] = [];
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hover intent: after a short dwell, starts the Quick Edit query ahead of the
   * click so opening does not wait for the rate-limited queue and the network.
   * The request rides the background lane (never the slots reserved for user
   * actions), is capped per minute, and one runs at a time. If the click comes
   * while it is still queued, the click's priority read joins and promotes it
   * through the client's shared-read dedupe, so no second request is sent.
   */
  public prefetchMediaRatingData(mediaId: number): void {
    this.cancelPrefetch();
    if (!isSyncId(mediaId)) return;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      this.startPrefetch(mediaId);
    }, PREFETCH_DWELL_MS);
  }

  /** Hover left before the dwell elapsed: drop the pending prefetch. */
  public cancelPrefetch(): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
  }

  private startPrefetch(mediaId: number): void {
    const now = Date.now();
    const existing = this.prefetches.get(mediaId);
    if (existing && now - existing.startedAt < PREFETCH_TTL_MS) return;
    for (const entry of this.prefetches.values()) if (!entry.settled) return;
    this.prefetchStarts = this.prefetchStarts.filter((at) => now - at < PREFETCH_WINDOW_MS);
    if (this.prefetchStarts.length >= PREFETCH_BUDGET) return;
    const context = this.api.getContext?.();
    if (!context || !isSyncId(context.userId)) return;
    this.prefetchStarts.push(now);
    const entry: RatingPrefetch = {
      userId: context.userId,
      sessionId: context.sessionId,
      startedAt: now,
      revision: null,
      settled: false,
      response: Promise.resolve(),
    };
    entry.response = (async () => {
      entry.revision = (await this.syncQueue.getSnapshot()).revision;
      return this.api.query<unknown>(ASTRA_RATING_QUERY, { id: mediaId }, true);
    })().then(
      (value) => {
        entry.settled = true;
        entry.value = value;
        return value;
      },
      (error: unknown) => {
        entry.settled = true;
        if (this.prefetches.get(mediaId) === entry) this.prefetches.delete(mediaId);
        throw error;
      }
    );
    entry.response.catch(() => undefined);
    this.prefetches.set(mediaId, entry);
  }

  /**
   * Consumes the prefetch for this media. Returns its response when it already
   * arrived for the same account and no sync-queue change happened since it was
   * requested. A stale request still in flight is awaited first, so the fresh
   * read below is not merged into it by the client's shared-read dedupe.
   */
  private async takePrefetch(
    mediaId: number,
    userId: number,
    sessionId: string,
    revision: string
  ): Promise<unknown> {
    const entry = this.prefetches.get(mediaId);
    if (!entry) return undefined;
    this.prefetches.delete(mediaId);
    const sameAccount = entry.userId === userId && entry.sessionId === sessionId;
    const current = sameAccount && entry.revision === revision;
    if (!current) {
      if (!entry.settled) await entry.response.catch(() => undefined);
      return undefined;
    }
    // Still in flight: the caller's priority read joins this request.
    if (!entry.settled || Date.now() - entry.startedAt >= PREFETCH_TTL_MS) return undefined;
    return entry.value;
  }

  /**
   * Fetches initial data from AniList using GQL.
   */
  public async getMediaRatingData(mediaId: number): Promise<IRatingInitialData | null> {
    try {
      if (!isSyncId(mediaId)) throw new Error('Invalid AniList media ID');
      const context = await captureApiContext(this.api);
      const userId = context ? context.userId : await this.api.getCurrentUserId();
      assertApiContext(this.api, context);
      if (!isSyncId(userId)) throw new Error('AniList authentication required');
      // A background sync may finish while AniList is replying. Re-read a
      // superseded snapshot instead of making the user's click fail silently.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await this.syncQueue.getSnapshot();
        assertApiContext(this.api, context);
        const prefetched =
          attempt === 0 && context
            ? await this.takePrefetch(mediaId, userId, context.sessionId, before.revision)
            : undefined;
        // The modal's own read: priority keeps it from waiting behind background sync reads.
        const resp =
          prefetched ??
          (await this.api.query<unknown>(ASTRA_RATING_QUERY, { id: mediaId }, false, {
            priority: true,
          }));
        assertApiContext(this.api, context);
        const result = ratingInitialResponse(resp, mediaId, userId);
        const after = await this.syncQueue.getSnapshot();
        assertApiContext(this.api, context);
        if (before.revision !== after.revision) continue;
        if (result) {
          result.pendingDeletion = after.entries.some(
            (entry) =>
              entry.userId === userId &&
              entry.type === 'ASTRA_DELETE' &&
              entry.payload.mediaId === mediaId
          );
          result.pendingReport = after.entries.some(
            (entry) =>
              entry.userId === userId &&
              entry.type === 'ASTRA_SAVE' &&
              entry.payload.mediaId === mediaId &&
              (entry.payload.notes !== undefined || entry.payload.score !== undefined)
          );
          let queuedScore: number | null | undefined;
          for (const entry of after.entries) {
            if (
              entry.userId === userId &&
              entry.type === 'ASTRA_SAVE' &&
              entry.payload.mediaId === mediaId &&
              entry.payload.score !== undefined
            ) {
              queuedScore = entry.payload.score;
            }
          }
          if (queuedScore !== undefined) result.pendingScore = queuedScore;
          const dates = queuedAstraDates(after.entries, mediaId, userId);
          const pendingListState = queuedAstraListState(after.entries, mediaId, userId);
          if (result.media.mediaListEntry) {
            const entry = result.media.mediaListEntry;
            if (pendingListState.status !== undefined) entry.status = pendingListState.status;
            if (pendingListState.progress !== undefined) entry.progress = pendingListState.progress;
            if (pendingListState.repeat !== undefined) entry.repeat = pendingListState.repeat;
            if (pendingListState.private !== undefined) entry.private = pendingListState.private;
            if (pendingListState.hidden !== undefined)
              entry.hiddenFromStatusLists = pendingListState.hidden;
            if (pendingListState.customLists !== undefined) {
              entry.customLists = Object.fromEntries(
                pendingListState.customLists.map((name) => [name, true])
              );
            }
            Object.assign(entry, dates);
          }
          // A queued new entry has no remote identity yet. Keep the intent
          // separate rather than fabricating a MediaListEntry or losing Clear.
          result.pendingDates = copyAstraDates(dates);
          result.pendingListState = pendingListState;
        }
        return result;
      }
      throw new Error('Astra pending updates changed during loading; retry');
    } catch (err) {
      logger.error('[AstraRatingService] Failed to fetch initial data', err);
      return null;
    }
  }

  public async updateProgress(mediaId: number, progress?: number): Promise<AstraProgressResult> {
    try {
      const context = await captureApiContext(this.api);
      const result = await this.syncQueue.updateProgress(mediaId, progress, context?.sessionId);
      assertApiContext(this.api, context);
      return result;
    } catch (err) {
      logger.error('[AstraRatingService] Failed to update progress', err);
      throw err;
    }
  }

  public async deleteEntry(mediaId: number): Promise<'synced' | 'queued'> {
    if (!isSyncId(mediaId)) throw new Error('Invalid AniList media ID');
    const context = await captureApiContext(this.api);
    const userId = context?.userId ?? (await this.api.getCurrentUserId());
    assertApiContext(this.api, context);
    if (!isSyncId(userId)) throw new Error('AniList authentication required');
    await this.syncQueue.enqueue(
      'ASTRA_DELETE',
      { mediaId },
      ...(context ? [context.sessionId] : [])
    );
    await this.syncQueue.process();
    assertApiContext(this.api, context);
    const pending = await this.syncQueue.getQueue();
    assertApiContext(this.api, context);
    return pending.some(
      (item) =>
        item.userId === userId && item.type === 'ASTRA_DELETE' && item.payload.mediaId === mediaId
    )
      ? 'queued'
      : 'synced';
  }

  /**
   * Drains the queue without holding the caller. Failures stay durable in the queue and are
   * only logged. `onDispatched` runs exactly once, after the drain settles.
   */
  private drainInBackground(
    mediaId: number,
    onDispatched?: (result: AstraDispatchOutcome) => void
  ): void {
    void (async () => {
      let outcome: AstraDispatchOutcome = 'queued';
      try {
        await this.syncQueue.process();
        const pending = await this.syncQueue.getQueue();
        outcome = pending.some(
          (item) => item.type === 'ASTRA_SAVE' && item.payload.mediaId === mediaId
        )
          ? 'queued'
          : 'synced';
      } catch (error) {
        logger.error('[AstraRatingService] Background synchronization failed', error);
      }
      try {
        onDispatched?.(outcome);
      } catch (error) {
        logger.error('[AstraRatingService] Dispatch callback failed', error);
      }
    })();
  }

  /**
   * Reads the current AniList notes and returns them with the Astra block merged in.
   * Unchanged notes yield no `notes`; with the option turned off meanwhile, explicit notes are kept.
   */
  private async readAstraNotes(
    work: AstraWork,
    saved: AstraWork,
    extra: AstraSaveOptions,
    context: Awaited<ReturnType<typeof captureApiContext>>
  ): Promise<AstraNotesPatch> {
    const sections = this.astraService.getSections();
    const currentData = await this.getMediaRatingData(work.mediaId);
    assertApiContext(this.api, context, saved.ownerId);
    if (!currentData) {
      throw new Error(
        'Unable to read AniList notes safely; local data was saved. Retry synchronization.'
      );
    }
    if (!this.astraService.getSettings().appendAstraToComment) return { notes: extra.notes };
    const currentNotes = currentData.media.mediaListEntry?.notes ?? '';
    const updatedNotes = this.parser.inject(currentNotes, work, sections, {
      replaceNotes: extra.replaceNotes === true,
    });
    // Explicit edited notes still use the existing editor path when the option is off.
    if (updatedNotes === currentNotes) return {};
    return { notes: updatedNotes, expectedNotes: currentNotes, astraNotesUpdatedAt: saved.updatedAt };
  }

  /**
   * Persists work locally and durably queues its AniList mutation before dispatch.
   * A failed network sync stays queued; storage failures reject the save.
   */
  public async saveAndSync(work: AstraWork, extra: AstraSaveOptions): Promise<AstraSaveResult> {
    logger.debug(`[AstraRatingService] Saving work ${work.mediaId}...`);

    let stage: AstraSaveStage = 'VALIDATE';
    let localCommitted = false;
    try {
      if (!isSyncId(work.mediaId)) {
        throw new Error('Invalid AniList media ID');
      }
      if (
        !Number.isFinite(extra.overallScore) ||
        extra.overallScore < 0 ||
        extra.overallScore > 11
      ) {
        throw new Error('Astra score must be between 0 and 11');
      }
      for (const value of [extra.progress, extra.repeat]) {
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
        ) {
          throw new Error('Progress and repeat must be non-negative GraphQL integers');
        }
      }
      const dates = copyAstraDates(extra);

      stage = 'ACCOUNT';
      const context = await captureApiContext(this.api);
      assertApiContext(this.api, context, work.ownerId);
      // 1. Local Persistence (Atomic & Critical)
      // Always skip background sync because we handle it here
      stage = 'LOCAL';
      const saved = await this.astraService.saveWork({ ...work, ...dates }, true);
      localCommitted = true;
      // Keep the caller's detached draft usable after a successful local commit,
      // including when the subsequent network/queue operation fails.
      work.updatedAt = saved.updatedAt;
      work.ownerId = saved.ownerId;
      Object.assign(work, copyAstraDates(saved));
      assertApiContext(this.api, context, saved.ownerId);

      if (extra.skipSync) {
        logger.info(`[AstraRatingService] Local save only (skipSync) for ${work.mediaId}`);
        return 'local';
      }

      // 2. Prepare Mutation Payload
      // Policy: when "append Astra to comment" is enabled, embed the Astra block
      // into the AniList Notes while preserving all surrounding personal text.
      const injectNotes =
        this.astraService.getSettings().appendAstraToComment &&
        (extra.syncAstraNotes !== false || extra.replaceNotes === true);
      const remoteScore = extra.syncScore === false ? undefined : anilistScore(extra.overallScore);
      const payloadWith = (notes: AstraNotesPatch) => ({
        mediaId: work.mediaId,
        status: work.status,
        progress: extra.progress ?? work.progress,
        // An unrated save must leave AniList's own score untouched (and any queued score intact).
        ...(remoteScore === undefined ? {} : { score: remoteScore }),
        repeat: extra.repeat,
        private: extra.private ?? work.isPrivate,
        hidden: extra.hidden ?? work.isHidden,
        ...(notes.notes === undefined ? {} : { notes: notes.notes }),
        ...(notes.expectedNotes === undefined
          ? {}
          : { expectedNotes: notes.expectedNotes, astraNotesUpdatedAt: notes.astraNotesUpdatedAt }),
        lists: extra.customLists ?? work.customLists,
        ...dates,
      });
      const session = context ? [context.sessionId] : [];

      if (injectNotes && extra.dispatch === 'background') {
        // Closing must not wait for an AniList read (the shared queue is rate limited). Everything
        // but the notes is queued durably now; the Astra block follows as a newer save of the entry.
        assertApiContext(this.api, context, saved.ownerId);
        stage = 'QUEUE';
        await this.syncQueue.enqueue('ASTRA_SAVE', payloadWith({}), ...session);
        void (async () => {
          try {
            const notes = await this.readAstraNotes(work, saved, extra, context);
            if (notes.notes !== undefined)
              await this.syncQueue.enqueue('ASTRA_SAVE', payloadWith(notes), ...session);
          } catch (error) {
            logger.error('[AstraRatingService] Astra notes were not queued; local data is saved', error);
          }
          this.drainInBackground(work.mediaId, extra.onDispatched);
        })();
        return 'queued';
      }

      let notes: AstraNotesPatch = { notes: extra.notes };
      if (injectNotes) {
        stage = 'NOTES';
        notes = await this.readAstraNotes(work, saved, extra, context);
      }

      // Persist first and replace older pending saves BEFORE dispatching.
      // A successful direct mutation must not be undone by an older offline retry.
      assertApiContext(this.api, context, saved.ownerId);
      stage = 'QUEUE';
      await this.syncQueue.enqueue('ASTRA_SAVE', payloadWith(notes), ...session);
      if (extra.dispatch === 'background') {
        // The durable entry exists, so the caller may finish now; the drain reports back later.
        this.drainInBackground(work.mediaId, extra.onDispatched);
        return 'queued';
      }
      stage = 'DISPATCH';
      await this.syncQueue.process();
      assertApiContext(this.api, context, saved.ownerId);
      stage = 'VERIFY';
      const pending = await this.syncQueue.getQueue();
      if (
        pending.some((item) => item.type === 'ASTRA_SAVE' && item.payload.mediaId === work.mediaId)
      ) {
        return 'queued';
      }
      logger.success(`[AstraRatingService] Sync completed for ${work.mediaId}`);
      return 'synced';
    } catch (err) {
      logger.error('[AstraRatingService] Save or durable synchronization failed', err);
      throw new AstraSaveFailure(stage, localCommitted, err);
    }
  }
}
