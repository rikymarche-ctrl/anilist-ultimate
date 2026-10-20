import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AstraRepository } from './AstraRepository';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EventBus } from '@core/events/EventBus';
import { MediaListStatus } from '@/api/AnilistTypes';

function makeStorage() {
  const data = new Map<string, unknown>();
  const storage = {
    data,
    async get<T>(k: string): Promise<T | null> { return data.has(k) ? structuredClone(data.get(k)) as T : null; },
    set: vi.fn(async (k: string, v: unknown) => {
      data.set(k, structuredClone(v));
      return true;
    }),
    setMultiple: vi.fn(async (items: Record<string, unknown>) => {
      Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value)));
      return true;
    }),
    remove: vi.fn(async (k: string) => {
      data.delete(k);
      return true;
    }),
    clear: vi.fn(async () => { data.clear(); return true; }),
    has: vi.fn(async (k: string) => data.has(k)),
    async getMultiple<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
      const result: Record<string, unknown> = {};
      keys.forEach(key => { if (data.has(key)) result[key] = structuredClone(data.get(key)); });
      return result as Partial<T>;
    },
    onChange: () => () => undefined,
  } satisfies IStorageService & { data: Map<string, unknown> };
  // Retain get<T>'s generic storage contract alongside the spy controls.
  return Object.assign(storage, { get: vi.spyOn(storage, 'get') });
}

function makeEventBus() {
  const bus = new EventBus();
  return Object.assign(bus, { emit: vi.spyOn(bus, 'emit') });
}

