/** Single-writer Astra repository. Tabs use AstraRepositoryClient, never this writer. */
import { injectable, singleton, inject } from 'tsyringe';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { reservedSectionKeys, uniqueSectionId } from '../utils/AstraSectionIds';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { AstraWork, AstraWorkSummary, AstraSection, AstraSettings, AstraSeason } from '../AstraInterfaces';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS, generateUUID } from '../utils/AstraConstants';
import { copyAstraDates } from '../utils/AstraDates';
import { copyAstraSeason } from '../utils/AstraSeasons';
import { AstraCalculator } from '../utils/AstraCalculator';
import { parseAstraBackup } from './AstraBackup';
import { ASTRA_KEYS, AstraPersistence, type AstraSnapshot } from './AstraPersistence';
import { validateSeasonKey, validateSeasonalArchive, emptySeasonalChoices, type SeasonalChoices, type SeasonalArchive } from '../services/SeasonalWrappedModel';

export class AstraConflictError extends Error {
  constructor() { super('Astra work changed in another operation; reload before saving'); this.name = 'AstraConflictError'; }
}

@singleton()
@injectable()
export class AstraRepository {
  protected snapshot: AstraSnapshot = { summaries: [], sections: structuredClone(DEFAULT_SECTIONS), settings: { ...DEFAULT_SETTINGS }, revision: 0 };
  private fullWorkCache = new Map<number, AstraWork>();
  private mediaIds = new Set<number>();
  private readonly MAX_CACHE_SIZE = 20;
  private initPromise: Promise<void> | null = null;
  private operations: Promise<unknown> = Promise.resolve();
  private needsRecovery = false;
  private persistence: AstraPersistence;
  private ownerId: number | null | undefined;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
  ) { this.persistence = new AstraPersistence(storage); }
  public setOwner(ownerId: number | null): void {
    if (this.initPromise) throw new Error('Repository owner is immutable after initialization');
    this.ownerId = ownerId;
  }

  public init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.reload().catch(error => { this.initPromise = null; throw error; });
    }
    return this.initPromise;
  }

  private async reload(): Promise<void> {
    await this.persistence.recover();
    const [manifest, sections, settings, revision] = await Promise.all([
      this.storage.get<AstraWorkSummary[]>(ASTRA_KEYS.manifest),
      this.storage.get<AstraSection[]>(ASTRA_KEYS.sections), this.storage.get<AstraSettings>(ASTRA_KEYS.settings),
      this.storage.get<number>(ASTRA_KEYS.revision),
    ]);
    const summaries = manifest;
    if (summaries !== null && !Array.isArray(summaries)) throw new Error('Invalid Astra manifest; original data preserved');
    const next = {
      summaries: summaries ?? [], sections: sections ?? structuredClone(DEFAULT_SECTIONS),
      settings: { ...DEFAULT_SETTINGS, ...settings }, revision: revision ?? 0,
    };
    if (!Number.isSafeInteger(next.revision) || next.revision < 0) throw new Error('Invalid Astra revision');
    // Validate configuration without requiring a full, eagerly-loaded work set.
    parseAstraBackup(JSON.stringify({ schemaVersion: 1, manifest: [], works: {}, sections: next.sections, settings: next.settings }));
    const ids = new Set<number>();
    const normalizedSummaries = next.summaries.map(summary => {
      if (!summary || !Number.isSafeInteger(summary.mediaId) || summary.mediaId <= 0 || ids.has(summary.mediaId)) {
        throw new Error('Invalid Astra manifest entries; original data preserved');
      }
      ids.add(summary.mediaId);
      return { ...summary, ...copyAstraDates(summary) };
    });
    this.applySnapshot({ ...next, summaries: normalizedSummaries });
    this.needsRecovery = false;
    this.notify();
  }

  protected applySnapshot(snapshot: AstraSnapshot): void {
    this.snapshot = structuredClone(snapshot);
    this.mediaIds = new Set(snapshot.summaries.map(work => work.mediaId));
    this.fullWorkCache.clear();
  }

  /** Serialize both reads and mutations so exports/clients cannot observe half a commit. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operations.then(async () => {
      await this.init();
      if (this.needsRecovery) await this.reload();
      return operation();
    });
    this.operations = pending.catch(() => undefined);
    return pending;
  }

  public getSnapshot(): Promise<AstraSnapshot> { return this.run(async () => structuredClone(this.snapshot)); }
  public getWorks(): AstraWorkSummary[] { return structuredClone(this.snapshot.summaries); }
  public getSections(): AstraSection[] { return structuredClone(this.snapshot.sections); }
  public getSettings(): AstraSettings { return { ...this.snapshot.settings }; }
  public getFullWork(mediaId: number): Promise<AstraWork | undefined> { return this.run(() => this.readWork(mediaId)); }

  private async readWork(mediaId: number): Promise<AstraWork | undefined> {
    this.validateId(mediaId);
    if (!this.mediaIds.has(mediaId)) return undefined;
    const cached = this.fullWorkCache.get(mediaId);
    const work = cached ?? await this.storage.get<AstraWork>(`${ASTRA_KEYS.workPrefix}${mediaId}`);
    if (!work) throw new Error(`Missing Astra work: ${mediaId}`);
    // Normalize and validate before retaining or publishing either storage or
    // cached data. Read normalization never rewrites the persisted work.
    const detached = { ...structuredClone(work), ...copyAstraDates(work) };
    // Publish only the current season model. A later explicit save persists this
    // shape; merely opening a work never rewrites its stored data.
    if (Array.isArray(detached.seasons)) detached.seasons = detached.seasons.map(copyAstraSeason);
    this.cacheWork(detached);
    return { ...detached, ...(this.ownerId !== undefined ? { ownerId: this.ownerId } : {}) };
  }

  public async saveWork(work: Partial<AstraWork> & { mediaId: number }): Promise<AstraWork> {
    return (await this.saveWorks([work]))[0];
  }

  public saveWorks(works: (Partial<AstraWork> & { mediaId: number })[]): Promise<AstraWork[]> {
    const detached = structuredClone(works);
    return this.run(async () => {
      const next = structuredClone(this.snapshot);
      const summaries = new Map(next.summaries.map(work => [work.mediaId, work]));
      const writes = new Map<string, AstraWork>();
      const saved: AstraWork[] = [];
      for (const patch of detached) {
        if (patch.ownerId !== undefined && this.ownerId !== undefined && patch.ownerId !== this.ownerId) throw new Error('Astra work belongs to another account');
        this.validateId(patch.mediaId);
        const previous = writes.get(`${ASTRA_KEYS.workPrefix}${patch.mediaId}`) ?? await this.readWork(patch.mediaId);
        if (previous && patch.updatedAt !== undefined && patch.updatedAt !== previous.updatedAt) throw new AstraConflictError();
        const full = structuredClone({
          id: `w_${generateUUID()}`, title: 'Unknown', type: 'anime', status: 'PLANNING', tags: [], customLists: [],
          seasons: [this.createDefaultSeason()], notes: '', ...previous, ...patch,
          updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
          ...(this.ownerId !== undefined ? { ownerId: this.ownerId } : {}),
        }) as AstraWork;
        this.validateWork(full);
        summaries.set(full.mediaId, this.createSummary(full));
        writes.set(`${ASTRA_KEYS.workPrefix}${full.mediaId}`, full);
        saved.push(full);
      }
      if (saved.length) {
        next.summaries = [...summaries.values()];
        await this.commit(next, Object.fromEntries(writes));
        saved.forEach(work => this.cacheWork(work));
      }
      return structuredClone(saved);
    });
  }

  public deleteWork(mediaId: number): Promise<void> {
    return this.run(async () => {
      this.validateId(mediaId);
      const next = structuredClone(this.snapshot);
      next.summaries = next.summaries.filter(work => work.mediaId !== mediaId);
      await this.commit(next, {}, [`${ASTRA_KEYS.workPrefix}${mediaId}`]);
    });
  }

  public createSummary(work: AstraWork, sections = this.snapshot.sections, settings = this.snapshot.settings): AstraWorkSummary {
    const latest = work.seasons[work.seasons.length - 1];
    const sectionScores: Record<string, number | null> = {};
    if (latest) sections.forEach(section => { sectionScores[section.id] = AstraCalculator.calcSectionScore(section, latest.scores); });
    return {
      id: work.id, mediaId: work.mediaId, title: work.title, type: work.type, cover: work.cover, status: work.status,
      progress: work.progress, episodes: work.episodes, chapters: work.chapters, country: work.country, updatedAt: work.updatedAt,
      ...copyAstraDates(work),
      genres: work.genres, customLists: work.customLists, isPrivate: work.isPrivate, isHidden: work.isHidden,
      currentScore: latest ? AstraCalculator.calcSeasonScore(latest, sections, settings) : null, sectionScores,
    };
  }
  public createDefaultSeason(name = 'Season 1'): AstraSeason {
    return { id: `s_${generateUUID()}`, name, scores: Object.fromEntries(this.snapshot.sections.map(section => [section.id, null])), skip: [], episodeNotes: {} };
  }
  public persist(): Promise<void> { return this.run(() => this.commit(structuredClone(this.snapshot))); }

  private configure(change: (snapshot: AstraSnapshot) => void): Promise<void> {
    return this.run(async () => {
      const next = structuredClone(this.snapshot);
      change(next);
      parseAstraBackup(JSON.stringify({ schemaVersion: 1, manifest: [], works: {}, sections: next.sections, settings: next.settings }));
      // Changing weights/override settings must refresh derived summary scores.
      const works = await Promise.all(next.summaries.map(summary => this.readWork(summary.mediaId)));
      next.summaries = works.map(work => this.createSummary(work!, next.sections, next.settings));
      await this.commit(next);
    });
  }

  public updateSettings(settings: Partial<AstraSettings>): Promise<void> {
    const copy = structuredClone(settings);
    return this.configure(next => { next.settings = { ...next.settings, ...copy }; });
  }
  public updateSections(sections: AstraSection[]): Promise<void> {
    const copy = structuredClone(sections);
    return this.configure(next => { next.sections = copy; });
  }
  public addSection(name: string): Promise<void> {
    return this.configure(next => { next.sections.push({ id: uniqueSectionId(name, reservedSectionKeys(next.sections)), name, weight: 1, subSections: [] }); });
  }
  public removeSection(id: string): Promise<void> { return this.configure(next => { next.sections = next.sections.filter(section => section.id !== id); }); }
  public updateSectionWeight(id: string, weight: number): Promise<void> { return this.configure(next => { const section = next.sections.find(s => s.id === id); if (section) section.weight = weight; }); }
  public updateSectionName(id: string, name: string): Promise<void> { return this.configure(next => { const section = next.sections.find(s => s.id === id); if (section) section.name = name; }); }
  public addSubSection(sectionId: string, name: string): Promise<void> {
    return this.configure(next => {
      const section = next.sections.find(s => s.id === sectionId);
      if (!section) return;
      const siblingIds = new Set((section.subSections ?? []).map(sub => sub.id));
      (section.subSections ??= []).push({ id: uniqueSectionId(name, reservedSectionKeys(next.sections), { parentId: section.id, siblingIds }), name, weight: 1 });
    });
  }
  public removeSubSection(sectionId: string, subId: string): Promise<void> {
    return this.configure(next => { const section = next.sections.find(s => s.id === sectionId); if (section) section.subSections = section.subSections?.filter(s => s.id !== subId); });
  }
  public updateSubSectionName(sectionId: string, subId: string, name: string): Promise<void> {
    return this.configure(next => { const section = next.sections.find(s => s.id === sectionId)?.subSections?.find(s => s.id === subId); if (section) section.name = name; });
  }
  public updateSubSectionWeight(sectionId: string, subId: string, weight: number): Promise<void> {
    return this.configure(next => { const section = next.sections.find(s => s.id === sectionId)?.subSections?.find(s => s.id === subId); if (section) section.weight = weight; });
  }

  public factoryReset(): Promise<void> {
    return this.run(async () => {
      // Remove only indexed works. Other account/extension keys are never scanned or erased.
      const removals = this.snapshot.summaries.map(work => `${ASTRA_KEYS.workPrefix}${work.mediaId}`);
      await this.commit({ summaries: [], sections: structuredClone(DEFAULT_SECTIONS), settings: { ...DEFAULT_SETTINGS }, revision: this.snapshot.revision }, { [ASTRA_KEYS.seasonal]: {} }, removals);
    });
  }

  public exportJSON(): Promise<string> {
    return this.run(async () => {
      const works: Record<string, AstraWork> = {};
      for (const summary of this.snapshot.summaries) {
        const work = await this.readWork(summary.mediaId);
        if (!work) throw new Error(`Missing Astra work in backup: ${summary.mediaId}`);
        works[String(summary.mediaId)] = work;
      }
      // Compact JSON avoids inflating otherwise valid archives past the import limit.
      const seasonalWrapped = await this.readSeasonalArchive();
      const backup = JSON.stringify({ schemaVersion: 1, manifest: this.snapshot.summaries, sections: this.snapshot.sections, settings: this.snapshot.settings, works,
        ...(Object.keys(seasonalWrapped).length ? { seasonalWrapped } : {}) });
      parseAstraBackup(backup); // Never offer a backup that this version cannot restore.
      return backup;
    });
  }
  public async importJSON(json: string, expectedEmptyRevision?: number): Promise<boolean> {
    try {
      const data = parseAstraBackup(json);
      return await this.run(async () => {
        if (expectedEmptyRevision !== undefined && (this.snapshot.revision !== expectedEmptyRevision || this.snapshot.summaries.length)) throw new AstraConflictError();
        const next: AstraSnapshot = { summaries: [], sections: data.sections, settings: { ...DEFAULT_SETTINGS, ...data.settings }, revision: this.snapshot.revision };
        const old = this.snapshot;
        const writes: Record<string, unknown> = { [ASTRA_KEYS.seasonal]: data.seasonalWrapped ?? {} };
        for (const summary of data.manifest) {
          const work = data.works[String(summary.mediaId)];
          const previous = await this.readWork(summary.mediaId);
          const imported = { ...work, updatedAt: Math.max(Date.now(), work.updatedAt + 1, (previous?.updatedAt ?? 0) + 1), ...(this.ownerId !== undefined ? { ownerId: this.ownerId } : {}) };
          writes[`${ASTRA_KEYS.workPrefix}${summary.mediaId}`] = imported;
          next.summaries.push(this.createSummary(imported, next.sections, next.settings));
        }
        const removals = old.summaries.filter(work => !data.works[String(work.mediaId)]).map(work => `${ASTRA_KEYS.workPrefix}${work.mediaId}`);
        await this.commit(next, writes, removals);
        return true;
      });
    } catch (error) { logger.error('[AstraRepository] Import failed', error); return false; }
  }

  private async readSeasonalArchive(): Promise<SeasonalArchive> {
    const archive = await this.storage.get<unknown>(ASTRA_KEYS.seasonal) ?? {};
    validateSeasonalArchive(archive);
    return structuredClone(archive);
  }

  public saveSeasonalChoices(key: string, choices: SeasonalChoices): Promise<SeasonalChoices> {
    validateSeasonKey(key);
    const detached = structuredClone(choices);
    validateSeasonalArchive({ [key]: detached });
    return this.run(async () => {
      const archive = await this.readSeasonalArchive();
      if ((archive[key] ?? emptySeasonalChoices()).updatedAt !== detached.updatedAt) throw new AstraConflictError();
      const saved = { ...detached, updatedAt: Math.max(Date.now(), detached.updatedAt + 1) };
      archive[key] = saved;
      validateSeasonalArchive(archive);
      await this.commit(structuredClone(this.snapshot), { [ASTRA_KEYS.seasonal]: archive });
      return structuredClone(saved);
    });
  }

  private async commit(next: AstraSnapshot, works: Record<string, unknown> = {}, removals: string[] = []): Promise<void> {
    next.revision = this.snapshot.revision + 1;
    try { await this.persistence.commit(next, works, removals); }
    catch (error) { this.needsRecovery = true; throw error; }
    this.snapshot = structuredClone(next);
    this.mediaIds = new Set(next.summaries.map(work => work.mediaId));
    Object.keys(works).forEach(key => this.fullWorkCache.delete(Number(key.slice(ASTRA_KEYS.workPrefix.length))));
    removals.forEach(key => this.fullWorkCache.delete(Number(key.slice(ASTRA_KEYS.workPrefix.length))));
    this.notify();
  }
  private notify(): void { this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() }); }
  private validateId(id: number): void { if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new Error('Invalid Astra mediaId'); }
  private validateWork(work: AstraWork): void {
    parseAstraBackup(JSON.stringify({ schemaVersion: 1, manifest: [{ mediaId: work.mediaId }], works: { [work.mediaId]: work }, sections: this.snapshot.sections, settings: this.snapshot.settings }));
  }
  private cacheWork(work: AstraWork): void {
    this.fullWorkCache.delete(work.mediaId);
    this.fullWorkCache.set(work.mediaId, structuredClone(work));
    if (this.fullWorkCache.size > this.MAX_CACHE_SIZE) this.fullWorkCache.delete(this.fullWorkCache.keys().next().value!);
  }
}
