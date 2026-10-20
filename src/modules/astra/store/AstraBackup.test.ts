import { describe, it, expect, vi } from 'vitest';
import { AstraRepository } from './AstraRepository';
import { AstraWorkValidationError, MAX_ASTRA_BACKUP_CHARACTERS, parseAstraBackup } from './AstraBackup';

function fixture() {
  const work = { id: 'w_1', mediaId: 1, title: 'Original', type: 'anime', status: 'CURRENT', notes: 'Original notes', updatedAt: 1,
    tags: [], seasons: [{ scores: { story: 8 }, episodeNotes: { 1: { text: 'Unit', score: 9, timestamp: 1 } } }] };
  return { schemaVersion: 1, manifest: [{ mediaId: 1 }], sections: [{ id: 'story', name: 'Story', weight: 1 }], settings: {}, works: { 1: work } };
}
function storage() {
  const data = new Map<string, unknown>();
  return { data, get: vi.fn(async (key: string) => structuredClone(data.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }),
    setMultiple: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([k, v]) => data.set(k, structuredClone(v))); return true; }),
    remove: vi.fn(async (key: string) => { data.delete(key); return true; }) };
}
describe('Astra backup integrity', () => {
  it.each([
    ['status', 'INVALID', 'STATUS'], ['progress', -1, 'PROGRESS'], ['episodes', null, 'EPISODES'],
    ['chapters', null, 'CHAPTERS'], ['isPrivate', null, 'PRIVATE'], ['country', null, 'COUNTRY'],
    ['notes', null, 'NOTES'], ['seasons', [{ scores: { story: 99 } }], 'SCORES'],
    ['seasons', [{ scores: {}, unsupportedField: 'Sensitive data' }], 'SEASON_FIELDS'],
    ['seasons', [{ scores: {}, episodeNotes: { 1: { text: null } } }], 'JOURNAL'],
  ])('identifies rejected %s with a fixed field code', (key, value, field) => {
    const data = fixture(); Object.assign(data.works[1], { [key]: value });
    let failure: unknown;
    try { parseAstraBackup(JSON.stringify(data)); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AstraWorkValidationError);
    expect(failure).toMatchObject({ validationField: field, message: 'Invalid Astra work' });
    expect(JSON.stringify(failure)).not.toContain('Sensitive data');
  });
  it.each(['key', 'missing', 'season', 'score', 'section', 'settings', 'duplicate', 'pollution', 'version'])('rejects malformed %s before any writes', async kind => {
    const data = fixture();
    switch (kind) {
      case 'key': data.works = { 2: data.works[1] } as never; break;
      case 'missing': data.works = {} as never; break;
      case 'season': data.works[1].seasons = [null] as never; break;
      case 'score': data.works[1].seasons[0].scores.story = 99; break;
      case 'section': data.sections[0].weight = -1; break;
      case 'settings': data.settings = { autoSync: 'yes' }; break;
      case 'duplicate': data.manifest.push({ mediaId: 1 }); break;
      case 'pollution': data.settings = JSON.parse('{"__proto__":{"polluted":true}}'); break;
      case 'version': Object.assign(data, { schemaVersion: 99 }); break;
    }
    const store = storage();
    const repo = new AstraRepository({ emit: vi.fn() } as never, store as never);
    expect(await repo.importJSON(JSON.stringify(data))).toBe(false);
    expect(store.set).not.toHaveBeenCalled();
    expect(store.setMultiple).not.toHaveBeenCalled();
  });
  it('replaces full-work cache, recalculates summaries and publishes only after persistence', async () => {
    const store = storage();
    const bus = { emit: vi.fn() };
    const repo = new AstraRepository(bus as never, store as never);
    await repo.saveWork({ mediaId: 1, notes: 'Cached old notes' });
    store.setMultiple.mockClear();
    bus.emit.mockClear();
    expect(await repo.importJSON(JSON.stringify(fixture()))).toBe(true);
    expect((await repo.getFullWork(1))?.notes).toBe('Original notes');
    expect(repo.getWorks()[0].currentScore).toBe(8);
    expect(store.setMultiple).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledTimes(1);
    const backup = parseAstraBackup(await repo.exportJSON());
    expect(backup.works[1].seasons[0].episodeNotes?.[1].score).toBe(9);
    expect(backup.schemaVersion).toBe(1);
  });
  it('publishes no success on failed apply, and recovers the durable import on restart', async () => {
    const store = storage();
    const bus = { emit: vi.fn() };
    const repo = new AstraRepository(bus as never, store as never);
    await repo.saveWork({ mediaId: 1, notes: 'Keep' });
    const before = repo.getWorks();
    bus.emit.mockClear();
    store.setMultiple.mockResolvedValueOnce(false);
    expect(await repo.importJSON(JSON.stringify(fixture()))).toBe(false);
    expect(repo.getWorks()).toEqual(before);
    expect(bus.emit).not.toHaveBeenCalled();
    const restarted = new AstraRepository({ emit: vi.fn() } as never, store as never);
    expect((await restarted.getFullWork(1))?.notes).toBe('Original notes');
  });
  it('initializes before export and refuses to silently export incomplete works', async () => {
    const store = storage();
    store.data.set('au_astra_manifest', [{ mediaId: 1 }]);
    const repo = new AstraRepository({ emit: vi.fn() } as never, store as never);
    await expect(repo.exportJSON()).rejects.toThrow('Missing Astra work');
  });
});

