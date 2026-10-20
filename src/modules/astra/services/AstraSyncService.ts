/**
 * @file AstraSyncService.ts
 * @description Service for synchronizing Astra data with AniList.
 */

import { injectable, inject } from 'tsyringe';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { isSyncId } from '@core/services/SyncResponse';
import type { MediaType } from '@/api/AnilistTypes';
import { ASTRA_SYNC_COLLECTION } from '@/api/queries/astra-sync';
import { astraSyncCollection, type AstraSyncEntry } from './AstraSyncResponse';
import { AstraRepository } from '../store/AstraRepository';
import type { IAstraParser, ParsedAstraReport } from '../interfaces/IAstraParser';
import type { AstraPendingListState } from '../interfaces/IAstraRatingService';
import type { AstraSection, AstraWork } from '../AstraInterfaces';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { copyAstraDates, indexQueuedAstraDates, queuedAstraListState } from '../utils/AstraDates';
import { reconcileWithRemote } from '../utils/AstraRemoteReconcile';

@injectable()
export class AstraSyncService {
  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(TOKENS.AstraParserService) private parser: IAstraParser,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.SyncQueue) private syncQueue: Pick<ISyncQueueService, 'getSnapshot'>
  ) {}

  /**
   * Sync all user works from AniList.
   */
  public async syncWithAniList(): Promise<{ added: number; updated: number }> {
    const context = await captureApiContext(this.api);
    await this.repository.init();
    assertApiContext(this.api, context);

    try {
      const viewer = await this.api.getCurrentUser();
      const userId = viewer.id;
      assertApiContext(this.api, context);
      if (!isSyncId(userId) || (context && context.userId !== userId))
        throw new Error('Invalid AniList Astra viewer response');
      const pendingDates = await this.syncQueue.getSnapshot();
      assertApiContext(this.api, context);
      const pendingByMedia = indexQueuedAstraDates(pendingDates.entries, userId);
      const deletingMedia = new Set(
        pendingDates.entries
          .filter((entry) => entry.userId === userId && entry.type === 'ASTRA_DELETE')
          .map((entry) => entry.payload.mediaId)
      );
      const pendingNotesMedia = new Set(
        pendingDates.entries
          .filter(
            (entry) =>
              entry.userId === userId &&
              entry.type === 'ASTRA_SAVE' &&
              entry.payload.notes !== undefined
          )
          .map((entry) => entry.payload.mediaId)
      );
      // A queued notes or score write is a local report newer than this remote snapshot; keep it over AniList.
      const pendingReportMedia = new Set(
        pendingDates.entries
          .filter(
            (entry) =>
              entry.userId === userId &&
              entry.type === 'ASTRA_SAVE' &&
              (entry.payload.notes !== undefined || entry.payload.score !== undefined)
          )
          .map((entry) => entry.payload.mediaId)
      );

      // Newest queued list fields per work (status, progress, lists, privacy), indexed once like dates.
      const ownQueuedSaves = pendingDates.entries.filter(
        (entry) => entry.userId === userId && entry.type === 'ASTRA_SAVE'
      );
      const pendingListByMedia = new Map<number, AstraPendingListState>(
        [...new Set(ownQueuedSaves.map((entry) => entry.payload.mediaId!))] // Validated by indexQueuedAstraDates above.
          .map((mediaId): [number, AstraPendingListState] => [
            mediaId,
            queuedAstraListState(ownQueuedSaves, mediaId, userId),
          ])
      );
      // Remote Astra report blocks are merged only while "append Astra to comment" is enabled.
      const appendAstraToComment = this.repository.getSettings().appendAstraToComment;

      // Both remote collections must be complete, owned and detached before we
      // read or change a local work. A failed second response cannot publish the first.
      let totalEntries = 0;
      let batchFailed = false;
      const readCollection = async (type: MediaType): Promise<AstraSyncEntry[]> => {
        try {
          const entries = new Map<number, AstraSyncEntry>();
          const entryIds = new Map<number, number>();
          for (let chunk = 1; chunk <= 100; chunk++) {
            if (batchFailed) throw new Error('Astra collection read stopped');
            assertApiContext(this.api, context);
            const response = await this.api.query<unknown>(ASTRA_SYNC_COLLECTION, {
              userId,
              type,
              chunk,
              perChunk: 500,
            });
            // Consume the accepted response, but never continue a failed sibling's batch.
            if (batchFailed) throw new Error('Astra collection read stopped');
            assertApiContext(this.api, context);
            const page = astraSyncCollection(response, userId, type);
            const before = entries.size;
            for (const entry of page.entries) {
              const previous = entries.get(entry.mediaId);
              if (
                (previous && JSON.stringify(previous) !== JSON.stringify(entry)) ||
                (entryIds.has(entry.id) && entryIds.get(entry.id) !== entry.mediaId)
              )
                throw new Error('Invalid AniList Astra collection response');
              if (!previous && ++totalEntries > 10000)
                throw new Error('AniList Astra collection exceeds archive capacity');
              entries.set(entry.mediaId, entry);
              entryIds.set(entry.id, entry.mediaId);
            }
            if (!page.hasNextChunk) return [...entries.values()];
            if (entries.size === before) throw new Error('Incomplete AniList Astra collection');
          }
          throw new Error('Incomplete AniList Astra collection');
        } catch (error) {
          batchFailed = true;
          throw error;
        }
      };
      const [animeEntries, mangaEntries] = await Promise.all([
        readCollection('ANIME'),
        readCollection('MANGA'),
      ]);
      assertApiContext(this.api, context);
      const animeMedia = new Set(animeEntries.map((entry) => entry.mediaId));
      const animeIds = new Set(animeEntries.map((entry) => entry.id));
      if (mangaEntries.some((entry) => animeMedia.has(entry.mediaId) || animeIds.has(entry.id)))
        throw new Error('Invalid AniList Astra collection response');

      let addedCount = 0;
      let updatedCount = 0;

      const sections = this.repository.getSections();
      const existingSummariesByMediaId = new Map(
        this.repository.getWorks().map((summary) => [summary.mediaId, summary])
      );
      const existingMediaIds = new Set(existingSummariesByMediaId.keys());
      const staged = new Map<number, AstraWork>();

      const processResult = async (entries: AstraSyncEntry[]) => {
        for (const entry of entries) {
          if (deletingMedia.has(entry.mediaId)) continue;
          const dates = { ...copyAstraDates(entry), ...pendingByMedia.get(entry.mediaId) };
          const fields = this.effectiveListFields(entry, pendingListByMedia.get(entry.mediaId));
          const existingSummary = existingMediaIds.has(entry.mediaId);
          // A pending replacement is newer than this remote snapshot. Do not
          // import stale report/Journal content over the locally saved version.
          if (!existingSummary && pendingNotesMedia.has(entry.mediaId)) continue;

          if (existingSummary) {
            const stored =
              staged.get(entry.mediaId) ?? (await this.repository.getFullWork(entry.mediaId));
            const full = stored ? structuredClone(stored) : undefined;
            assertApiContext(this.api, context, full?.ownerId);
            if (!full) throw new Error('Astra local work is unavailable');
            if (full.mediaId !== entry.mediaId)
              throw new Error('Invalid Astra local work identity');

            const newTitle =
              entry.media.title.english ||
              entry.media.title.romaji ||
              entry.media.title.native ||
              'Unknown Title';
            let changed = false;
            if (JSON.stringify(copyAstraDates(full)) !== JSON.stringify(dates)) {
              Object.assign(full, dates);
              changed = true;
            }

            if (full.status !== fields.status || full.title !== newTitle) {
              full.title = newTitle;
              full.status = fields.status;
              changed = true;
            }

            // Sync metadata
            const customLists = fields.customLists;
            const currentSummary = existingSummariesByMediaId.get(entry.mediaId);
            if (
              JSON.stringify(full.customLists) !== JSON.stringify(customLists) ||
              JSON.stringify(currentSummary?.customLists || []) !== JSON.stringify(customLists)
            ) {
              full.customLists = customLists;
              changed = true;
            }

            // Persist refreshed media metadata. These were previously assigned
            // without flagging `changed`, so updated episode/chapter totals never
            // got saved (entries stayed stuck on "?" until something else changed).
            const nextEpisodes = entry.media.episodes ?? undefined;
            const nextChapters = entry.media.chapters ?? undefined;
            const nextDuration = entry.media.duration ?? undefined;
            const nextGenres = entry.media.genres || [];
            const nextPrivate = fields.isPrivate;
            const nextHidden = fields.isHidden;
            if (
              full.episodes !== nextEpisodes ||
              full.chapters !== nextChapters ||
              full.progress !== fields.progress ||
              full.duration !== nextDuration ||
              full.isPrivate !== nextPrivate ||
              full.isHidden !== nextHidden ||
              JSON.stringify(full.genres) !== JSON.stringify(nextGenres)
            ) {
              changed = true;
            }
            full.genres = nextGenres;
            full.episodes = nextEpisodes;
            full.chapters = nextChapters;
            full.progress = fields.progress;
            full.duration = nextDuration;
            full.isPrivate = nextPrivate;
            full.isHidden = nextHidden;
            // AniList is the source of truth for notes and score unless a newer local report is queued.
            if (!pendingReportMedia.has(entry.mediaId)) {
              const reconciled = reconcileWithRemote(
                full,
                { notes: entry.notes, score: entry.score },
                { sections, appendAstraToComment, parser: this.parser }
              );
              if (reconciled.changed) {
                full.notes = reconciled.work.notes;
                full.seasons = reconciled.work.seasons;
                changed = true;
              }
            }

            if (changed) {
              staged.set(full.mediaId, full);
              existingMediaIds.add(full.mediaId);
              updatedCount++;
            }
          } else {
            // NEW WORK
            const media = entry.media;
            const type =
              media.type === 'ANIME' ? 'anime' : media.format === 'NOVEL' ? 'novel' : 'manga';

            const remoteReport = entry.notes ? this.readRemoteReport(entry, sections) : null;
            const newWork: AstraWork = {
              id: `w_new_${entry.mediaId}`, // Temporary ID, saveWork will generate proper UUID if needed
              mediaId: entry.mediaId,
              ...(context ? { ownerId: context.userId } : {}),
              title:
                media.title.english || media.title.romaji || media.title.native || 'Unknown Title',
              type,
              country: media.countryOfOrigin ?? undefined,
              cover:
                media.coverImage.extraLarge ||
                media.coverImage.large ||
                media.coverImage.medium ||
                undefined,
              status: fields.status,
              ...dates,
              isPrivate: fields.isPrivate,
              isHidden: fields.isHidden,
              customLists: fields.customLists,
              tags: [],
              seasons: [this.repository.createDefaultSeason()],
              // With Astra disabled the managed block stays on AniList and out of local notes.
              notes:
                remoteReport && !appendAstraToComment
                  ? (remoteReport.cleanText ?? '')
                  : entry.notes || '',
              updatedAt: Date.now(),
              genres: media.genres || [],
              episodes: media.episodes ?? undefined,
              chapters: media.chapters ?? undefined,
              progress: fields.progress,
              duration: media.duration ?? undefined,
            };

            if (remoteReport && appendAstraToComment) this.parser.merge(newWork, remoteReport);

            staged.set(newWork.mediaId, newWork);
            existingMediaIds.add(newWork.mediaId);
            addedCount++;
          }
        }
      };

      await processResult(animeEntries);
      await processResult(mangaEntries);
      assertApiContext(this.api, context);
      const currentQueue = await this.syncQueue.getSnapshot();
      assertApiContext(this.api, context);
      if (pendingDates.revision !== currentQueue.revision)
        throw new Error('Astra pending dates changed; retry synchronization');

      // One durable batch contains the full works and manifest. Interrupted bulk
      // imports recover as a whole, without successful but unindexed saves.
      await this.repository.saveWorks([...staged.values()]);

      logger.info(
        `[AstraSyncService] Sync complete: +${addedCount} added, ~${updatedCount} updated`
      );
      this.eventBus.emit(EVENT_TYPES.ASTRA_SYNC_COMPLETE, {
        added: addedCount,
        updated: updatedCount,
      });
      return { added: addedCount, updated: updatedCount };
    } catch (error) {
      logger.error('[AstraSyncService] Sync failed');
      throw error;
    }
  }

  /** Remote list fields overlaid with this owner's queued ASTRA_SAVE intent (the newest local decision wins). */
  private effectiveListFields(entry: AstraSyncEntry, pending: AstraPendingListState | undefined) {
    const isPrivate = pending?.private ?? !!entry.private;
    const isHidden = pending?.hidden ?? !!entry.hiddenFromStatusLists;
    return {
      status: pending?.status ?? entry.status,
      progress: pending?.progress ?? entry.progress,
      isPrivate,
      isHidden,
      customLists:
        pending?.customLists ??
        this.parseCustomLists({
          customLists: entry.customLists,
          private: isPrivate,
          hiddenFromStatusLists: isHidden,
        }),
    };
  }

  /**
   * Parses the Astra block of a remote entry. Returns null for plain notes and undefined when the
   * block is malformed, so only this entry's notes merge is skipped and the sync continues.
   */
  private readRemoteReport(
    entry: AstraSyncEntry,
    sections: AstraSection[]
  ): ParsedAstraReport | null | undefined {
    try {
      return this.parser.parse(entry.notes, sections);
    } catch (error) {
      logger.warn(
        `[AstraSyncService] Skipped unreadable Astra Notes for media ${entry.mediaId}`,
        error
      );
      return undefined;
    }
  }

  private parseCustomLists(
    entry: Pick<AstraSyncEntry, 'customLists' | 'private' | 'hiddenFromStatusLists'>
  ): string[] {
    let customLists: string[] = [];
    if (entry.customLists) {
      const cl = entry.customLists;
      customLists = Object.keys(cl).filter((k) => cl[k]);
    }
    if (entry.private) customLists.push('Private');
    if (entry.hiddenFromStatusLists) customLists.push('Hide from status lists');
    return customLists;
  }
}
