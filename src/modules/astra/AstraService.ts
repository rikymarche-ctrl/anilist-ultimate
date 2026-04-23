import { injectable, singleton } from 'tsyringe';
import { log } from '@core/logger';

export interface AstraWork {
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga';
  cover?: string;
  coverColor?: string;
  anilistUrl?: string;
  status: string;
  tags: string[];
  seasons: AstraSeason[];
  notes: string;
  updatedAt: number;
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

export interface AstraSection {
  id: string;
  name: string;
  weight: number;
}

export const DEFAULT_SECTIONS: AstraSection[] = [
  { id: 'story', name: 'Story', weight: 3 },
  { id: 'characters', name: 'Characters', weight: 3 },
  { id: 'visuals', name: 'Visuals', weight: 2 },
  { id: 'audio', name: 'Audio', weight: 1 },
  { id: 'enjoyment', name: 'Enjoyment', weight: 3 },
  { id: 'finale', name: 'Finale', weight: 2 },
  { id: 'bullshit', name: 'Bullshit', weight: 1 },
  { id: 'originality', name: 'Originality', weight: 2 },
  { id: 'consistency', name: 'Consistency', weight: 2 },
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
   */
  getWorkByMediaId(mediaId: number): AstraWork | undefined {
    return this.works.find(w => w.mediaId === mediaId);
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
    }

    await this.persist();
    return updatedWork;
  }

  /**
   * Delete a work
   */
  async deleteWork(mediaId: number): Promise<void> {
    this.works = this.works.filter(w => w.mediaId !== mediaId);
    await this.persist();
  }

  /**
   * Calculate overall score for a season
   */
  calcSeasonOverall(scores: Record<string, number | null>, skip?: string[], isSeriesFinale?: boolean): number | null {
    const skipSet = new Set(skip || []);
    let num = 0, den = 0;

    for (const s of this.sections) {
      if (skipSet.has(s.id)) continue;
      const v = scores[s.id];
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