describe('AstraRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the current season fields from an existing stored work without copying unsupported fields', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage); repo.setOwner(42);
    const saved = await repo.saveWork({ mediaId: 1, title: 'Existing', status: MediaListStatus.CURRENT, progress: 3,
      customLists: ['Keep'], notes: 'Work notes', seasons: [{ id: 's_1', name: 'Season 1', scores: { story: 8, finale: 9 },
        isSeriesFinale: true, skip: ['sound'], notes: 'Season notes', episodeNotes: { 1: { text: 'Journal', score: 7, timestamp: 123 } } }] });
    Object.assign(saved.seasons[0], { legacyScore: 7, manualOverride: false, label: 'Obsolete', arbitraryField: 'Unknown' });
    storage.data.set('au_astra_work_1', structuredClone(saved));
    storage.set.mockClear(); storage.setMultiple.mockClear();
    const restarted = new AstraRepository(makeEventBus(), storage); restarted.setOwner(42);
    const read = (await restarted.getFullWork(1))!;
    expect(storage.data.get('au_astra_work_1')).toEqual(saved);
    expect(storage.set).not.toHaveBeenCalled(); expect(storage.setMultiple).not.toHaveBeenCalled();
    const planning = await restarted.saveWork({ ...read, status: MediaListStatus.PLANNING });
    expect(planning.seasons).toEqual([{ id: 's_1', name: 'Season 1', scores: { story: 8, finale: 9 }, isSeriesFinale: true,
      skip: ['sound'], notes: 'Season notes', episodeNotes: { 1: { text: 'Journal', score: 7, timestamp: 123 } } }]);
    expect(planning).toMatchObject({ ownerId: 42, status: 'PLANNING', progress: 3, customLists: ['Keep'], notes: 'Work notes' });
    expect(storage.data.get('au_astra_work_1')).toEqual(planning);
    expect(JSON.parse(await restarted.exportJSON()).works[1].seasons).toEqual(planning.seasons);
  });

  it('saves a work and exposes it as a summary', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());

    await repo.saveWork({ mediaId: 1, title: 'Frieren', status: MediaListStatus.COMPLETED });

    const works = repo.getWorks();
    expect(works).toHaveLength(1);
    expect(works[0].mediaId).toBe(1);
    expect(works[0].title).toBe('Frieren');
  });

  it('durably commits both work and manifest', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);

    await repo.saveWork({ mediaId: 2, title: 'X' });

    const batch = storage.setMultiple.mock.calls[0][0];
    expect(batch).toHaveProperty('au_astra_work_2');
    expect(batch).toHaveProperty('au_astra_manifest');
  });

  it('persists the manifest on save', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);

    await repo.saveWork({ mediaId: 3, title: 'Y' });

    expect(storage.setMultiple.mock.calls[0][0]).toHaveProperty('au_astra_manifest');
  });

  it('getSections returns a defensive copy (callers cannot mutate internals)', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    const original = repo.getSections().length;
    const sections = repo.getSections();
    sections.push({ id: 'hacked', name: 'Injected section', weight: 1 });

    expect(repo.getSections().length).toBe(original);
  });

  it('getSettings returns a defensive copy', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    const settings = repo.getSettings();
    settings.enableSeriesFinale = !settings.enableSeriesFinale;

    expect(repo.getSettings()).not.toBe(settings);
  });

  it('factoryReset removes indexed works without scanning unrelated storage', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    await repo.saveWork({ mediaId: 1 });
    await repo.factoryReset();
    expect(repo.getWorks()).toHaveLength(0);
    expect(await repo.getFullWork(1)).toBeUndefined();
  });

  it('deleteWork removes the work from the manifest', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.saveWork({ mediaId: 5, title: 'Z' });
    expect(repo.getWorks()).toHaveLength(1);

    await repo.deleteWork(5);

    expect(repo.getWorks()).toHaveLength(0);
  });

  it('rejects a failed work write without announcing a saved summary', async () => {
    const storage = makeStorage();
    const bus = makeEventBus();
    const repo = new AstraRepository(bus, storage);
    await repo.init();
    bus.emit.mockClear();
    storage.set.mockResolvedValue(false);
    await expect(repo.saveWork({ mediaId: 10, title: 'Unsaved' })).rejects.toThrow(/storage/i);
    expect(repo.getWorks()).toHaveLength(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('rejects a failed manifest write instead of emitting success', async () => {
    const storage = makeStorage();
    const bus = makeEventBus();
    const repo = new AstraRepository(bus, storage);
    await repo.init();
    bus.emit.mockClear();
    storage.setMultiple.mockResolvedValueOnce(false);
    await expect(repo.saveWork({ mediaId: 10 })).rejects.toThrow(/storage/i);
    expect(repo.getWorks()).toHaveLength(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('isolates a draft from cached work until its save succeeds', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);
    await repo.saveWork({ mediaId: 10, notes: 'Original' });
    const draft = (await repo.getFullWork(10))!;
    draft.notes = 'Unsaved';
    draft.seasons[0].scores.story = 9;
    storage.set.mockResolvedValue(false);
    await expect(repo.saveWork(draft)).rejects.toThrow();
    const saved = (await repo.getFullWork(10))!;
    expect(saved.notes).toBe('Original');
    expect(saved.seasons[0].scores.story).toBeNull();
  });

  it('uses section scores and returns no score for an unrated season', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.saveWork({ mediaId: 10, seasons: [{ scores: { story: 8 } }] });
    expect(repo.getWorks()[0].currentScore).toBe(8);
    await repo.saveWork({ mediaId: 10, seasons: [{ scores: {} }] });
    expect(repo.getWorks()[0].currentScore).toBeNull();
  });

  it('keeps nested section changes and defaults private to each repository', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    const other = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();
    await other.init();
    const sections = repo.getSections();
    sections[0].weight = 999;
    expect(repo.getSections()[0].weight).not.toBe(999);
    await repo.updateSectionWeight('story', 8);
    expect(other.getSections().find(s => s.id === 'story')?.weight).toBe(3);
  });

  it('limits the full-work cache during bulk saves and keeps recently read works', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);
    for (let mediaId = 1; mediaId <= 20; mediaId++) await repo.saveWork({ mediaId });
    await repo.getFullWork(1);
    await repo.saveWork({ mediaId: 21 });
    storage.get.mockClear();
    await repo.getFullWork(1);
    expect(storage.get).not.toHaveBeenCalled();
    await repo.getFullWork(2);
    expect(storage.get).toHaveBeenCalledWith('au_astra_work_2');
  });
});

