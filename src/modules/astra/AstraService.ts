/**
 * @file AstraService.ts
 * @description Facade service for the Astra scoring system.
 * 
 * Orchestrates data access, synchronization, and score calculations.
 * Delegating core logic to specialized components:
 * - AstraRepository: Data persistence and manifest management.
 * - AstraSyncService: AniList synchronization.
 * - AstraCalculator: Score calculation logic.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { AstraRepository } from './store/AstraRepository';
import { AstraSyncService } from './services/AstraSyncService';
import { AstraCalculator } from './utils/AstraCalculator';

import { 
  AstraWork, 
  AstraWorkSummary, 
  AstraSection, 
  AstraSettings, 
  AstraSeason 
} from './AstraInterfaces';

@singleton()
@injectable()
export class AstraService {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(AstraSyncService) private syncService: AstraSyncService
  ) {}

  public async init(): Promise<void> {
    return this.repository.init();
  }

  /**
   * Get all work summaries.
   */
  public getWorks(): AstraWorkSummary[] {
    return this.repository.getWorks();
  }

  /**
   * Get full work data (Lazy Loaded).
   */
  public async getFullWork(mediaId: number): Promise<AstraWork | undefined> {
    return this.repository.getFullWork(mediaId);
  }

  /**
   * Save or update a work.
   */
  public async saveWork(work: Partial<AstraWork> & { mediaId: number }, skipAnilist: boolean = false): Promise<AstraWork> {
    const saved = await this.repository.saveWork(work);
    // Auto-sync with AniList notes (background)
    if (!skipAnilist) {
      this.syncToAnilistNotes(saved.mediaId, saved);
    }
    return saved;
  }

  /**
   * Sync all works with AniList.
   */
  public async syncWithAniList(): Promise<{ added: number; updated: number }> {
    return this.syncService.syncWithAniList();
  }

  /**
   * Increments progress for a media entry and notifies the system.
   */
  public async incrementProgress(mediaId: number): Promise<{ mediaId: number; progress: number; title: string } | null> {
    try {
      const userId = await this.api.getCurrentUserId();
      if (!userId) throw new Error('Not logged in');

      const data = await this.api.query<any>(`
        query ($mediaId: Int, $userId: Int) {
          MediaList(mediaId: $mediaId, userId: $userId) {
            id progress status media { id title { romaji } }
          }
        }
      `, { mediaId, userId });

      if (!data?.MediaList) throw new Error('Entry not found');

      const entry = data.MediaList;
      const newProgress = (entry.progress || 0) + 1;

      await this.api.mutate(`
        mutation ($id: Int, $progress: Int) {
          SaveMediaListEntry(id: $id, progress: $progress) { id progress }
        }
      `, { id: entry.id, progress: newProgress });
      
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId: entry.media.id,
        progress: newProgress,
        previousProgress: entry.progress,
        userId,
        status: entry.status
      });

      return { 
        mediaId: entry.media.id, 
        progress: newProgress, 
        title: entry.media.title.romaji 
      };
    } catch (err) {
      log.error('[AstraService] Failed to increment progress', err);
      throw err;
    }
  }

  /**
   * Synchronize Astra data into AniList notes for persistence across devices.
   */
  private async syncToAnilistNotes(mediaId: number, work: AstraWork): Promise<void> {
    const settings = this.getSettings();
    if (!this.api.isAuthenticated() || !settings.appendAstraToComment) return;

    try {
      const sections = this.repository.getSections();
      
      // We need to fetch the current list entry ID first
      const userId = await this.api.getCurrentUserId();
      const data = await this.api.query<any>(`
        query($mediaId: Int, $userId: Int) {
          MediaList(mediaId: $mediaId, userId: $userId) { id notes }
        }
      `, { mediaId, userId });

      if (!data?.MediaList) return;

      const currentNotes = data.MediaList.notes || '';
      const { AstraParser } = await import('./utils/AstraParser');
      const updatedNotes = AstraParser.inject(currentNotes, work, sections);

      if (updatedNotes !== currentNotes) {
        await this.api.mutate(`
          mutation($id: Int, $notes: String) {
            SaveMediaListEntry(id: $id, notes: $notes) { id notes }
          }
        `, { id: data.MediaList.id, notes: updatedNotes });
        log.debug(`[AstraService] Synced notes for media ${mediaId} to AniList`);
      }
    } catch (e) {
      log.error(`[AstraService] Failed to sync notes to AniList for media ${mediaId}`, e);
    }
  }

  public hasFinaleSection(): boolean {
    return this.repository.getSections().some(s => s.id === 'finale' || s.name.toLowerCase().trim() === 'finale');
  }

  // Delegated utility methods
  public getSections(): AstraSection[] { return this.repository.getSections(); }
  public getSettings(): AstraSettings { return this.repository.getSettings(); }
  public updateSettings(settings: Partial<AstraSettings>): Promise<void> { return this.repository.updateSettings(settings); }
  public deleteWork(mediaId: number): Promise<void> { return this.repository.deleteWork(mediaId); }
  public createDefaultSeason(label?: string): AstraSeason { return this.repository.createDefaultSeason(label); }
  
  public updateSectionWeight(id: string, weight: number): Promise<void> { return this.repository.updateSectionWeight(id, weight); }
  public updateSectionName(id: string, name: string): Promise<void> { return this.repository.updateSectionName(id, name); }
  public addSection(name: string): Promise<void> { return this.repository.addSection(name); }
  public removeSection(id: string): Promise<void> { return this.repository.removeSection(id); }
  public updateSubSectionName(sectionId: string, subId: string, name: string): Promise<void> { return this.repository.updateSubSectionName(sectionId, subId, name); }
  public addSubSection(sectionId: string, name: string): Promise<void> { return this.repository.addSubSection(sectionId, name); }
  public removeSubSection(sectionId: string, subId: string): Promise<void> { return this.repository.removeSubSection(sectionId, subId); }
  public updateSubSectionWeight(sectionId: string, subId: string, weight: number): Promise<void> { return this.repository.updateSubSectionWeight(sectionId, subId, weight); }
  public exportJSON(): Promise<string> { return this.repository.exportJSON(); }
  public importJSON(json: string): Promise<boolean> { return this.repository.importJSON(json); }
  public factoryReset(): Promise<void> { return this.repository.factoryReset(); }

  public calcSectionScore(section: AstraSection, scores: Record<string, number | null>): number | null {
    return AstraCalculator.calcSectionScore(section, scores);
  }
  public calcSeasonScore(season: AstraSeason): number | null {
    return AstraCalculator.calcSeasonScore(season, this.repository.getSections(), this.repository.getSettings());
  }
  public calcSeriesOverall(work: AstraWork): number | null {
    return AstraCalculator.calcSeriesOverall(work, this.repository.getSections(), this.repository.getSettings());
  }

  /**
   * Consolidates raw scores into section-level scores based on current configuration.
   */
  public consolidateScores(rawScores: Record<string, number | null>): Record<string, number | null> {
    const sections = this.getSections();
    const consolidated: Record<string, number | null> = {};
    sections.forEach(s => {
      consolidated[s.id] = this.calcSectionScore(s, rawScores);
    });
    return consolidated;
  }
}
