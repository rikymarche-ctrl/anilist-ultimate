import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import { AstraRepository } from './AstraRepository';
import { AstraRepositoryHost } from './AstraRepositoryHost';
import { AstraRepositoryClient } from './AstraRepositoryClient';
import { ASTRA_KEYS } from './AstraPersistence';

function fixture() {
  const data = new Map<string, unknown>();
  const store = {
    get: vi.fn(async (key: string) => structuredClone(data.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }),
    setMultiple: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))); return true; }),
    remove: vi.fn(async (key: string) => { data.delete(key); return true; }),
    onChange: vi.fn(() => () => {}),
  };
  const bus = new EventBus();
  const repo = new AstraRepository(bus, store as never);
  return { repo, store, data, bus, restart: () => new AstraRepository(new EventBus(), store as never) };
}
describe('Astra durable commits and cross-tab writer', () => {
  beforeEach(() => { chrome.runtime.id = 'extension-test'; chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never; });
  it('recovers a partial batch from the redo journal on restart', async () => {
    const { repo, store, data, restart } = fixture();
    await repo.saveWork({ mediaId: 1, notes: 'Original' });
    store.setMultiple.mockImplementationOnce(async items => { data.set(`${ASTRA_KEYS.workPrefix}1`, structuredClone(items[`${ASTRA_KEYS.workPrefix}1`])); return false; });
    await expect(repo.saveWork({ mediaId: 1, notes: 'New' })).rejects.toThrow('pending recovery');
    expect(repo.getWorks()[0].updatedAt).not.toBe((data.get(`${ASTRA_KEYS.workPrefix}1`) as { updatedAt: number }).updatedAt);
    expect(data.has(ASTRA_KEYS.journal)).toBe(true);
    const restored = restart();
    expect((await restored.getFullWork(1))?.notes).toBe('New');
    expect(restored.getWorks()[0].updatedAt).toBe((await restored.getFullWork(1))?.updatedAt);
    expect(data.has(ASTRA_KEYS.journal)).toBe(false);
  });
  it.each(['removal', 'finalization'])('finishes an interrupted delete after %s failure', async phase => {
    const { repo, store, data, restart } = fixture();
    await repo.saveWork({ mediaId: 1 });
    const remove = store.remove.getMockImplementation()!;
    store.remove.mockImplementation(async key => key === (phase === 'removal' ? `${ASTRA_KEYS.workPrefix}1` : ASTRA_KEYS.journal) ? false : remove(key));
    await expect(repo.deleteWork(1)).rejects.toThrow('pending recovery');
    expect(repo.getWorks()).toHaveLength(1);
    store.remove.mockImplementation(remove);
    const restored = restart();
    expect(await restored.getFullWork(1)).toBeUndefined();
    expect(restored.getWorks()).toHaveLength(0);
    expect(data.has(`${ASTRA_KEYS.workPrefix}1`)).toBe(false);
  });
  it('rejects an obsolete full draft instead of overwriting newer notes', async () => {
    const { repo } = fixture();
    await repo.saveWork({ mediaId: 1, notes: 'Original' });
    const a = (await repo.getFullWork(1))!;
    const b = structuredClone(a);
    a.notes = 'First tab';
    b.notes = 'Second tab';
    await repo.saveWork(a);
    await expect(repo.saveWork(b)).rejects.toThrow('changed in another operation');
    expect((await repo.getFullWork(1))?.notes).toBe('First tab');
  });
  it('does not publish settings before persistence and refreshes scores when weights change', async () => {
    const { repo, store } = fixture();
    await repo.saveWork({ mediaId: 1, seasons: [{ scores: { story: 8, animation: 2 } }] });
    const previous = repo.getSections();
    store.set.mockResolvedValueOnce(false);
    await expect(repo.updateSectionWeight('story', 99)).rejects.toThrow();
    expect(repo.getSections()).toEqual(previous);
    await repo.updateSectionWeight('story', 99);
    expect(repo.getWorks()[0].currentScore).toBeGreaterThan(7);
  });
  it('preserves corrupted journals without applying arbitrary keys', async () => {
    const { repo, data, store } = fixture();
    data.set(ASTRA_KEYS.journal, { version: 1, writes: { anilist_ultimate_auth_token: 'injected' }, removals: [] });
    await expect(repo.init()).rejects.toThrow('Invalid Astra recovery journal');
    expect(store.setMultiple).not.toHaveBeenCalled();
    expect(data.has(ASTRA_KEYS.journal)).toBe(true);
  });
  it('keeps bulk works and manifest in one recoverable operation', async () => {
    const { repo, store } = fixture();
    await repo.saveWorks(Array.from({ length: 50 }, (_, i) => ({ mediaId: i + 1, notes: 'Batch' })));
    expect(store.setMultiple).toHaveBeenCalledTimes(1);
    expect(repo.getWorks()).toHaveLength(50);
    expect(store.setMultiple.mock.calls[0][0][ASTRA_KEYS.manifest]).toHaveLength(50);
  });
  it('serializes writes from two tab clients and reports stale draft conflicts across RPC', async () => {
    const { store, bus } = fixture();
    const auth = { ensureInitialized: async () => {}, getSessionId: () => 'test', hasToken: () => true, getUserCache: () => ({ userId: 42 }) };
    const host = new AstraRepositoryHost(bus, store as never, auth as never);
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn(), undefined, () => host);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => new Promise(resolve => {
      handle(message, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve);
    })) as never);
    const a = new AstraRepositoryClient(new EventBus(), store as never, auth as never);
    const b = new AstraRepositoryClient(new EventBus(), store as never, auth as never);
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).saveWork({ mediaId: i + 1 })));
    expect((await a.getSnapshot()).summaries).toHaveLength(20);
    expect((await b.getSnapshot()).revision).toBe(20);
    const old = (await b.getFullWork(1))!;
    await a.saveWork({ mediaId: 1, notes: 'Fresh' });
    await expect(b.saveWork({ ...old, notes: 'Stale' })).rejects.toThrow('changed in another operation');
    expect((await a.getFullWork(1))?.notes).toBe('Fresh');
    a.dispose(); b.dispose();
  });
  it('rejects invalid and nonallowlisted repository commands without writes', async () => {
    const { store, bus } = fixture();
    const auth = { ensureInitialized: async () => {}, getSessionId: () => 'test', hasToken: () => true, getUserCache: () => ({ userId: 42 }) };
    const host = new AstraRepositoryHost(bus, store as never, auth as never);
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn(), undefined, () => host);
    for (const [command, args] of [['constructor', []], ['deleteWork', [-1]], ['updateSettings', [{ unexpected: true }]], ['updateSectionWeight', ['story', -1]]]) {
      const response = await new Promise<{ success: boolean }>(resolve => handle({ type: 'astra:command', command, args, sessionId: 'test' }, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve as never));
      expect(response.success).toBe(false);
    }
    expect(store.set).not.toHaveBeenCalled();
  });
});
