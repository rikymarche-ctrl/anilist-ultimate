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
import type { IAstraRatingService, IRatingInitialData, AstraSaveOptions, AstraSaveResult, AstraProgressResult } from '../interfaces/IAstraRatingService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { ASTRA_RATING_QUERY } from '@/api/queries/astra-rating';
import { ratingInitialResponse } from './AstraRatingResponse';
import { isSyncId } from '@core/services/SyncResponse';
import type { IAstraParser } from '../interfaces/IAstraParser';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { copyAstraDates, queuedAstraDates, queuedAstraListState } from '../utils/AstraDates';
import { AstraSaveFailure, type AstraSaveStage } from './AstraSaveFailure';

/**
 * AniList accepts scores up to 10 with one decimal place as an integer (x10).
 * Returns undefined when there is no Astra rating, so the score key is omitted.
 * Astra's lode value (11) is kept local and clamped to 10 for AniList.
 */
export function anilistScore(overallScore: number): number | undefined {
  return Number.isFinite(overallScore) && overallScore > 0 ? Math.round(Math.min(overallScore, 10) * 10) : undefined;
}

@injectable()
export class AstraRatingService implements IAstraRatingService {
  constructor(
    @inject(delay(() => AstraService)) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SyncQueue) private syncQueue: ISyncQueueService,
    @inject(TOKENS.AstraParserService) private parser: IAstraParser
  ) {}

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
        const resp = await this.api.query<unknown>(ASTRA_RATING_QUERY, { id: mediaId });
        assertApiContext(this.api, context);
        const result = ratingInitialResponse(resp, mediaId, userId);
        const after = await this.syncQueue.getSnapshot();
        assertApiContext(this.api, context);
        if (before.revision !== after.revision) continue;
        if (result) {
          result.pendingDeletion = after.entries.some(entry => entry.userId === userId
            && entry.type === 'ASTRA_DELETE' && entry.payload.mediaId === mediaId);
          const dates = queuedAstraDates(after.entries, mediaId, userId);
          const pendingListState = queuedAstraListState(after.entries, mediaId, userId);
          if (result.media.mediaListEntry) {
            const entry = result.media.mediaListEntry;
            if (pendingListState.status !== undefined) entry.status = pendingListState.status;
            if (pendingListState.progress !== undefined) entry.progress = pendingListState.progress;
            if (pendingListState.repeat !== undefined) entry.repeat = pendingListState.repeat;
            if (pendingListState.private !== undefined) entry.private = pendingListState.private;
            if (pendingListState.hidden !== undefined) entry.hiddenFromStatusLists = pendingListState.hidden;
            if (pendingListState.customLists !== undefined) {
              entry.customLists = Object.fromEntries(pendingListState.customLists.map(name => [name, true]));
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

  public async updateProgress(
    mediaId: number,
    progress?: number
  ): Promise<AstraProgressResult> {
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
    const userId = context?.userId ?? await this.api.getCurrentUserId();
    assertApiContext(this.api, context);
    if (!isSyncId(userId)) throw new Error('AniList authentication required');
    await this.syncQueue.enqueue('ASTRA_DELETE', { mediaId }, ...(context ? [context.sessionId] : []));
    await this.syncQueue.process();
    assertApiContext(this.api, context);
    const pending = await this.syncQueue.getQueue();
    assertApiContext(this.api, context);
    return pending.some(item => item.userId === userId && item.type === 'ASTRA_DELETE'
      && item.payload.mediaId === mediaId) ? 'queued' : 'synced';
  }

  /**
   * Persists work locally and durably queues its AniList mutation before dispatch.
   * A failed network sync stays queued; storage failures reject the save.
   */
  public async saveAndSync(
    work: AstraWork,
    extra: AstraSaveOptions
  ): Promise<AstraSaveResult> {
    logger.debug(`[AstraRatingService] Saving work ${work.mediaId}...`);

    let stage: AstraSaveStage = 'VALIDATE';
    let localCommitted = false;
    try {
      if (!isSyncId(work.mediaId)) {
        throw new Error('Invalid AniList media ID');
      }
      if (!Number.isFinite(extra.overallScore) || extra.overallScore < 0 || extra.overallScore > 11) {
        throw new Error('Astra score must be between 0 and 11');
      }
      for (const value of [extra.progress, extra.repeat]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)) {
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
      const settings = this.astraService.getSettings();
      let notesToSync = extra.notes;
      let expectedNotes: string | null | undefined;
      let astraNotesUpdatedAt: number | undefined;

      // Policy: when "append Astra to comment" is enabled, embed the Astra block
      // into the AniList Notes while preserving all surrounding personal text.
      if (settings.appendAstraToComment && extra.syncAstraNotes !== false) {
        stage = 'NOTES';
        const sections = this.astraService.getSections();
        const currentData = await this.getMediaRatingData(work.mediaId);
        assertApiContext(this.api, context, saved.ownerId);
        if (!currentData) {
          throw new Error('Unable to read AniList notes safely; local data was saved. Retry synchronization.');
        }
        if (this.astraService.getSettings().appendAstraToComment) {
          const currentNotes = currentData.media.mediaListEntry?.notes ?? '';
          const updatedNotes = this.parser.inject(currentNotes, work, sections);
          // Explicit edited notes still use the existing editor path when the option is off.
          notesToSync = updatedNotes === currentNotes ? undefined : updatedNotes;
          if (notesToSync !== undefined) {
            expectedNotes = currentNotes;
            astraNotesUpdatedAt = saved.updatedAt;
          }
        }
      }

      const remoteScore = anilistScore(extra.overallScore);
      const payload = {
        mediaId: work.mediaId,
        status: work.status,
        progress: extra.progress ?? work.progress,
        // An unrated save must leave AniList's own score untouched (and any queued score intact).
        ...(remoteScore === undefined ? {} : { score: remoteScore }),
        repeat: extra.repeat,
        private: extra.private ?? work.isPrivate,
        hidden: extra.hidden ?? work.isHidden,
        ...(notesToSync === undefined ? {} : { notes: notesToSync }),
        ...(expectedNotes === undefined ? {} : { expectedNotes, astraNotesUpdatedAt }),
        lists: extra.customLists ?? work.customLists,
        ...dates,
      };

      // Persist first and replace older pending saves BEFORE dispatching.
      // A successful direct mutation must not be undone by an older offline retry.
      assertApiContext(this.api, context, saved.ownerId);
      stage = 'QUEUE';
      await this.syncQueue.enqueue('ASTRA_SAVE', payload, ...(context ? [context.sessionId] : []));
      stage = 'DISPATCH';
      await this.syncQueue.process();
      assertApiContext(this.api, context, saved.ownerId);
      stage = 'VERIFY';
      const pending = await this.syncQueue.getQueue();
      if (pending.some(item => item.type === 'ASTRA_SAVE' && item.payload.mediaId === work.mediaId)) {
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
