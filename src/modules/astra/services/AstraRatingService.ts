/**
 * @file AstraRatingService.ts
 * @description Enterprise-grade implementation of the Astra Rating Service.
 * Isolates AniList API interactions and persistence logic from UI controllers.
 */

import { injectable, inject, delay } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { AstraService } from '../AstraService';
import type { AstraWork } from '../AstraInterfaces';
import { IAstraRatingService, IRatingInitialData } from '../interfaces/IAstraRatingService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { MediaWithViewerResponse } from '@/api/AnilistTypes';
import type { IAstraParser } from '../interfaces/IAstraParser';

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
    const GQL = `query($id: Int) {
      Viewer { mediaListOptions { animeList { customLists } } }
      Media(id: $id) {
        id title { userPreferred } type format episodes status countryOfOrigin
        nextAiringEpisode { episode }
        coverImage { large extraLarge color }
        mediaListEntry {
          status progress score(format: POINT_100) notes
          repeat private hiddenFromStatusLists
          startedAt { year month day }
          completedAt { year month day }
          customLists
        }
      }
    }`;

    try {
      const resp = await this.api.query<MediaWithViewerResponse>(GQL, { id: mediaId });
      if (!resp.Media) return null;

      return {
        media: resp.Media,
        allCustomLists: resp.Viewer?.mediaListOptions?.animeList?.customLists || []
      };
    } catch (err) {
      log.error('[AstraRatingService] Failed to fetch initial data', err);
      return null;
    }
  }

  public async fetchInitialData(mediaId: number): Promise<IRatingInitialData | null> {
    return this.getMediaRatingData(mediaId);
  }

  public async updateProgress(mediaId: number, progress?: number): Promise<{ mediaId: number; progress: number; title: string }> {
    try {
      const userId = await this.api.getCurrentUserId();
      if (!userId) throw new Error('Not logged in');

      const data = await this.api.query<any>(`
        query ($mediaId: Int, $userId: Int) {
          MediaList(mediaId: $mediaId, userId: $userId) {
            id progress status media { id title { userPreferred } }
          }
        }
      `, { mediaId, userId });

      if (!data?.MediaList) throw new Error('Entry not found');

      const entry = data.MediaList;
      const newProgress = progress ?? (entry.progress || 0) + 1;

      await this.api.mutate(`
        mutation ($id: Int, $progress: Int) {
          SaveMediaListEntry(id: $id, progress: $progress) { id progress }
        }
      `, { id: entry.id, progress: newProgress });

      return {
        mediaId: entry.media.id,
        progress: newProgress,
        title: entry.media.title.userPreferred
      };
    } catch (err) {
      log.error('[AstraRatingService] Failed to update progress', err);
      throw err;
    }
  }

  /**
   * Persists work locally and triggers AniList mutation.
   * If sync fails, it is queued for background retry.
   */
  public async saveAndSync(work: AstraWork, extra: {
    overallScore: number;
    progress?: number;
    repeat?: number;
    private?: boolean;
    hidden?: boolean;
    notes?: string;
    customLists?: string[];
    startedAt?: any;
    completedAt?: any;
    skipSync?: boolean;
  }): Promise<void> {
    log.debug(`[AstraRatingService] Saving work ${work.mediaId}...`);

    try {
      // 1. Local Persistence (Atomic & Critical)
      // Always skip background sync because we handle it here
      await this.astraService.saveWork(work, true);

      // 2. Prepare Mutation Payload
      const settings = this.astraService.getSettings();
      let notesToSync = extra.notes || work.notes;

      // Policy: when "append Astra to comment" is enabled, embed the Astra block
      // into the AniList notes (preserving the user's surrounding text), moving the
      // plain notes inside the block. This is intentionally distinct from
      // AstraSyncManager.push(), which always embeds the block for background syncs.
      if (settings.appendAstraToComment) {
        const sections = this.astraService.getSections();
        const currentData = await this.getMediaRatingData(work.mediaId);
        const currentNotes = currentData?.media?.mediaListEntry?.notes || '';
        notesToSync = this.parser.inject(currentNotes, work, sections, true);
      }

      const payload = {
        mediaId: work.mediaId,
        status: work.status,
        progress: extra.progress ?? work.progress,
        score: Math.round(extra.overallScore * 10),
        repeat: extra.repeat || 0,
        private: extra.private ?? false,
        hidden: extra.hidden ?? false,
        notes: notesToSync,
        lists: extra.customLists || work.customLists,
        startedAt: extra.startedAt,
        completedAt: extra.completedAt
      };

      if (extra.skipSync) {
        log.info(`[AstraRatingService] Local save only (skipSync) for ${work.mediaId}`);
        return;
      }

      // 3. Attempt Immediate AniList Sync
      try {
        const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$notes:String,$lists:[String],$startedAt:FuzzyDateInput,$completedAt:FuzzyDateInput) {
          SaveMediaListEntry(
            mediaId:$mediaId,
            status:$status,
            progress:$progress,
            scoreRaw:$score,
            repeat:$repeat,
            private:$private,
            hiddenFromStatusLists:$hidden,
            notes:$notes,
            customLists:$lists,
            startedAt:$startedAt,
            completedAt:$completedAt
          ) { id }
        }`;

        await this.api.mutate(GQL_SAVE, payload);
        log.success(`[AstraRatingService] Sync completed for ${work.mediaId}`);
      } catch (syncErr) {
        log.warn(`[AstraRatingService] Network sync failed for ${work.mediaId}. Enqueueing mutation.`, syncErr);

        // 4. Persistence Fallback: Enqueue for background sync
        await this.syncQueue.enqueue('ASTRA_SAVE', payload);

        // We don't re-throw here because local save succeeded and background sync is guaranteed.
        // However, we might want to notify the UI that it's "Saved offline".
      }
    } catch (err) {
      log.error('[AstraRatingService] Local save failed (Critical)', err);
      throw err; // Re-throw only if local save failed
    }
  }
}
