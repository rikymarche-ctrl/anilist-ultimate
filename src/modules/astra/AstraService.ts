/**
 * @file AstraService.ts
 * @description Advanced multi-criteria scoring system data service
 *
 * Manages the Astra scoring data including:
 *   - Works (anime/manga entries with per-season scores)
 *   - Scoring sections with customizable weights
 *   - Score calculation (section, season, series averages)
 *   - AniList sync (import entire anime/manga list)
 *   - Export/Import as JSON
 *
 * Storage: chrome.storage.local under key 'au_astra_data'
 * Performance: O(1) lookup by mediaId via Map index
 *
 * Score Calculation:
 *   Section = weighted avg of sub-sections (or direct score)
 *   Season = weighted avg of non-skipped sections
 *   Series = simple avg of all season scores
 *   Finale section gets 2x weight when marked as series finale
 *
 * @warning importJSON() has no schema validation.
 *          See docs/SECURITY.md#sec-007 for details.
 *
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 */
import { injectable, singleton, inject } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { MediaListStatus, type MediaListCollectionResponse } from '@/api/AnilistTypes';
import { AstraParser } from './utils/AstraParser';

export interface AstraWorkSummary {
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga' | 'novel';
  cover?: string;
  status: MediaListStatus;
  progress?: number;
  episodes?: number;
  chapters?: number;
  country?: string;
  updatedAt: number;
  currentScore: number | null;
  sectionScores?: Record<string, number | null>;
  genres?: string[];
}

export interface AstraWork {
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga' | 'novel';
  country?: string; // JP, CN, KR, etc.
  cover?: string;
  coverColor?: string;
  anilistUrl?: string;
  status: MediaListStatus;
  customLists: string[];
  tags: string[];
  seasons: AstraSeason[];
  notes: string;
  updatedAt: number;
  genres?: string[];
  episodes?: number;
  chapters?: number;
  progress?: number;
  duration?: number;
}

export interface AstraEpisodeNote {
  text: string;
  score?: number;
}

export interface AstraSeason {
  id: string;
  label: string;
  scores: Record<string, number | null>;
  skip?: string[];
  startDate?: string;
  endDate?: string;
  notes?: string;
  isSeriesFinale?: boolean;
  episodeNotes?: Record<number, AstraEpisodeNote>;
  legacyScore?: number; // Score from AniList or manual override
  manualOverride?: boolean; // If true, ignore sections and use legacyScore directly
}

export interface AstraSubSection {
  id: string;
  name: string;
  weight: number;
}

export interface AstraSection {
  id: string;
  name: string;
  weight: number;
  subSections?: AstraSubSection[];
}

export const DEFAULT_SECTIONS: AstraSection[] = [
  { id: 'story', name: 'Story', weight: 3, subSections: [] },
  { id: 'characters', name: 'Characters', weight: 2.5, subSections: [] },
  { id: 'visuals', name: 'Visuals', weight: 1.5, subSections: [] },
  {
    id: 'sound',
    name: 'Sound',
    weight: 1,
    subSections: [
      { id: 'intro', name: 'Intro', weight: 1 },
      { id: 'outro', name: 'Outro', weight: 1 },
      { id: 'all', name: 'All', weight: 10 }
    ]
  },
  { id: 'enjoyment', name: 'Enjoyment', weight: 1.75, subSections: [] },
  { id: 'consistency', name: 'Consistency', weight: 0.75, subSections: [] },
  { id: 'finale', name: 'Finale', weight: 0.5, subSections: [] },
];

export interface AstraSettings {
  enableSeriesFinale: boolean;
  finaleWeightMultiplier: number;
}

export const DEFAULT_SETTINGS: AstraSettings = {
  enableSeriesFinale: true,
  finaleWeightMultiplier: 3,
};

