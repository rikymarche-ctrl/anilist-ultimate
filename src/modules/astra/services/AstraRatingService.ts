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
import { MediaWithViewerResponse } from '@/api/AnilistTypes';

@injectable()
export class AstraRatingService implements IAstraRatingService {
  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient
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
   */
  public async saveAndSync(work: AstraWork, extra: {
    overallScore: number;
    progress?: number;
    repeat?: number;
    private?: boolean;
    hidden?: boolean;
    notes?: string;
    customLists?: string[];
  }): Promise<void> {
    log.debug(`[AstraRatingService] Saving work ${work.mediaId}...`);

    try {
      // 1. Local Persistence
      await this.astraService.saveWork(work);

      // 2. AniList Sync (Mutation)
      const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$notes:String,$lists:[String]) {
        SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,notes:$notes,customLists:$lists) { id status progress score }
      }`;

      await this.api.mutate(GQL_SAVE, {
        mediaId: work.mediaId,
        status: work.status,
        progress: extra.progress ?? work.progress,
        score: Math.round(extra.overallScore * 10),
        repeat: extra.repeat || 0,
        private: extra.private || false,
        hidden: extra.hidden || false,
        notes: extra.notes || work.notes,
        lists: extra.customLists || work.customLists
      });

      log.success(`[AstraRatingService] Sync completed for ${work.mediaId}`);
    } catch (err) {
      log.error('[AstraRatingService] Save/Sync failed', err);
      throw err; // Propagate to controller for UI feedback
    }
  }
}
