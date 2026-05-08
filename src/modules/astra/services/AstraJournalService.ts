/**
 * @file AstraJournalService.ts
 * @description Logic for managing episode-specific notes and scores
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService } from '../AstraService';
import type { AstraWork, AstraSeason, AstraEpisodeNote } from '../AstraInterfaces';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';

@injectable()
@singleton()
export class AstraJournalService {
  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on(EVENT_TYPES.ASTRA_SAVE_NOTE, async (data) => {
      if (!data) return;
      const { mediaId, episode, notes } = data;
      // Find the current season for this media
      if (!this.astraService) return;
      const work = await this.astraService.getFullWork(mediaId);
      if (!work) return;
      
      const seasonIdx = work.seasons.length - 1;
      if (seasonIdx < 0) return;

      await this.saveEpisodeNote(mediaId, seasonIdx, episode, { text: notes });
    });
  }

  /**
   * Get journal notes for a specific season
   */
  public getNotes(work: AstraWork, seasonIdx: number): Record<number, AstraEpisodeNote> {
    return work.seasons[seasonIdx]?.episodeNotes || {};
  }

  /**
   * Save a note for a specific episode
   */
  public async saveEpisodeNote(mediaId: number, seasonIdx: number, episode: number, data: Partial<AstraEpisodeNote>): Promise<void> {
    if (!this.astraService) return;
    const work = await this.astraService.getFullWork(mediaId);
    if (!work || !work.seasons[seasonIdx]) return;

    if (!work.seasons[seasonIdx].episodeNotes) {
      work.seasons[seasonIdx].episodeNotes = {};
    }

    const existing = work.seasons[seasonIdx].episodeNotes![episode] || { text: '' };
    work.seasons[seasonIdx].episodeNotes![episode] = { ...existing, ...data };

    await this.astraService.saveWork(work);
  }

  /**
   * Calculate average score for the journal in a season
   */
  public calcJournalAverage(season: AstraSeason): number | null {
    if (!season.episodeNotes) return null;
    
    const scores = Object.values(season.episodeNotes)
      .map(n => n.score)
      .filter((s): s is number => s !== undefined && s !== null);

    if (scores.length === 0) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  /**
   * Get the best episode of a season
   */
  public getBestEpisode(season: AstraSeason): { episode: number; score: number } | null {
    if (!season.episodeNotes) return null;

    let best: { episode: number; score: number } | null = null;
    
    Object.entries(season.episodeNotes).forEach(([epStr, note]) => {
      const ep = parseInt(epStr, 10);
      if (note.score !== undefined && note.score !== null) {
        if (!best || note.score > best.score) {
          best = { episode: ep, score: note.score };
        }
      }
    });

    return best;
  }
}