/**
 * Generate a cryptographically random UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: Manual UUID v4 implementation using crypto.getRandomValues for better entropy
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

@singleton()
@injectable()
export class AstraService {
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
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) { }

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
   * Initializes the service by loading the manifest and configuration.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    log.info('[AstraService] Initializing Atomic Storage...');

    try {
      const [manifest, sections, settings] = await Promise.all([
        this.storage.get<AstraWorkSummary[]>(this.MANIFEST_KEY),
        this.storage.get<AstraSection[]>(this.SECTIONS_KEY),
        this.storage.get<AstraSettings>(this.SETTINGS_KEY)
      ]);

      // Defensive check: handle corrupted object format from previous failed build
      if (manifest && !Array.isArray(manifest)) {
        log.warn('[AstraService] Manifest corrupted (object found instead of array). Attempting recovery...');
        const anyManifest = manifest as any;
        this.summaries = Array.isArray(anyManifest.summaries) ? anyManifest.summaries : [];
        this.sections = Array.isArray(anyManifest.sections) ? anyManifest.sections : (sections || [...DEFAULT_SECTIONS]);
        this.settings = anyManifest.settings ? { ...DEFAULT_SETTINGS, ...anyManifest.settings } : (settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS);
      } else {
        this.summaries = manifest || [];
        this.sections = sections || [...DEFAULT_SECTIONS];
        this.settings = settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS;
      }

      this.isInitialized = true;
      log.success(`[AstraService] Initialization complete. Loaded ${this.summaries.length} summaries.`);
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED);
    } catch (error) {
      log.error('[AstraService] Initialization failed', error);
      this.summaries = [];
    }
  }

  /**
   * Helper to create a summary from a full work
   */
  private createSummary(work: AstraWork): AstraWorkSummary {
    const latestSeason = work.seasons && work.seasons.length > 0 
      ? work.seasons[work.seasons.length - 1] 
      : null;

    const sectionScores: Record<string, number | null> = {};
    if (latestSeason) {
      this.sections.forEach(s => {
        sectionScores[s.id] = this.calcSectionScore(s, latestSeason.scores);
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
      currentScore: latestSeason ? (latestSeason.legacyScore || this.calcSeasonScore(latestSeason)) : null,
      sectionScores
    };
  }

  /**
   * Get all work summaries (for the dashboard)
   */
  getWorks(): AstraWorkSummary[] {
    return this.summaries;
  }

  /**
   * Get full work data (Lazy Loaded)
   */
  async getFullWork(mediaId: number): Promise<AstraWork | undefined> {
    await this.init();

    // 1. Check LRU Cache
    const cached = this.fullWorkCache.get(mediaId);
    if (cached) return cached;

    // 2. Load from storage
    log.debug(`[AstraService] Lazy loading full work for media ${mediaId}...`);
    const key = `${this.WORK_PREFIX}${mediaId}`;
    const fullWork = await this.storage.get<AstraWork>(key);
    
    if (fullWork) {
      // Manage LRU cache
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
   * For backward compatibility, but now uses summaries.
   */
  getWorkByMediaId(mediaId: number): AstraWorkSummary | undefined {
    return this.summaries.find(s => s.mediaId === mediaId);
  }

  /**
   * Check if a "Finale" section exists (by ID or name)
   */
  public hasFinaleSection(): boolean {
    return this.sections.some(s => s.id === 'finale' || s.name.toLowerCase().trim() === 'finale');
  }

  /**
   * Get all sections
   */
  getSections(): AstraSection[] {
    return this.sections;
  }

  getSettings(): AstraSettings {
    return this.settings;
  }

  async updateSettings(settings: Partial<AstraSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    await this.persist();
  }

  /**
   * Sync all user works from AniList
   */
  async syncWithAniList(apiClient: IApiClient): Promise<{ added: number; updated: number }> {
    await this.init();

    try {
      const viewer = await apiClient.getCurrentUser();
      const userId = viewer.id;

      const query = `
        query ($userId: Int, $type: MediaType) {
          MediaListCollection(userId: $userId, type: $type) {
            lists {
              entries {
                mediaId
                status
                score(format: POINT_10)
                progress
                notes
                customLists
                private
                hiddenFromStatusLists
                media {
                  title { romaji english native }
                  type
                  format
                  countryOfOrigin
                  coverImage { extraLarge large medium }
                  siteUrl
                  genres
                  episodes
                  chapters
                  duration
                }
              }
            }
          }
        }
      `;

      const [animeRes, mangaRes] = await Promise.all([
        apiClient.query<MediaListCollectionResponse>(query, { userId, type: 'ANIME' }),
        apiClient.query<MediaListCollectionResponse>(query, { userId, type: 'MANGA' })
      ]);

      let addedCount = 0;
      let updatedCount = 0;

      const processResult = async (result: MediaListCollectionResponse) => {
        const collection = result?.MediaListCollection;
        if (!collection?.lists) return;

        for (const list of collection.lists) {
          for (const entry of list.entries) {
            const existingSummary = this.getWorkByMediaId(entry.mediaId);

            if (existingSummary) {
              // Load full work to check if sync needed
              const full = await this.getFullWork(entry.mediaId);
              if (!full) continue;

              const newTitle = entry.media.title.english || entry.media.title.romaji || entry.media.title.native || 'Unknown Title';
              let changed = false;

              if (full.status !== entry.status || full.title !== newTitle) {
                full.title = newTitle;
                full.status = entry.status;
                changed = true;
              }

              // Sync metadata
              full.customLists = [];
              if (entry.customLists) {
                const cl = entry.customLists as Record<string, boolean>;
                full.customLists = Object.keys(cl).filter(k => cl[k]);
              }
              if (entry.private) full.customLists.push('Private');
              if (entry.hiddenFromStatusLists) full.customLists.push('Hide from status lists');

              full.genres = entry.media.genres || [];
              full.episodes = entry.media.episodes ?? undefined;
              full.chapters = entry.media.chapters ?? undefined;
              full.progress = entry.progress;
              full.duration = entry.media.duration ?? undefined;
              full.notes = entry.notes || '';

              // Parse notes for Astra data
              if (entry.notes) {
                const parsed = AstraParser.parse(entry.notes, this.sections);
                if (parsed && AstraParser.merge(full, parsed)) {
                  changed = true;
                }
              }

              if (changed) {
                full.updatedAt = Date.now();
                await this.storage.set(`${this.WORK_PREFIX}${full.mediaId}`, full);
                // Update summary in manifest
                const idx = this.summaries.findIndex(s => s.mediaId === full.mediaId);
                if (idx >= 0) this.summaries[idx] = this.createSummary(full);
                updatedCount++;
              }
            } else {
              // NEW WORK
              const media = entry.media;
              const type = media.type === 'ANIME' ? 'anime' : (media.format === 'NOVEL' ? 'novel' : 'manga');

              let customLists: string[] = [];
              if (entry.customLists) {
                const cl = entry.customLists as Record<string, boolean>;
                customLists = Object.keys(cl).filter(k => cl[k]);
              }
              if (entry.private) customLists.push('Private');
              if (entry.hiddenFromStatusLists) customLists.push('Hide from status lists');

              const newWork: AstraWork = {
                id: `w_${generateUUID()}`,
                mediaId: entry.mediaId,
                title: media.title.english || media.title.romaji || media.title.native || 'Unknown Title',
                type: type as any,
                country: media.countryOfOrigin,
                cover: media.coverImage.extraLarge || media.coverImage.large || media.coverImage.medium || undefined,
                status: entry.status,
                customLists,
                tags: [],
                seasons: [this.createDefaultSeason()],
                notes: entry.notes || '',
                updatedAt: Date.now(),
                genres: media.genres || [],
                episodes: media.episodes ?? undefined,
                chapters: media.chapters ?? undefined,
                progress: entry.progress,
                duration: media.duration ?? undefined
              };

              if (entry.notes) {
                const parsed = AstraParser.parse(entry.notes, this.sections);
                if (parsed) AstraParser.merge(newWork, parsed);
              }

              if (entry.score > 0) {
                const normalized = entry.score > 10 ? entry.score / 10 : entry.score;
                newWork.seasons[0].legacyScore = normalized;
              }

              await this.storage.set(`${this.WORK_PREFIX}${newWork.mediaId}`, newWork);
              this.summaries.push(this.createSummary(newWork));
              addedCount++;
            }
          }
        }
      };

      await processResult(animeRes);
      await processResult(mangaRes);

      // Persist the manifest (summaries list)
      this.summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      await this.persist();

      log.info(`[AstraService] Sync complete: +${addedCount} added, ~${updatedCount} updated`);
      return { added: addedCount, updated: updatedCount };
    } catch (error) {
      log.error('[AstraService] Sync failed', error);
      throw error;
    }
  }

  /**
   * Save or update a full work
   */
  async saveWork(work: Partial<AstraWork> & { mediaId: number }): Promise<AstraWork> {
    await this.init();

    let fullWork = await this.getFullWork(work.mediaId);
    
    if (fullWork) {
      fullWork = { ...fullWork, ...work, updatedAt: Date.now() };
    } else {
      fullWork = {
        id: `w_${generateUUID()}`,
        title: 'Unknown',
        type: 'anime',
        status: MediaListStatus.PLANNING,
        tags: [],
        seasons: [this.createDefaultSeason()],
        notes: '',
        updatedAt: Date.now(),
        ...work
      } as AstraWork;
    }

    // 1. Atomic Save: Save the full details
    await this.storage.set(`${this.WORK_PREFIX}${fullWork.mediaId}`, fullWork);
    this.fullWorkCache.set(fullWork.mediaId, fullWork);

    // 2. Update summary in manifest
    const existingIdx = this.summaries.findIndex(s => s.mediaId === fullWork!.mediaId);
    const summary = this.createSummary(fullWork);

    if (existingIdx >= 0) {
      this.summaries[existingIdx] = summary;
    } else {
      this.summaries.unshift(summary);
    }

    // 3. Persist manifest
    await this.persist();

    // Auto-sync with AniList notes (background)
    this.syncToAnilistNotes(fullWork.mediaId, fullWork);

    return fullWork;
  }

  /**
   * Internal persist of manifest (summaries, settings, sections)
   */
  private async persist(): Promise<void> {
    try {
      await Promise.all([
        this.storage.set(this.MANIFEST_KEY, this.summaries),
        this.storage.set(this.SECTIONS_KEY, this.sections),
        this.storage.set(this.SETTINGS_KEY, this.settings)
      ]);

      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, {
        timestamp: new Date()
      });
    } catch (error) {
      log.error('[AstraService] Persist manifest failed', error);
    }
  }

  /**
   * Delete a work and its atomic storage
   */
  async deleteWork(mediaId: number): Promise<void> {
    await this.init();
    this.summaries = this.summaries.filter(s => s.mediaId !== mediaId);
    this.fullWorkCache.delete(mediaId);
    
    // Remove both from manifest and individual storage
    await Promise.all([
      this.storage.remove(`${this.WORK_PREFIX}${mediaId}`),
      this.persist()
    ]);
    
    log.info(`[AstraService] Deleted work ${mediaId}`);
  }

  /**
   * Delete ALL works (Reset)
   */
  async clearAllWorks(): Promise<void> {
    await this.init();
    const keysToRemove = this.summaries.map(s => `${this.WORK_PREFIX}${s.mediaId}`);
    
    this.summaries = [];
    this.fullWorkCache.clear();
    
    await Promise.all([
      ...keysToRemove.map(key => this.storage.remove(key)),
      this.persist()
    ]);
    
    log.info('[AstraService] All Astra data cleared');
  }

  /**
   * Update sections and weights
   */
  async updateSections(sections: AstraSection[]): Promise<void> {
    this.sections = sections;
    await this.persist();
  }

  /**
   * Calculate score for a single section (possibly from sub-sections)
   */
  calcSectionScore(section: AstraSection, scores: Record<string, number | null>): number | null {
    if (!section.subSections || section.subSections.length === 0) {
      return scores[section.id] || null;
    }

    let num = 0, den = 0;
    for (const sub of section.subSections) {
      const v = scores[`${section.id}_${sub.id}`];
      if (v !== null && v !== undefined && v > 0) {
        num += v * sub.weight;
        den += sub.weight;
      }
    }

    if (den === 0) return null;
    return num / den;
  }

  /**
   * Calculate overall score for a season object
   */
  calcSeasonScore(season: AstraSeason): number | null {
    return this.calcSeasonOverall(season.scores, season.skip, season.isSeriesFinale, season.legacyScore, season.manualOverride);
  }

  /**
   * Calculate overall score for raw data
   */
  calcSeasonOverall(scores: Record<string, number | null>, skip?: string[], isSeriesFinale?: boolean, legacyScore?: number, manualOverride?: boolean): number | null {
    if (manualOverride && legacyScore !== undefined && legacyScore > 0) {
      return legacyScore;
    }

    const skipSet = new Set(skip || []);
    let num = 0, den = 0;

    for (const s of this.sections) {
      if (skipSet.has(s.id)) continue;

      const v = this.calcSectionScore(s, scores);
      if (v === null || v === undefined || v === 0) continue;

      let weight = s.weight;
      const isFinale = s.id === 'finale' || s.name.toLowerCase().trim() === 'finale';
      if (isFinale && isSeriesFinale && this.settings.enableSeriesFinale) {
        weight *= (this.settings.finaleWeightMultiplier || 2);
      }

      num += v * weight;
      den += weight;
    }

    if (den === 0) return (legacyScore && legacyScore > 0) ? legacyScore : null;
    return Math.round((num / den) * 10) / 10;
  }

  /**
   * Calculate series average score
   */
  calcSeriesOverall(work: AstraWork): number | null {
    const subs = work.seasons
      .map(s => this.calcSeasonOverall(s.scores, s.skip))
      .filter((v): v is number => v !== null);

    if (!subs.length) return null;
    return Math.round((subs.reduce((a, b) => a + b, 0) / subs.length) * 10) / 10;
  }

  /**
   * Create a blank season
   */
  createDefaultSeason(label = 'Season 1'): AstraSeason {
    const scores: Record<string, number | null> = {};
    this.sections.forEach(s => scores[s.id] = null);

    return {
      id: `s_${generateUUID()}`,
      label,
      scores,
      skip: [],
      episodeNotes: {}
    };
  }

  /**
   * Generates a comprehensive Markdown report of the Astra review
   */
  public generateMarkdownReport(work: AstraWork): string {
    const overall = this.calcSeriesOverall(work);
    const season = work.seasons[work.seasons.length - 1]; // Use latest season for breakdown

    const formatScore = (val: number | null) => {
      if (val === null) return 'N/A';
      return val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
    };

    let report = `─── Astra Review ───\n`;
    report += `Overall Score: ${formatScore(overall)}/10\n\n`;

    // 1. Sub-categories Breakdown
    report += `Breakdown:\n`;
    this.sections.forEach(s => {
      if (season.skip?.includes(s.id)) return;
      const score = this.calcSectionScore(s, season.scores);
      if (score && score > 0) {
        report += `• ${s.name}: ${formatScore(score)}/10\n`;

        // Include sub-sections detail with tree-like structure
        if (s.subSections && s.subSections.length > 0) {
          const activeSubs = s.subSections.filter(sub => {
            const val = season.scores[`${s.id}_${sub.id}`];
            return val && val > 0;
          });

          activeSubs.forEach((sub, idx) => {
            const subScore = season.scores[`${s.id}_${sub.id}`];
            const isLast = idx === activeSubs.length - 1;
            const prefix = isLast ? '  └─ ' : '  ├─ ';
            report += `${prefix}${sub.name}: ${formatScore(subScore!)}/10\n`;
          });
        }
      }
    });

    // 2. Chronological Journal
    if (season.episodeNotes && Object.keys(season.episodeNotes).length > 0) {
      const sortedEps = Object.keys(season.episodeNotes)
        .map(Number)
        .sort((a, b) => b - a); // Newest first

      const recentNotes = sortedEps.filter(ep => season.episodeNotes![ep].text?.trim());

      if (recentNotes.length > 0) {
        report += `\nJournal:\n`;
        recentNotes.forEach(ep => {
          report += `  Ep ${ep}: ${season.episodeNotes![ep].text.trim()}\n`;
        });
      }
    }

    // 3. Astra Notes (General & Rating)
    if ((work.notes && work.notes.trim()) || (season.notes && season.notes.trim())) {
      report += `\nGeneral Notes:\n`;
      if (work.notes && work.notes.trim()) {
        report += `  ${work.notes.trim()}\n`;
      }
      if (season.notes && season.notes.trim()) {
        if (work.notes && work.notes.trim()) report += `\n`;
        report += `  Rating: ${season.notes.trim()}\n`;
      }
    }

    report += `\n───────────────`;
    return report;
  }

  /**
   * Syncs the Astra report to the native AniList notes field
   */
  public async syncToAnilistNotes(mediaId: number, work: AstraWork): Promise<void> {
    if (!this.api.isAuthenticated()) return;

    try {
      // 1. Fetch existing notes from AniList first
      const query = `
        query ($mediaId: Int) {
          MediaList(mediaId: $mediaId) {
            notes
          }
        }
      `;
      const res = await this.api.query<any>(query, { mediaId });
      let nativeNotes = res?.MediaList?.notes || '';

      // 2. Generate our report
      const astraReport = this.generateMarkdownReport(work);

      // 3. Merge: replace or append
      const anchor = 'Astra Review';

      let finalNotes = '';
      if (nativeNotes.includes(anchor)) {
        // Replace everything from the anchor to the end (assuming Astra is at the end)
        // or we could be smarter, but usually user wants it replaced.
        const before = nativeNotes.split(anchor)[0];
        finalNotes = (before.trim() + '\n' + astraReport).trim();
      } else {
        // Append new Astra section
        finalNotes = (nativeNotes.trim() + '\n' + astraReport).trim();
      }

      // 4. Save back to AniList
      const mutation = `
        mutation ($mediaId: Int, $notes: String, $score: Float) {
          SaveMediaListEntry(mediaId: $mediaId, notes: $notes, score: $score) {
            id
            notes
          }
        }
      `;

      const overall = this.calcSeriesOverall(work);
      await this.api.mutate(mutation, {
        mediaId,
        notes: finalNotes,
        score: overall || 0
      });

      // Update local state and persist
      work.notes = finalNotes;
      await this.persist();

      log.success(`[AstraService] Synced notes for ${work.title} to AniList.`);
    } catch (error) {
      log.error(`[AstraService] Failed to sync notes for ${work.title}`, error);
    }
  }

  /**
   * Export all data as JSON string (Full Data)
   */
  async exportJSON(): Promise<string> {
    await this.init();
    
    // Load ALL full works for export
    const workKeys = this.summaries.map(s => `${this.WORK_PREFIX}${s.mediaId}`);
    const worksData = await this.storage.getMultiple<Record<string, AstraWork>>(workKeys);
    const works = Object.values(worksData).filter((w): w is AstraWork => !!w);

    return JSON.stringify({
      works,
      sections: this.sections,
      settings: this.settings,
      exportedAt: new Date().toISOString(),
      version: '2.0.0-atomic'
    }, null, 2);
  }

  /**
   * Import data from JSON with basic schema validation.
   */
  async importJSON(jsonStr: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonStr);
      
      if (!data.works || !Array.isArray(data.works)) {
        log.warn('[AstraService] Import aborted: Missing works array');
        return false;
      }

      // 1. Batch save all full works
      for (const work of data.works) {
        if (work.mediaId) {
          await this.storage.set(`${this.WORK_PREFIX}${work.mediaId}`, work);
        }
      }

      // 2. Rebuild summaries from imported data
      this.summaries = data.works.map((w: any) => this.createSummary(w));
      
      if (data.sections && Array.isArray(data.sections)) {
        this.sections = data.sections;
      }
      if (data.settings) {
        this.settings = data.settings;
      }

      // 3. Persist manifest
      await this.persist();
      
      log.success(`[AstraService] Successfully imported ${this.summaries.length} works.`);
      return true;
    } catch (error) {
      log.error('[AstraService] Import failed', error);
      return false;
    }
  }
}