describe('Astra persisted list dates', () => {
  it('publishes copied fuzzy dates, preserves an omitted date on patch and supports explicit Clear', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    const fields = { startedAt: { year: 2026, month: null, day: 5 }, completedAt: { year: 2026, month: 2, day: 28 } };
    await repo.saveWork({ mediaId: 1, ...fields }); fields.startedAt.year = 1990;
    expect(repo.getWorks()[0]).toMatchObject({ startedAt: { year: 2026, month: null, day: 5 }, completedAt: fields.completedAt });
    await repo.saveWork({ mediaId: 1, notes: 'New notes', completedAt: null } as never);
    expect(repo.getWorks()[0]).toMatchObject({ startedAt: { year: 2026, month: null, day: 5 }, completedAt: null });
  });
  it('keeps legacy dates absent and never promotes season dates to AniList list dates', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.saveWork({ mediaId: 1, seasons: [{ scores: {}, startDate: '2020-01-01', endDate: '2020-02-02' }] });
    expect(Object.prototype.hasOwnProperty.call(repo.getWorks()[0], 'startedAt')).toBe(false); expect(Object.prototype.hasOwnProperty.call(repo.getWorks()[0], 'completedAt')).toBe(false);
    const full = (await repo.getFullWork(1))!;
    expect(Object.prototype.hasOwnProperty.call(full, 'startedAt')).toBe(false); expect(Object.prototype.hasOwnProperty.call(full, 'completedAt')).toBe(false);
  });
  it('retains dates across rebuild, export/import and restart without loading full works for a snapshot', async () => {
    const storage = makeStorage(); const repo = new AstraRepository(makeEventBus(), storage);
    await repo.saveWork({ mediaId: 1, startedAt: { year: null, month: 3, day: null }, completedAt: null } as never);
    await repo.updateSectionWeight('story', 4); const json = await repo.exportJSON();
    const importedStorage = makeStorage(); const imported = new AstraRepository(makeEventBus(), importedStorage);
    expect(await imported.importJSON(json)).toBe(true);
    const restarted = new AstraRepository(makeEventBus(), importedStorage); importedStorage.get.mockClear();
    const snapshot = await restarted.getSnapshot();
    expect(snapshot.summaries[0]).toMatchObject({ startedAt: { year: null, month: 3, day: null }, completedAt: null });
    expect(importedStorage.get.mock.calls.some(([key]) => key.startsWith('au_astra_work_'))).toBe(false);
  });
  it.each(['2026-01-01', { year: -1, month: null, day: null }, { year: 2026, month: 2, day: 30 }])('rejects malformed persisted dates %j before publishing', async startedAt => {
    const storage = makeStorage(); const repo = new AstraRepository(makeEventBus(), storage);
    await expect(repo.saveWork({ mediaId: 1, startedAt } as never)).rejects.toThrow(); expect(repo.getWorks()).toEqual([]);
  });
  it('normalizes detached partial dates during reload without editing persisted or shared storage objects', async () => {
    const storage = makeStorage();
    const summary = { id: 'partial', mediaId: 1, title: 'Partial', type: 'anime', status: MediaListStatus.CURRENT, currentScore: null, updatedAt: 1, startedAt: { year: 2026 }, completedAt: null };
    storage.data.set('au_astra_manifest', [summary]);
    storage.get.mockImplementation(async <T>(key: string): Promise<T | null> => storage.data.has(key) ? storage.data.get(key) as T : null);
    const repo = new AstraRepository(makeEventBus(), storage); const snapshot = await repo.getSnapshot();
    expect(snapshot.summaries[0].startedAt).toEqual({ year: 2026, month: null, day: null });
    expect(snapshot.summaries[0].completedAt).toBeNull();
    snapshot.summaries[0].startedAt!.year = 1990;
    expect(repo.getWorks()[0].startedAt?.year).toBe(2026); expect(summary.startedAt).toEqual({ year: 2026 });
    expect(storage.set).not.toHaveBeenCalled(); expect(storage.setMultiple).not.toHaveBeenCalled();
  });

  it('normalizes dates returned from a saved work cache and keeps cached dates detached', async () => {
    const storage = makeStorage(); const repo = new AstraRepository(makeEventBus(), storage);
    await repo.saveWork({ mediaId: 1, startedAt: { year: 2026 }, completedAt: null } as never);
    storage.get.mockClear(); const full = (await repo.getFullWork(1))!;
    expect(full.startedAt).toEqual({ year: 2026, month: null, day: null }); expect(full.completedAt).toBeNull();
    full.startedAt!.year = 1990;
    expect((await repo.getFullWork(1))!.startedAt?.year).toBe(2026);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('normalizes full-work storage reads without rewriting the original date representation', async () => {
    const storage = makeStorage(); const writer = new AstraRepository(makeEventBus(), storage);
    await writer.saveWork({ mediaId: 1 });
    const persisted = storage.data.get('au_astra_work_1') as Record<string, unknown>; persisted.startedAt = { month: 3 }; persisted.completedAt = null;
    const before = structuredClone(persisted); storage.set.mockClear(); storage.setMultiple.mockClear();
    const reader = new AstraRepository(makeEventBus(), storage); const full = (await reader.getFullWork(1))!;
    expect(full.startedAt).toEqual({ year: null, month: 3, day: null }); expect(full.completedAt).toBeNull();
    expect(storage.data.get('au_astra_work_1')).toEqual(before); expect(storage.set).not.toHaveBeenCalled(); expect(storage.setMultiple).not.toHaveBeenCalled();
  });

  it.each(['2026-01-01', { year: 2026, month: 2, day: 30 }, { year: 2026, month: -1, day: null }])(
    'rejects malformed full-work dates %j before caching even with a valid manifest, and permits a corrected reread', async startedAt => {
      const storage = makeStorage(); const writer = new AstraRepository(makeEventBus(), storage); await writer.saveWork({ mediaId: 1 });
      const persisted = storage.data.get('au_astra_work_1') as Record<string, unknown>; persisted.startedAt = startedAt;
      const before = structuredClone(persisted); storage.setMultiple.mockClear();
      const reader = new AstraRepository(makeEventBus(), storage);
      await expect(reader.getFullWork(1)).rejects.toThrow(/date/i); expect(storage.data.get('au_astra_work_1')).toEqual(before);
      persisted.startedAt = { year: 2028, month: 2, day: 29 };
      expect((await reader.getFullWork(1))?.startedAt).toEqual({ year: 2028, month: 2, day: 29 }); expect(storage.setMultiple).not.toHaveBeenCalled();
    });

  it('keeps invalid initialization unpublished, preserves persisted data and retries a corrected manifest', async () => {
    const storage = makeStorage(); const bus = makeEventBus();
    const summary = { id: 'broken', mediaId: 1, title: 'Broken', type: 'anime', status: MediaListStatus.CURRENT, currentScore: null, updatedAt: 1, startedAt: { year: 2026, month: 99, day: null } };
    storage.data.set('au_astra_manifest', [summary]); const repo = new AstraRepository(bus, storage);
    await expect(repo.init()).rejects.toThrow(/date/i); expect(repo.getWorks()).toEqual([]); expect(bus.emit).not.toHaveBeenCalled();
    expect(storage.data.get('au_astra_manifest')).toEqual([summary]);
    summary.startedAt = { year: 2026, month: 3, day: null }; await repo.init();
    expect(repo.getWorks()[0].startedAt).toEqual(summary.startedAt); expect(bus.emit).toHaveBeenCalledOnce();
  });

});

