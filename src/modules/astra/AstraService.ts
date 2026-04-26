import { injectable, singleton } from 'tsyringe';
import { log } from '@core/logger';

export interface AstraWork {
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga' | 'novel';
  country?: string; // JP, CN, KR, etc.
  cover?: string;
  coverColor?: string;
  anilistUrl?: string;
  status: string;
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

export interface AstraSeason {
  id: string;
  label: string;
  scores: Record<string, number | null>;
  skip?: string[];
  startDate?: string;
  endDate?: string;
  notes?: string;
  isSeriesFinale?: boolean;
  episodeNotes?: Record<number, { text: string; score?: number }>;
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
  { id: 'characters', name: 'Characters', weight: 3, subSections: [] },
  { id: 'visuals', name: 'Visuals', weight: 2, subSections: [] },
  { id: 'audio', name: 'Audio', weight: 1, subSections: [] },
  { id: 'enjoyment', name: 'Enjoyment', weight: 3, subSections: [] },
  { id: 'finale', name: 'Finale', weight: 2, subSections: [] },
  { id: 'bullshit', name: 'Bullshit', weight: 1, subSections: [] },
  { id: 'originality', name: 'Originality', weight: 2, subSections: [] },
  { id: 'consistency', name: 'Consistency', weight: 2, subSections: [] },
];

export interface AstraSettings {
  enableSeriesFinale: boolean;
}

export const DEFAULT_SETTINGS: AstraSettings = {
  enableSeriesFinale: true,
};

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

  constructor() { }

  /**
   * Initialize and load data from storage
   */
  async init(): Promise<void> {
    if (this.isLoaded) return;

    try {
      const data = await this.getFromStorage();
      if (data) {
        this.works = data.works || [];
        // Build the Map index for fast lookup
        this.rebuildWorkIndex();
        this.settings = data.settings || DEFAULT_SETTINGS;
        // Merge stored sections with defaults to ensure new IDs appear during development
        const storedSections = data.sections || [];
        const merged = [...DEFAULT_SECTIONS];
        storedSections.forEach((s: AstraSection) => {
          const idx = merged.findIndex(m => m.id === s.id);
          if (idx >= 0) merged[idx] = s;
        });
        this.sections = merged;
      }
      this.isLoaded = true;
      log.info(`[AstraService] Loaded ${this.works.length} works`);
    } catch (error) {
      log.error('[AstraService] Failed to load data', error);
      this.works = [];
      this.sections = DEFAULT_SECTIONS;
    }
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
  async syncWithAniList(apiClient: any): Promise<{ added: number, updated: number }> {
    await this.init();
    
    try {
      const userId = await apiClient.getCurrentUserId();
      
      const query = `
        query ($userId: Int, $type: MediaType) {
          MediaListCollection(userId: $userId, type: $type) {
            lists {
              name
              entries {
                mediaId
                status
                score(format: POINT_10)
                progress
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
        apiClient.query(query, { userId, type: 'ANIME' }),
        apiClient.query(query, { userId, type: 'MANGA' })
      ]);

      let added = 0;
      let updated = 0;

      const processResult = (result: any) => {
        const collection = result?.MediaListCollection;
        if (!collection?.lists) return;

        for (const list of collection.lists) {
          const listName = list.name;
          for (const entry of list.entries) {
            const existing = this.getWorkByMediaId(entry.mediaId);
            
            if (existing) {
              const newTitle = entry.media.title.english || entry.media.title.romaji || entry.media.title.native;
              if (existing.status !== entry.status || existing.title !== newTitle) {
                if (existing.title !== newTitle) existing.title = newTitle;
                existing.status = entry.status;
                updated++;
              }
              // Sync list name
              existing.customLists = [listName];
              existing.genres = entry.media.genres || [];
              existing.episodes = entry.media.episodes;
              existing.chapters = entry.media.chapters;
              existing.progress = entry.progress;
              existing.duration = entry.media.duration;
            } else {
              const media = entry.media;
              const type = media.type === 'ANIME' ? 'anime' : (media.format === 'NOVEL' ? 'novel' : 'manga');
              
              const newWork: AstraWork = {
                id: `w_${Math.random().toString(36).slice(2, 11)}`,
                mediaId: entry.mediaId,
                title: media.title.english || media.title.romaji || media.title.native,
                type: type as any,
                country: media.countryOfOrigin,
                cover: media.coverImage.large || media.coverImage.medium,
                anilistUrl: media.siteUrl,
                status: entry.status,
                customLists: [listName],
                tags: [],
                seasons: [this.createDefaultSeason()],
                notes: '',
                updatedAt: Date.now(),
                genres: media.genres || [],
                episodes: media.episodes,
                chapters: media.chapters,
                progress: entry.progress,
                duration: media.duration
              };
              
              // Seed enjoyment if AniList score exists
              if (entry.score > 0) {
                newWork.seasons[0].scores['enjoyment'] = entry.score;
              }

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

      if (added > 0 || updated > 0) {
        // Sort by updatedAt or mediaId to keep it consistent
        this.works.sort((a, b) => b.updatedAt - a.updatedAt);
        await this.persist();
      }

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
    } else {
      updatedWork = Object.assign({
        id: `w_${Math.random().toString(36).slice(2, 11)}`,
        title: 'Unknown',
        type: 'anime',
        status: 'PLANNING',
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
    return updatedWork;
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
   * Calculate overall score for a season
   */
  calcSeasonOverall(scores: Record<string, number | null>, skip?: string[], isSeriesFinale?: boolean): number | null {
    const skipSet = new Set(skip || []);
    let num = 0, den = 0;

    for (const s of this.sections) {
      if (skipSet.has(s.id)) continue;
      
      const v = this.calcSectionScore(s, scores);
      if (v === null || v === undefined || v === 0) continue;

      let weight = s.weight;
      if (s.id === 'finale' && isSeriesFinale) {
        weight *= 2;
      }

      num += v * weight;
      den += weight;
    }

    if (den === 0) return null;
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
      id: `s_${Math.random().toString(36).slice(2, 7)}`,
      label,
      scores,
      skip: [],
      episodeNotes: {}
    };
  }

  /**
   * Internal persist to storage
   */
  private async persist(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: {
          works: this.works,
          sections: this.sections,
          settings: this.settings,
          lastUpdated: Date.now()
        }
      });
    } catch (error) {
      log.error('[AstraService] Persist failed', error);
    }
  }

  private async getFromStorage(): Promise<any> {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.STORAGE_KEY, (result) => {
        resolve(result[this.STORAGE_KEY]);
      });
    });
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
