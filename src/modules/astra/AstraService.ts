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
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { AstraRepository } from './store/AstraRepository';
import { AstraSyncService } from './services/AstraSyncService';
import { AstraSyncManager } from './services/AstraSyncManager';
import type { IAstraRatingService } from './interfaces/IAstraRatingService';
import { AstraCalculator } from './utils/AstraCalculator';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import type { SeasonalChoices } from './services/SeasonalWrappedModel';

import {
  AstraWork,
  AstraWorkSummary,
  AstraSection,
  AstraSettings,
  AstraSeason,
} from './AstraInterfaces';

@singleton()
@injectable()
export class AstraService {
  private disposed = false;
  private unsubscribeAuth: (() => void) | null = null;
  private customListsCache: { context: ApiContext | undefined; names: string[] } | null = null;
  private customListsEpoch = 0;

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(AstraSyncService) private syncService: AstraSyncService,
    @inject(TOKENS.AstraSyncManager) private syncManager: AstraSyncManager,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService
  ) {
    this.unsubscribeAuth = this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      if (this.disposed) return;
      this.customListsEpoch++; this.customListsCache = null;
    }).unsubscribe;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeAuth?.(); this.unsubscribeAuth = null;
    this.customListsEpoch++; this.customListsCache = null;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Astra service disposed');
  }

  public async init(): Promise<void> {
    this.assertActive();
    await this.repository.init();
    this.assertActive();
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
    this.assertActive();
    const work = await this.repository.getFullWork(mediaId);
    this.assertActive();
    return work;
  }

  /**
   * Save or update a work.
   */
  public async saveWork(
    work: Partial<AstraWork> & { mediaId: number },
    skipAnilist: boolean = false
  ): Promise<AstraWork> {
    this.assertActive();
    const saved = await this.repository.saveWork(work);
    this.assertActive();
    // Auto-sync with AniList notes (background)
    if (!skipAnilist) {
      void this.syncToAnilistNotes(saved.mediaId, saved).catch(error => {
        if (!this.disposed) logger.error('[AstraService] Background notes sync failed; local data is preserved', error);
      });
    }
    return saved;
  }

  /**
   * Sync all works with AniList.
   */
  public async syncWithAniList(): Promise<{ added: number; updated: number }> {
    this.assertActive();
    const result = await this.syncService.syncWithAniList();
    this.assertActive();
    this.customListsEpoch++;
    this.customListsCache = null;
    return result;
  }

  public async getAniListCustomLists(): Promise<string[]> {
    this.assertActive();
    const epoch = this.customListsEpoch;
    const context = await captureApiContext(this.api);
    this.assertActive();
    assertApiContext(this.api, context);
    if (epoch !== this.customListsEpoch) throw new Error('Astra account changed');
    const cache = this.customListsCache;
    if (cache && cache.context?.sessionId === context?.sessionId && cache.context?.userId === context?.userId) return [...cache.names];

    const query = `
      query AstraCustomLists {
        Viewer {
          mediaListOptions {
            animeList { customLists }
            mangaList { customLists }
          }
        }
      }
    `;

    const response = await this.api.query<{
      Viewer?: {
        mediaListOptions?: {
          animeList?: { customLists?: string[] };
          mangaList?: { customLists?: string[] };
        };
      };
    }>(query, {}, true);
    this.assertActive();
    assertApiContext(this.api, context);
    if (epoch !== this.customListsEpoch) throw new Error('Astra account changed');

    const listNames = new Set<string>();
    response.Viewer?.mediaListOptions?.animeList?.customLists?.forEach((name) => listNames.add(name));
    response.Viewer?.mediaListOptions?.mangaList?.customLists?.forEach((name) => listNames.add(name));
    const names = Array.from(listNames).sort((a, b) => a.localeCompare(b));
    this.customListsCache = { context: context ? { ...context } : undefined, names };
    return [...names];
  }

  /**
   * Increments progress for a media entry and notifies the system.
   */
  public async incrementProgress(
    mediaId: number
  ): Promise<{ mediaId: number; progress: number; title: string } | null> {
    this.assertActive();
    try {
      const result = await this.ratingService.updateProgress(mediaId);
      this.assertActive();

      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId: result.mediaId,
        progress: result.progress,
        previousProgress: result.previousProgress,
        userId: result.userId,
        status: result.status,
      });

      return result;
    } catch (err) {
      if (!this.disposed) logger.error('[AstraService] Failed to increment progress', err);
      throw err;
    }
  }

  /**
   * Synchronize Astra data into AniList notes for persistence across devices.
   */
  private async syncToAnilistNotes(mediaId: number, work: AstraWork): Promise<void> {
    this.assertActive();
    const settings = this.getSettings();
    if (!this.api.isAuthenticated() || !settings.appendAstraToComment) return;
    await this.syncManager.push(mediaId, work);
  }

  public hasFinaleSection(): boolean {
    return this.repository
      .getSections()
      .some((s) => s.id === 'finale' || s.name.toLowerCase().trim() === 'finale');
  }

  // Delegated utility methods
  public getSections(): AstraSection[] {
    return this.repository.getSections();
  }
  public getSettings(): AstraSettings {
    return this.repository.getSettings();
  }
  public async updateSettings(settings: Partial<AstraSettings>): Promise<void> {
    this.assertActive();
    return this.repository.updateSettings(settings);
  }
  public async deleteWork(mediaId: number): Promise<void> {
    this.assertActive();
    return this.repository.deleteWork(mediaId);
  }
  public createDefaultSeason(label?: string): AstraSeason {
    return this.repository.createDefaultSeason(label);
  }

  public async updateSectionWeight(id: string, weight: number): Promise<void> {
    this.assertActive();
    return this.repository.updateSectionWeight(id, weight);
  }
  public async updateSectionName(id: string, name: string): Promise<void> {
    this.assertActive();
    return this.repository.updateSectionName(id, name);
  }
  public async addSection(name: string): Promise<void> {
    this.assertActive();
    return this.repository.addSection(name);
  }
  public async removeSection(id: string): Promise<void> {
    this.assertActive();
    return this.repository.removeSection(id);
  }
  public async updateSubSectionName(sectionId: string, subId: string, name: string): Promise<void> {
    this.assertActive();
    return this.repository.updateSubSectionName(sectionId, subId, name);
  }
  public async addSubSection(sectionId: string, name: string): Promise<void> {
    this.assertActive();
    return this.repository.addSubSection(sectionId, name);
  }
  public async removeSubSection(sectionId: string, subId: string): Promise<void> {
    this.assertActive();
    return this.repository.removeSubSection(sectionId, subId);
  }
  public async updateSubSectionWeight(sectionId: string, subId: string, weight: number): Promise<void> {
    this.assertActive();
    return this.repository.updateSubSectionWeight(sectionId, subId, weight);
  }
  public async exportJSON(): Promise<string> {
    this.assertActive();
    return this.repository.exportJSON();
  }
  public async saveSeasonalChoices(key: string, choices: SeasonalChoices): Promise<SeasonalChoices> {
    this.assertActive();
    const saved = await this.repository.saveSeasonalChoices(key, choices);
    this.assertActive();
    return saved;
  }
  public async importJSON(json: string): Promise<boolean> {
    this.assertActive();
    return this.repository.importJSON(json);
  }
  public async factoryReset(): Promise<void> {
    this.assertActive();
    await this.repository.factoryReset();
    this.assertActive();
    this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
  }

  public calcSectionScore(
    section: AstraSection,
    scores: Record<string, number | null>
  ): number | null {
    return AstraCalculator.calcSectionScore(section, scores);
  }
  public calcSeasonScore(season: AstraSeason): number | null {
    return AstraCalculator.calcSeasonScore(
      season,
      this.repository.getSections(),
      this.repository.getSettings()
    );
  }
  public calcSeriesOverall(work: AstraWork): number | null {
    return AstraCalculator.calcSeriesOverall(
      work,
      this.repository.getSections(),
      this.repository.getSettings()
    );
  }

  /**
   * Consolidates raw scores into section-level scores based on current configuration.
   */
  public consolidateScores(
    rawScores: Record<string, number | null>
  ): Record<string, number | null> {
    const sections = this.getSections();
    const consolidated: Record<string, number | null> = {};
    sections.forEach((s) => {
      consolidated[s.id] = this.calcSectionScore(s, rawScores);
    });
    return consolidated;
  }
}
