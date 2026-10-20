/**
 * @file AstraJournalService.ts
 * @description Logic for managing episode-specific notes and scores
 */

import { injectable, singleton, inject, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService } from '../AstraService';
import type { AstraWork, AstraSeason, AstraEpisodeNote } from '../AstraInterfaces';
import { EVENT_TYPES, type ProgressUpdatedEvent } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { stampAstraProgress } from '../utils/AstraProgressHistory';

@injectable()
@singleton()
export class AstraJournalService implements Disposable {
  private workUpdates = new Map<number, Promise<void>>();
  private disposed = false;
  private unsubscribers: Array<() => void> = [];

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    this.setupEventListeners();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.workUpdates.clear();
  }

  private assertActive(): void { if (this.disposed) throw new Error('Astra journal service disposed'); }

  private setupEventListeners(): void {
    // One shared path for the calendar pill, Quick Edit, and manga progress.
    // `previousProgress` lets us timestamp only newly completed units.
    this.unsubscribers.push(this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, async data => {
      if (this.disposed) return;
      try { await this.recordProgress(data); } catch (error) { if (!this.disposed) throw error; }
    }).unsubscribe);
    this.unsubscribers.push(this.eventBus.on(EVENT_TYPES.ASTRA_SAVE_NOTE, async (data) => {
      if (this.disposed || !data) return;
      try {
      const { mediaId, episode, notes } = data;
      // Find the current season for this media
      if (!this.astraService) return;
      const work = await this.astraService.getFullWork(mediaId);
      if (this.disposed || !work) return;
      if (data.ownerId !== undefined && data.ownerId !== work.ownerId) return;
      
      const seasonIdx = work.seasons.length - 1;
      if (seasonIdx < 0) return;

      await this.saveEpisodeNote(mediaId, seasonIdx, episode, { text: notes }, work.ownerId);
      } catch (error) { if (!this.disposed) throw error; }
    }).unsubscribe);
  }

  private async withWorkLock(mediaId: number, update: () => Promise<void>): Promise<void> {
    this.assertActive();
    const previous = this.workUpdates.get(mediaId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      this.assertActive();
      await update();
      this.assertActive();
    });
    this.workUpdates.set(mediaId, pending);
    try {
      await pending;
    } finally {
      if (this.workUpdates.get(mediaId) === pending) this.workUpdates.delete(mediaId);
    }
  }

  private async recordProgress(data?: ProgressUpdatedEvent): Promise<void> {
    if (!data || !Number.isSafeInteger(data.mediaId) || data.mediaId <= 0 ||
      !Number.isSafeInteger(data.progress) || !Number.isSafeInteger(data.previousProgress) ||
      data.previousProgress < 0 || data.progress < 0 || data.progress === data.previousProgress) return;
    const timestamp = Date.now();
    await this.withWorkLock(data.mediaId, async () => {
      const work = await this.astraService.getFullWork(data.mediaId);
      this.assertActive();
      if (!work) return;
      if (work.ownerId !== undefined && work.ownerId !== data.userId) return;
      let changed = work.progress !== data.progress;
      work.progress = data.progress;
      changed = stampAstraProgress(work, data.previousProgress, data.progress, timestamp) || changed;
      // The calendar emits duplicate progress events; do not write or sync twice.
      if (changed) await this.astraService.saveWork(work, true);
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
  public async saveEpisodeNote(mediaId: number, seasonIdx: number, episode: number, data: Partial<AstraEpisodeNote>, ownerId?: number | null): Promise<void> {
    this.assertActive();
    if (!Number.isSafeInteger(episode) || episode <= 0) return;
    await this.withWorkLock(mediaId, async () => {
      const work = await this.astraService.getFullWork(mediaId);
      this.assertActive();
      if (!work || !work.seasons[seasonIdx]) return;
      if (ownerId !== undefined && ownerId !== work.ownerId) return;

      if (!work.seasons[seasonIdx].episodeNotes) {
        work.seasons[seasonIdx].episodeNotes = {};
      }

      const existing = work.seasons[seasonIdx].episodeNotes![episode] || { text: '' };
      work.seasons[seasonIdx].episodeNotes![episode] = { ...existing, ...data };

      await this.astraService.saveWork(work);
    });
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