describe('Astra section identifiers', () => {
  it('never gives a new section an id that matches an existing section or a sub-section score key', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage()); repo.setOwner(42);
    await repo.init();
    await repo.updateSections([
      { id: 'story', name: 'Story', weight: 1 },
      { id: 'world', name: 'World', weight: 1, subSections: [{ id: 'building', name: 'Building', weight: 1 }] },
    ]);
    await repo.addSection('Story');
    await repo.addSection('World Building');
    // The composite key world_building belongs to the sub-section Building, so the new section takes _2.
    expect(repo.getSections().map(section => section.id)).toEqual(['story', 'world', 'story_2', 'world_building_2']);
  });

  it('never gives a sub-section an id that repeats a sibling or whose composite key is already taken', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage()); repo.setOwner(42);
    await repo.init();
    await repo.updateSections([
      { id: 'world', name: 'World', weight: 1, subSections: [{ id: 'building', name: 'Building', weight: 1 }] },
    ]);
    await repo.addSubSection('world', 'Building');
    await repo.addSection('World Terrain');
    await repo.addSubSection('world', 'Terrain');
    // Composite world_terrain is already the top-level section id, so the sub-section takes _2.
    expect(repo.getSections()[0].subSections!.map(sub => sub.id)).toEqual(['building', 'building_2', 'terrain_2']);
  });
});
