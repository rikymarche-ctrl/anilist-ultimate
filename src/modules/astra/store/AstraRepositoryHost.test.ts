import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { AstraRepositoryHost } from './AstraRepositoryHost';
import { ASTRA_KEYS } from './AstraPersistence';

function fixture(owner: number | null = 1) {
  const data = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => structuredClone(data.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }),
    setMultiple: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))); return true; }),
    remove: vi.fn(async (key: string) => { data.delete(key); return true; }),
    onChange: vi.fn(() => () => {}),
  };
  let session = 'first';
  const auth = { ensureInitialized: async () => {}, hasToken: () => owner !== null,
    getUserCache: () => owner === null ? null : { userId: owner, userName: 'User' }, getSessionId: () => session };
  const host = new AstraRepositoryHost(new EventBus(), storage as never, auth as never);
  return { host, data, storage, auth,
    switchTo: (next: number | null) => { owner = next; session = `session-${next}`; },
    command: (name: string, args: unknown[] = []) => host.dispatch(name, args, session),
  };
}
describe('Astra account namespaces without archive migration', () => {
  it('never reads, imports, associates or removes the unscoped archive even with a saved owner marker', async () => {
    const f = fixture();
    const originals = { [ASTRA_KEYS.manifest]: [{ mediaId: 7 }], [`${ASTRA_KEYS.workPrefix}7`]: { notes: 'Original private notes' }, astra_legacy_owner_v1: { ownerId: 1 } };
    Object.entries(originals).forEach(([key, value]) => f.data.set(key, value));
    await f.host.initialize();
    expect(await f.command('getFullWork', [7])).toBeUndefined();
    f.switchTo(null); expect(await f.command('getFullWork', [7])).toBeUndefined();
    f.switchTo(2); expect(await f.command('getFullWork', [7])).toBeUndefined();
    for (const [key, value] of Object.entries(originals)) { expect(f.data.get(key)).toEqual(value); expect(f.storage.get).not.toHaveBeenCalledWith(key); }
    expect(f.storage.set).not.toHaveBeenCalled(); expect(f.storage.setMultiple).not.toHaveBeenCalled(); expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('isolates saves across account changes and logout', async () => {
    const f = fixture(); await f.host.initialize();
    const first = await f.command('saveWork', [{ mediaId: 1, notes: 'First account' }]);
    f.switchTo(2); expect(await f.command('getFullWork', [1])).toBeUndefined();
    await expect(f.command('saveWork', [{ ...first as object, notes: 'Wrong account' }])).rejects.toThrow('another account');
    await f.command('saveWork', [{ mediaId: 1, notes: 'Second account' }]);
    f.switchTo(null); expect(await f.command('getFullWork', [1])).toBeUndefined();
    await f.command('saveWork', [{ mediaId: 1, notes: 'Local workspace' }]);
    f.switchTo(1); expect(await f.command('getFullWork', [1])).toMatchObject({ notes: 'First account', ownerId: 1 });
    f.switchTo(2); expect(await f.command('getFullWork', [1])).toMatchObject({ notes: 'Second account', ownerId: 2 });
    f.switchTo(null); expect(await f.command('getFullWork', [1])).toMatchObject({ notes: 'Local workspace', ownerId: null });
  });
  it.each(['exportLegacy', 'claimLegacy'])('rejects removed %s recovery commands before any storage access', async operation => {
    const f = fixture(); await expect(f.host.recovery(operation, 'first')).rejects.toThrow('Invalid Astra recovery command');
    expect(f.storage.get).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled(); expect(f.storage.setMultiple).not.toHaveBeenCalled();
  });
  it('refuses workspace operations when the session is unavailable', async () => {
    const f = fixture(null); f.auth.getSessionId = () => '';
    await expect(f.host.dispatch('saveWork', [{ mediaId: 7 }], '')).rejects.toThrow('account changed'); expect(f.data.size).toBe(0);
  });
  it('rejects stale session commands before accessing an account repository', async () => {
    const f = fixture(); await f.host.initialize(); f.switchTo(2);
    await expect(f.host.dispatch('saveWork', [{ mediaId: 1 }], 'first')).rejects.toThrow('account changed'); expect(f.data.size).toBe(0);
  });
  it('preserves explicit copy and export of the current local workspace', async () => {
    const f = fixture(null); await f.command('saveWork', [{ mediaId: 7, notes: 'Current local notes' }]);
    f.switchTo(1); expect(await f.host.recovery('exportLocal', f.auth.getSessionId())).toContain('Current local notes');
    await f.host.recovery('claimLocal', f.auth.getSessionId());
    expect(await f.command('getFullWork', [7])).toMatchObject({ notes: 'Current local notes', ownerId: 1 });
    f.switchTo(null); expect(await f.command('getFullWork', [7])).toMatchObject({ notes: 'Current local notes', ownerId: null });
  });
  it('refuses to replace a nonempty current archive when copying a local workspace', async () => {
    const f = fixture(); await f.command('saveWork', [{ mediaId: 9, notes: 'Current' }]);
    await expect(f.host.recovery('claimLocal', f.auth.getSessionId())).rejects.toThrow('not empty');
    expect(await f.command('getFullWork', [9])).toMatchObject({ notes: 'Current' });
  });
});