describe('Astra backup optional dates', () => {
  it.each(['work', 'summary'] as const)('rejects an invalid %s date while preserving originals', async target => {
    const data = fixture(); Object.assign(target === 'work' ? data.works[1] : data.manifest[0], { startedAt: { year: 2026, month: 99, day: null } });
    const store = storage(); const repo = new AstraRepository({ emit: vi.fn() } as never, store as never);
    expect(await repo.importJSON(JSON.stringify(data))).toBe(false); expect(store.setMultiple).not.toHaveBeenCalled();
  });
});

describe('unsupported Astra formats', () => {
  it.each(['versionless', 'legacyScore', 'manualOverride', 'label'])('rejects %s archives before writing anything', async field => {
    const data = fixture() as unknown as Record<string, unknown>;
    if (field === 'versionless') delete data.schemaVersion;
    else Object.assign((data.works as Record<string, { seasons: object[] }>)[1].seasons[0], { [field]: field === 'manualOverride' ? true : field === 'label' ? 'Old season' : 8 });
    const store = storage(); const repo = new AstraRepository({ emit: vi.fn() } as never, store as never);
    expect(await repo.importJSON(JSON.stringify(data))).toBe(false);
    expect(store.set).not.toHaveBeenCalled(); expect(store.setMultiple).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled();
  });
  it('does not unpack or overwrite an object manifest', async () => {
    const store = storage(); const original = { summaries: [{ mediaId: 1 }], sections: [], settings: {} };
    store.data.set('au_astra_manifest', original);
    const repo = new AstraRepository({ emit: vi.fn() } as never, store as never);
    await expect(repo.init()).rejects.toThrow('Invalid Astra manifest');
    expect(store.data.get('au_astra_manifest')).toEqual(original);
    expect(store.set).not.toHaveBeenCalled(); expect(store.setMultiple).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled();
  });
});

describe('parseAstraBackup covers and capacity', () => {
  const base = (cover: unknown) => ({
    schemaVersion: 1, manifest: [{ mediaId: 1 }], sections: [], settings: {}, works: {
      1: { id: 'w_1', mediaId: 1, title: 'Cover fixture', type: 'anime', status: 'CURRENT', notes: '', updatedAt: 1,
        tags: [], seasons: [], cover },
    },
  });

  it.each(['https://img.anilist.co/cover.jpg', 'http://example.com/a.png', ''])('keeps the web cover %j', cover => {
    expect(parseAstraBackup(JSON.stringify(base(cover))).works[1].cover).toBe(cover);
  });

  it.each(['data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://example.com/a.png', '/relative.png'])(
    'imports the work with an empty cover instead of rejecting the backup (%s)', cover => {
      const backup = parseAstraBackup(JSON.stringify(base(cover)));
      expect(backup.works[1].cover).toBe('');
      expect(backup.works[1].title).toBe('Cover fixture');
    });

  it('still rejects a non-string cover with a validation field', () => {
    expect(() => parseAstraBackup(JSON.stringify(base(42)))).toThrow(AstraWorkValidationError);
  });

  it('accepts a full 10,000-entry export (about 13 MB) within the import limit', () => {
    const works: Record<string, unknown> = {};
    const manifest: { mediaId: number }[] = [];
    for (let mediaId = 1; mediaId <= 10_000; mediaId++) {
      manifest.push({ mediaId });
      works[mediaId] = { id: `w_${mediaId}`, mediaId, title: `Title ${mediaId}`, type: 'anime', status: 'CURRENT',
        notes: 'n'.repeat(1_200), updatedAt: 1, tags: [], seasons: [] };
    }
    const json = JSON.stringify({ schemaVersion: 1, manifest, sections: [], settings: {}, works });
    expect(json.length).toBeGreaterThan(12 * 1024 * 1024);
    expect(json.length).toBeLessThan(MAX_ASTRA_BACKUP_CHARACTERS);
    expect(parseAstraBackup(json).manifest).toHaveLength(10_000);
  });
});

describe('parseAstraBackup manual season score', () => {
  const backupWith = (season: Record<string, unknown>) => JSON.stringify({
    schemaVersion: 1, manifest: [{ mediaId: 1 }], sections: [], settings: {}, works: {
      1: { id: 'w_1', mediaId: 1, title: 'Manual fixture', type: 'anime', status: 'CURRENT', notes: '', updatedAt: 1,
        tags: [], seasons: [{ scores: {}, ...season }] },
    },
  });

  it.each([null, 0.1, 7.3, 10, 11])('accepts manualScore %s', (manualScore) => {
    expect(parseAstraBackup(backupWith({ manualScore })).works[1].seasons[0].manualScore).toBe(manualScore);
  });

  it('accepts a season without manualScore', () => {
    expect(parseAstraBackup(backupWith({})).works[1].seasons[0].manualScore).toBeUndefined();
  });

  it.each([0, 0.05, 11.5, -1, '7', 'high', true])('rejects manualScore %j with the SCORES field', (manualScore) => {
    let failure: unknown;
    try { parseAstraBackup(backupWith({ manualScore })); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AstraWorkValidationError);
    expect((failure as AstraWorkValidationError).validationField).toBe('SCORES');
  });
});
