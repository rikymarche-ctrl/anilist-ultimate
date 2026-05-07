/**
 * @file AstraRatingService.ts
 * @description Enterprise-grade implementation of the Astra Rating Service.
 * Isolates AniList API interactions and persistence logic from UI controllers.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { AstraService, AstraWork } from '../AstraService';
import { IAstraRatingService, IRatingInitialData } from '../interfaces/IAstraRatingService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { MediaWithViewerResponse } from '@/api/AnilistTypes';

@injectable()
export class AstraRatingService implements IAstraRatingService {
  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SyncQueue) private syncQueue: ISyncQueueService
  ) {}

  /**
   * Fetches initial data from AniList using GQL.
   */
  public async fetchInitialData(mediaId: number): Promise<IRatingInitialData | null> {
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
  }): Promise<void> {
    log.debug(`[AstraRatingService] Saving work ${work.mediaId}...`);

    try {
      // 1. Local Persistence (Atomic & Critical)
      await this.astraService.saveWork(work);

      // 2. Prepare Mutation Payload
      const payload = {
        mediaId: work.mediaId,
        status: work.status,
        progress: extra.progress ?? work.progress,
        score: Math.round(extra.overallScore * 10),
        repeat: extra.repeat || 0,
        private: extra.private ?? false,
        hidden: extra.hidden ?? false,
        notes: extra.notes || work.notes,
        lists: extra.customLists || work.customLists,
        startedAt: extra.startedAt,
        completedAt: extra.completedAt
      };

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
