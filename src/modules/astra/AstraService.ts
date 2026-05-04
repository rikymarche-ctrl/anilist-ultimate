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

interface AstraDataStore {
  works: AstraWork[];
  sections: AstraSection[];
  settings: AstraSettings;
  lastUpdated: number;
}

@singleton()
@injectable()
export class AstraService {
  private works: AstraWork[] = [];
  // Performance optimization: O(1) lookup by mediaId instead of O(n) find
  private worksByMediaId: Map<number, AstraWork> = new Map();
  private sections: AstraSection[] = DEFAULT_SECTIONS;
  private settings: AstraSettings = DEFAULT_SETTINGS;
  private isLoaded = false;
  private readonly STORAGE_KEY = 'au_astra_data';
  private initPromise: Promise<void> | null = null;

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) { }

  /**
   * Initialize and load data from storage
   */
  async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const data = await this.storage.get<AstraDataStore>(this.STORAGE_KEY);
        if (data) {
          this.works = data.works || [];
          // Build the Map index for fast lookup
          this.rebuildWorkIndex();
          this.settings = data.settings || DEFAULT_SETTINGS;
          // Use stored sections if they exist, otherwise fallback to defaults
          if (data.sections && data.sections.length > 0) {
            this.sections = data.sections;
          } else {
            this.sections = [...DEFAULT_SECTIONS];
          }
        }
        this.isLoaded = true;
        log.success(`[AstraService] Initialization complete. Loaded ${this.works.length} works and ${this.sections.length} sections.`);
        this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED);
      } catch (error) {
        log.error('[AstraService] Failed to load data', error);
        this.works = [];
        this.sections = DEFAULT_SECTIONS;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Get all works
   */
  getWorks(): AstraWork[] {
    return this.works;
  }

  async getWork(mediaId: number): Promise<AstraWork | undefined> {
    await this.init();
    return this.works.find(w => w.mediaId === mediaId);
  }

  /**
   * Get a single work by mediaId
   * Performance: O(1) Map lookup instead of O(n) array find
   */
  getWorkByMediaId(mediaId: number): AstraWork | undefined {
    return this.worksByMediaId.get(mediaId);
  }

  /**
   * Rebuild the work index Map from the works array
   * Call this after bulk modifications to works array
   */
  private rebuildWorkIndex(): void {
    this.worksByMediaId.clear();
    for (const work of this.works) {
      this.worksByMediaId.set(work.mediaId, work);
    }
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
                  coverImage { large medium }
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

      let added = 0;
      let updated = 0;

      // Reset custom lists for all existing works before sync to ensure accuracy
      this.works.forEach(w => w.customLists = []);

      const processResult = (result: MediaListCollectionResponse) => {
        const collection = result?.MediaListCollection;
        if (!collection?.lists) return;

        for (const list of collection.lists) {
          for (const entry of list.entries) {
            const existing = this.getWorkByMediaId(entry.mediaId);

            if (existing) {
              const newTitle = entry.media.title.english || entry.media.title.romaji || entry.media.title.native || 'Unknown Title';
              if (existing.status !== entry.status || existing.title !== newTitle) {
                if (existing.title !== newTitle) existing.title = newTitle;
                existing.status = entry.status;
                updated++;
              }

              // Extract custom lists from entry
              existing.customLists = [];
              if (entry.customLists) {
                const customListsRaw = entry.customLists as Record<string, boolean>;
                const customListsArray = Object.keys(customListsRaw).filter(key => customListsRaw[key]);
                existing.customLists = customListsArray;
              }

              // Add Private and Hide from status lists flags
              if (entry.private === true) {
                existing.customLists.push('Private');
              }
              if (entry.hiddenFromStatusLists === true) {
                existing.customLists.push('Hide from status lists');
              }

              existing.genres = entry.media.genres || [];
              existing.episodes = entry.media.episodes ?? undefined;
              existing.chapters = entry.media.chapters ?? undefined;
              existing.progress = entry.progress;
              existing.duration = entry.media.duration ?? undefined;
              existing.notes = entry.notes || '';

              // TWO-WAY SYNC: Parse notes for existing work
              if (entry.notes) {
                const parsed = AstraParser.parse(entry.notes, this.sections);
                if (parsed) {
                  const wasChanged = AstraParser.merge(existing, parsed);
                  if (wasChanged) {
                    existing.updatedAt = Date.now();
                    updated++;
                  }
                }
              }
            } else {
              const media = entry.media;
              const type = media.type === 'ANIME' ? 'anime' : (media.format === 'NOVEL' ? 'novel' : 'manga');

              // Extract custom lists from entry
              let customListsArray: string[] = [];
              if (entry.customLists) {
                const customListsRaw = entry.customLists as Record<string, boolean>;
                customListsArray = Object.keys(customListsRaw).filter(key => customListsRaw[key]);
              }

              // Add Private and Hide from status lists flags
              if (entry.private === true && !customListsArray.includes('Private')) {
                customListsArray.push('Private');
              }
              if (entry.hiddenFromStatusLists === true && !customListsArray.includes('Hide from status lists')) {
                customListsArray.push('Hide from status lists');
              }

              const newWork: AstraWork = {
                id: `w_${generateUUID()}`,
                mediaId: entry.mediaId,
                title: media.title.english || media.title.romaji || media.title.native || 'Unknown Title',
                type: type as any,
                country: media.countryOfOrigin,
                cover: media.coverImage.large || media.coverImage.medium || undefined,
                anilistUrl: media.siteUrl,
                status: entry.status,
                customLists: customListsArray,
                tags: [],
                seasons: [this.createDefaultSeason()],
                notes: '',
                updatedAt: Date.now(),
                genres: media.genres || [],
                episodes: media.episodes ?? undefined,
                chapters: media.chapters ?? undefined,
                progress: entry.progress,
                duration: media.duration ?? undefined
              };

              // TWO-WAY SYNC: Parse notes for NEW work
              if (entry.notes) {
                const parsed = AstraParser.parse(entry.notes, this.sections);
                if (parsed) {
                  AstraParser.merge(newWork, parsed);
                }
              }

              // Store AniList score as legacy fallback
              if (entry.score > 0) {
                // AniList scores are typically 0-10 or 0-100 depending on format, 
                // but entry.score in GQL collections is usually the formatted one.
                // We normalize to 0-10 if it's > 10.
                const normalizedScore = entry.score > 10 ? entry.score / 10 : entry.score;
                newWork.seasons[0].legacyScore = normalizedScore;
              }
              newWork.notes = entry.notes || '';

              this.works.push(newWork);
              // Update Map index for O(1) lookup
              this.worksByMediaId.set(newWork.mediaId, newWork);
              added++;
            }
          }
        }
      };

      processResult(animeRes);
      processResult(mangaRes);

      // Always persist after sync
      this.works.sort((a, b) => b.updatedAt - a.updatedAt);
      this.rebuildWorkIndex();
      await this.persist();

      log.info(`[AstraService] Sync complete: +${added} added, ~${updated} updated`);
      return { added, updated };
    } catch (error) {
      log.error('[AstraService] Sync failed', error);
      throw error;
    }
  }

  /**
   * Save or update a work
   */
  async saveWork(work: Partial<AstraWork> & { mediaId: number }): Promise<AstraWork> {
    await this.init();

    const existingIdx = this.works.findIndex(w => w.mediaId === work.mediaId);
    let updatedWork: AstraWork;

    if (existingIdx >= 0) {
      updatedWork = {
        ...this.works[existingIdx],
        ...work,
        updatedAt: Date.now(),
      };
      this.works[existingIdx] = updatedWork;
      // Update Map index with new object reference
      this.worksByMediaId.set(updatedWork.mediaId, updatedWork);
    } else {
      updatedWork = Object.assign({
        id: `w_${generateUUID()}`,
        title: 'Unknown',
        type: 'anime',
        status: MediaListStatus.PLANNING,
        tags: [],
        seasons: [this.createDefaultSeason()],
        notes: '',
        updatedAt: Date.now(),
      }, work) as AstraWork;
      this.works.unshift(updatedWork);
      // Update Map index
      this.worksByMediaId.set(updatedWork.mediaId, updatedWork);
    }

    await this.persist();

    // Auto-sync with AniList notes
    this.syncToAnilistNotes(updatedWork.mediaId, updatedWork);

    return updatedWork;
  }

  /**
   * Save a note for a specific episode
   */
  async saveEpisodeNote(mediaId: number, episode: number, text: string): Promise<void> {
    await this.init();
    let work = this.getWorkByMediaId(mediaId);

    if (!work) {
      log.info(`[AstraService] Work not found for mediaId ${mediaId}. Creating new work for journal entry.`);
      // We don't have full info, but we can seed a basic work
      work = {
        id: `w_${generateUUID()}`,
        mediaId,
        title: 'Unknown (Pending Sync)',
        type: 'anime',
        status: MediaListStatus.CURRENT,
        customLists: [],
        tags: [],
        seasons: [this.createDefaultSeason()],
        notes: '',
        updatedAt: Date.now(),
      };
      this.works.push(work);
      this.worksByMediaId.set(mediaId, work);
    }

    // Find the last season (current)
    const season = work.seasons[work.seasons.length - 1];
    if (!season) return;

    if (!season.episodeNotes) {
      season.episodeNotes = {};
    }

    season.episodeNotes[episode] = {
      ...season.episodeNotes[episode],
      text
    };

    work.updatedAt = Date.now();
    await this.persist();

    // Auto-sync journal with AniList notes
    this.syncToAnilistNotes(mediaId, work);

    log.info(`[AstraService] Saved note for ${work.title} Ep ${episode}`);
  }

  /**
   * Delete a work
   */
  async deleteWork(mediaId: number): Promise<void> {
    this.works = this.works.filter(w => w.mediaId !== mediaId);
    // Remove from Map index
    this.worksByMediaId.delete(mediaId);
    await this.persist();
  }

  /**
   * Delete ALL works (Reset)
   */
  async clearAllWorks(): Promise<void> {
    this.works = [];
    // Clear Map index
    this.worksByMediaId.clear();
    await this.persist();
    log.info('[AstraService] All works cleared');
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
   * Internal persist to storage
   */
  private async persist(): Promise<void> {
    try {
      await this.storage.set(this.STORAGE_KEY, {
        works: this.works,
        sections: this.sections,
        settings: this.settings,
        lastUpdated: Date.now()
      });

      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, {
        timestamp: new Date()
      });
    } catch (error) {
      log.error('[AstraService] Persist failed', error);
    }
  }

  /**
   * Export all data as JSON string
   */
  exportJSON(): string {
    return JSON.stringify({
      works: this.works,
      sections: this.sections,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import data from JSON
   */
  async importJSON(jsonStr: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonStr);
      if (!data.works || !Array.isArray(data.works)) return false;

      this.works = data.works;
      if (data.sections) this.sections = data.sections;

      await this.persist();
      return true;
    } catch (error) {
      log.error('[AstraService] Import failed', error);
      return false;
    }
  }
}
