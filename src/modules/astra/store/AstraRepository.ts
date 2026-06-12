/**
 * @file AstraRepository.ts
 * @description Centralized data store and repository for Astra scoring data.
 *
 * Manages persistence (via chrome.storage.local), LRU caching for full work data,
 * and manifest (summaries) indexing.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type {
  AstraWork,
  AstraWorkSummary,
  AstraSection,
  AstraSettings,
  AstraSeason,
} from '../AstraInterfaces';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS, generateUUID } from '../utils/AstraConstants';
import { AstraCalculator } from '../utils/AstraCalculator';

@singleton()
@injectable()
export class AstraRepository {
  private summaries: AstraWorkSummary[] = [];
  private fullWorkCache: Map<number, AstraWork> = new Map();
  private readonly MAX_CACHE_SIZE = 20;

  private sections: AstraSection[] = DEFAULT_SECTIONS;
  private settings: AstraSettings = DEFAULT_SETTINGS;
  private isInitialized = false;

  private readonly MANIFEST_KEY = 'au_astra_manifest';
  private readonly WORK_PREFIX = 'au_astra_work_';
  private readonly SECTIONS_KEY = 'au_astra_sections';
  private readonly SETTINGS_KEY = 'au_astra_settings';

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {}

  /**
   * Initializes the repository by loading manifest and configuration.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    log.info('[AstraRepository] Initializing Atomic Storage...');

    try {
      const [manifest, sections, settings] = await Promise.all([
        this.storage.get<AstraWorkSummary[]>(this.MANIFEST_KEY),
        this.storage.get<AstraSection[]>(this.SECTIONS_KEY),
        this.storage.get<AstraSettings>(this.SETTINGS_KEY),
      ]);

      // Defensive check: handle corrupted object format
      if (manifest && !Array.isArray(manifest)) {
        log.warn('[AstraRepository] Manifest corrupted. Attempting recovery...');
        const anyManifest = manifest as any;
        this.summaries = Array.isArray(anyManifest.summaries) ? anyManifest.summaries : [];
        this.sections = Array.isArray(anyManifest.sections)
          ? anyManifest.sections
          : sections || [...DEFAULT_SECTIONS];
        this.settings = anyManifest.settings
          ? { ...DEFAULT_SETTINGS, ...anyManifest.settings }
          : settings
            ? { ...DEFAULT_SETTINGS, ...settings }
            : DEFAULT_SETTINGS;
      } else {
        this.summaries = manifest || [];
        this.sections = sections || [...DEFAULT_SECTIONS];
        this.settings = settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS;
      }

      this.isInitialized = true;
      log.success(
        `[AstraRepository] Initialization complete. Loaded ${this.summaries.length} summaries.`
      );
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED);
    } catch (error) {
      log.error('[AstraRepository] Initialization failed', error);
      this.summaries = [];
    }
  }

  /**
   * Get all work summaries
   */
  public getWorks(): AstraWorkSummary[] {
    return this.summaries;
  }

  /**
   * Get full work data (Lazy Loaded)
   */
  public async getFullWork(mediaId: number): Promise<AstraWork | undefined> {
    await this.init();

    const cached = this.fullWorkCache.get(mediaId);
    if (cached) return cached;

    const key = `${this.WORK_PREFIX}${mediaId}`;
    const fullWork = await this.storage.get<AstraWork>(key);

    if (fullWork) {
      if (this.fullWorkCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.fullWorkCache.keys().next().value;
        if (firstKey !== undefined) this.fullWorkCache.delete(firstKey);
      }
      this.fullWorkCache.set(mediaId, fullWork);
      return fullWork;
    }

    return undefined;
  }

  /**
   * Saves or updates a work and updates the manifest.
   */
  public async saveWork(
    work: Partial<AstraWork> & { mediaId: number },
    skipPersist = false
  ): Promise<AstraWork> {
    await this.init();

    let fullWork = await this.getFullWork(work.mediaId);

    if (fullWork) {
      fullWork = { ...fullWork, ...work, updatedAt: Date.now() };
    } else {
      fullWork = {
        id: `w_${generateUUID()}`,
        title: 'Unknown',
        type: 'anime',
        status: 'PLANNING',
        tags: [],
        seasons: [this.createDefaultSeason()],
        notes: '',
        updatedAt: Date.now(),
        ...work,
      } as AstraWork;
    }

    await this.storage.set(`${this.WORK_PREFIX}${fullWork.mediaId}`, fullWork);
    this.fullWorkCache.set(fullWork.mediaId, fullWork);

    const summary = this.createSummary(fullWork);
    const existingIdx = this.summaries.findIndex((s) => s.mediaId === fullWork!.mediaId);

    if (existingIdx >= 0) {
      this.summaries[existingIdx] = summary;
    } else {
      this.summaries.unshift(summary);
    }

    // During bulk sync, callers defer the (expensive) manifest write and call
    // persist() once at the end to avoid O(n²) re-serialization of the manifest.
    if (!skipPersist) await this.persist();
    return fullWork;
  }

  /**
   * Deletes a work from storage and manifest.
   */
  public async deleteWork(mediaId: number): Promise<void> {
    await this.init();
    this.summaries = this.summaries.filter((s) => s.mediaId !== mediaId);
    this.fullWorkCache.delete(mediaId);
    await Promise.all([this.storage.remove(`${this.WORK_PREFIX}${mediaId}`), this.persist()]);
  }

  /**
   * Helper to create a summary from a full work
   */
  public createSummary(work: AstraWork): AstraWorkSummary {
    const latestSeason =
      work.seasons && work.seasons.length > 0 ? work.seasons[work.seasons.length - 1] : null;

    const sectionScores: Record<string, number | null> = {};
    if (latestSeason) {
      this.sections.forEach((s) => {
        sectionScores[s.id] = AstraCalculator.calcSectionScore(s, latestSeason.scores);
      });
    }

    return {
      id: work.id,
      mediaId: work.mediaId,
      title: work.title,
      type: work.type,
      cover: work.cover,
      status: work.status,
      progress: work.progress,
      episodes: work.episodes,
      chapters: work.chapters,
      country: work.country,
      updatedAt: work.updatedAt,
      genres: work.genres,
      currentScore: latestSeason
        ? latestSeason.legacyScore ||
          AstraCalculator.calcSeasonScore(latestSeason, this.sections, this.settings)
        : null,
      sectionScores,
    };
  }

  public createDefaultSeason(label = 'Season 1'): AstraSeason {
    const scores: Record<string, number | null> = {};
    this.sections.forEach((s) => (scores[s.id] = null));

    return {
      id: `s_${generateUUID()}`,
      label,
      scores,
      skip: [],
      episodeNotes: {},
    };
  }

  public async persist(): Promise<void> {
    await Promise.all([
      this.storage.set(this.MANIFEST_KEY, this.summaries),
      this.storage.set(this.SECTIONS_KEY, this.sections),
      this.storage.set(this.SETTINGS_KEY, this.settings),
    ]);
    this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
  }

  public getSections(): AstraSection[] {
    // Defensive copy: callers must not mutate the internal array structure.
    // Mutations go through addSection/removeSection/updateSection* methods.
    return [...this.sections];
  }
  public getSettings(): AstraSettings {
    // Defensive copy so callers cannot mutate persisted settings in place.
    return { ...this.settings };
  }

  public async updateSettings(settings: Partial<AstraSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    await this.persist();
  }

  public async updateSections(sections: AstraSection[]): Promise<void> {
    this.sections = sections;
    await this.persist();
  }

  public async addSection(name: string): Promise<void> {
    const id = name.toLowerCase().replace(/\s+/g, '_');
    this.sections.push({ id, name, weight: 1, subSections: [] });
    await this.persist();
  }

  public async removeSection(id: string): Promise<void> {
    this.sections = this.sections.filter((s) => s.id !== id);
    await this.persist();
  }

  public async updateSectionWeight(id: string, weight: number): Promise<void> {
    const section = this.sections.find((s) => s.id === id);
    if (section) {
      section.weight = weight;
      await this.persist();
    }
  }

  public async updateSectionName(id: string, name: string): Promise<void> {
    const section = this.sections.find((s) => s.id === id);
    if (section) {
      section.name = name;
      await this.persist();
    }
  }

  public async addSubSection(sectionId: string, name: string): Promise<void> {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      if (!section.subSections) section.subSections = [];
      const id = name.toLowerCase().replace(/\s+/g, '_');
      section.subSections.push({ id, name, weight: 1 });
      await this.persist();
    }
  }

  public async removeSubSection(sectionId: string, subId: string): Promise<void> {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section && section.subSections) {
      section.subSections = section.subSections.filter((s) => s.id !== subId);
      await this.persist();
    }
  }

  public async updateSubSectionName(sectionId: string, subId: string, name: string): Promise<void> {
    const section = this.sections.find((s) => s.id === sectionId);
    const sub = section?.subSections?.find((s) => s.id === subId);
    if (sub) {
      sub.name = name;
      await this.persist();
    }
  }

  public async updateSubSectionWeight(
    sectionId: string,
    subId: string,
    weight: number
  ): Promise<void> {
    const section = this.sections.find((s) => s.id === sectionId);
    const sub = section?.subSections?.find((s) => s.id === subId);
    if (sub) {
      sub.weight = weight;
      await this.persist();
    }
  }

  public async factoryReset(): Promise<void> {
    this.summaries = [];
    this.sections = [...DEFAULT_SECTIONS];
    this.settings = { ...DEFAULT_SETTINGS };
    this.fullWorkCache.clear();

    // Clear all Astra storage entries directly via chrome.storage.local.
    // Note: keys are stored with StorageManager's prefix, so we match on the
    // raw stored key containing 'au_astra_' (the previous storage.get(null)
    // approach was broken: it threw internally and removed nothing).
    const all = await chrome.storage.local.get(null);
    const astraKeys = Object.keys(all).filter((k) => k.includes('au_astra_'));
    if (astraKeys.length > 0) {
      await chrome.storage.local.remove(astraKeys);
    }

    await this.persist();
  }

  public async exportJSON(): Promise<string> {
    const allData: Record<string, any> = {
      manifest: this.summaries,
      sections: this.sections,
      settings: this.settings,
      works: {},
    };

    for (const summary of this.summaries) {
      const full = await this.getFullWork(summary.mediaId);
      if (full) allData.works[summary.mediaId] = full;
    }

    return JSON.stringify(allData, null, 2);
  }

  public async importJSON(json: string): Promise<boolean> {
    try {
      const data = JSON.parse(json);
      if (!data.manifest || !data.sections || !data.settings) return false;

      this.summaries = data.manifest;
      this.sections = data.sections;
      this.settings = data.settings;

      await this.persist();

      if (data.works) {
        for (const mediaId of Object.keys(data.works)) {
          await this.storage.set(`${this.WORK_PREFIX}${mediaId}`, data.works[mediaId]);
        }
      }

      return true;
    } catch (e) {
      log.error('[AstraRepository] Import failed', e);
      return false;
    }
  }
}
