import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { AstraRepository } from '../store/AstraRepository';
import type { IAstraParser } from '../interfaces/IAstraParser';
import type { IAstraRatingService } from '../interfaces/IAstraRatingService';
import type { AstraWork } from '../AstraInterfaces';
import type { IApiClient } from '@core/interfaces/IApiClient';

/**
 * Unified Manager for all Astra <-> AniList synchronization tasks.
 * Serves as the single source of truth for communication with external APIs.
 */
@injectable()
export class AstraSyncManager {
  constructor(
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(TOKENS.AstraParserService) private parser: IAstraParser,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  /**
   * Performs a Just-In-Time (JIT) pull from AniList.
   * Fetches latest notes, decomposes them, and merges into the local work object.
   */
  public async pull(mediaId: number, work: AstraWork): Promise<boolean> {
    try {
      log.debug(`[AstraSyncManager] Pulling data for media ${mediaId}`);
      
      const data = await this.ratingService.getMediaRatingData(mediaId);
      if (!data || !data.media?.mediaListEntry) {
        log.debug(`[AstraSyncManager] No AniList entry found for ${mediaId}`);
        return false;
      }

      const sections = this.repository.getSections();
      const notes = data.media.mediaListEntry.notes || '';
      log.debug(`[AstraSyncManager] AniList notes for ${mediaId} (length: ${notes.length})`);
      
      const parsed = this.parser.parse(notes, sections);
      
      let changed = false;
      if (parsed) {
        log.debug(`[AstraSyncManager] Block found. CleanText: "${parsed.cleanText?.substring(0, 20)}..."`);
        changed = this.parser.merge(work, parsed);
      } else {
        log.debug(`[AstraSyncManager] No block found. Fallback to plain text.`);
        // Plain text fallback sync
        if (work.notes !== notes) {
          log.info(`[AstraSyncManager] Updating plain notes for ${mediaId}`);
          work.notes = notes;
          const season = work.seasons[work.seasons.length - 1];
          if (season) season.notes = notes;
          changed = true;
        }
      }
      
      if (changed) {
        log.info(`[AstraSyncManager] Saved synced changes for ${mediaId}`);
        await this.repository.saveWork(work); // Save locally
      }

      return changed;
    } catch (e) {
      log.error(`[AstraSyncManager] Pull failed for ${mediaId}`, e);
      return false;
    }
  }

  /**
   * Pushes local work state to AniList.
   * Strictly preserves existing non-Astra text in the AniList notes.
   * 
   * @param mediaId AniList media ID
   * @param work Local Astra work object
   * @param currentNotes Optional: The latest notes from AniList to avoid a redundant fetch.
   */
  public async push(mediaId: number, work: AstraWork, currentNotes?: string): Promise<void> {
    try {
      log.debug(`[AstraSyncManager] Pushing data for media ${mediaId}`);
      
      // 1. Ensure we have the latest notes to preserve "Top/Bottom" text
      let baseNotes = currentNotes;
      if (baseNotes === undefined) {
        const data = await this.ratingService.getMediaRatingData(mediaId);
        baseNotes = data?.media?.mediaListEntry?.notes || '';
      }
      
      // 2. Inject or replace the Astra block
      const sections = this.repository.getSections();
      const settings = this.repository.getSettings();
      const updatedNotes = this.parser.inject(baseNotes, work, sections, settings.appendAstraToComment);

      // 3. Send mutation
      if (updatedNotes !== baseNotes) {
        await this.api.mutate(`
          mutation($id: Int, $notes: String) {
            SaveMediaListEntry(mediaId: $id, notes: $notes) { id }
          }
        `, { id: mediaId, notes: updatedNotes });
        log.info(`[AstraSyncManager] Successfully pushed notes to AniList for ${mediaId}`);
      }
    } catch (e) {
      log.error(`[AstraSyncManager] Push failed for ${mediaId}`, e);
      throw e;
    }
  }
}
