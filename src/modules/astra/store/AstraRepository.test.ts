import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AstraRepository } from './AstraRepository';

function makeStorage() {
  const data = new Map<string, any>();
  return {
    data,
    get: vi.fn(async (k: string) => (data.has(k) ? data.get(k) : null)),
    set: vi.fn(async (k: string, v: any) => {
      data.set(k, v);
      return true;
    }),
    remove: vi.fn(async (k: string) => {
      data.delete(k);
      return true;
    }),
  } as any;
}

const makeEventBus = () => ({ emit: vi.fn(), on: vi.fn() }) as any;

describe('AstraRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves a work and exposes it as a summary', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());

    await repo.saveWork({ mediaId: 1, title: 'Frieren', status: 'COMPLETED' as any });

    const works = repo.getWorks();
    expect(works).toHaveLength(1);
    expect(works[0].mediaId).toBe(1);
    expect(works[0].title).toBe('Frieren');
  });

  it('skipPersist=true writes the work but defers the manifest write', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);

    await repo.saveWork({ mediaId: 2, title: 'X' }, true);

    const setKeys = storage.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys.some((k: string) => k.includes('au_astra_work_'))).toBe(true);
    expect(setKeys).not.toContain('au_astra_manifest');
  });

  it('persists the manifest when skipPersist is omitted', async () => {
    const storage = makeStorage();
    const repo = new AstraRepository(makeEventBus(), storage);

    await repo.saveWork({ mediaId: 3, title: 'Y' });

    const setKeys = storage.set.mock.calls.map((c: any[]) => c[0]);
    expect(setKeys).toContain('au_astra_manifest');
  });

  it('getSections returns a defensive copy (callers cannot mutate internals)', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    const original = repo.getSections().length;
    const sections = repo.getSections();
    sections.push({ id: 'hacked' } as any);

    expect(repo.getSections().length).toBe(original);
  });

  it('getSettings returns a defensive copy', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    const settings = repo.getSettings() as any;
    settings.enableSeriesFinale = !settings.enableSeriesFinale;

    expect(repo.getSettings()).not.toBe(settings);
  });

  it('factoryReset removes all au_astra_* storage keys via chrome.storage.local', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.init();

    const chromeLocal = (globalThis as any).chrome.storage.local;
    chromeLocal.get.mockResolvedValueOnce({
      anilist_ultimate_au_astra_manifest: [],
      anilist_ultimate_au_astra_work_1: { mediaId: 1 },
      anilist_ultimate_unrelated_key: 'keep-me',
    });

    await repo.factoryReset();

    expect(chromeLocal.remove).toHaveBeenCalledTimes(1);
    const removed = chromeLocal.remove.mock.calls[0][0] as string[];
    expect(removed).toContain('anilist_ultimate_au_astra_manifest');
    expect(removed).toContain('anilist_ultimate_au_astra_work_1');
    expect(removed).not.toContain('anilist_ultimate_unrelated_key');
  });

  it('deleteWork removes the work from the manifest', async () => {
    const repo = new AstraRepository(makeEventBus(), makeStorage());
    await repo.saveWork({ mediaId: 5, title: 'Z' });
    expect(repo.getWorks()).toHaveLength(1);

    await repo.deleteWork(5);

    expect(repo.getWorks()).toHaveLength(0);
  });
});
