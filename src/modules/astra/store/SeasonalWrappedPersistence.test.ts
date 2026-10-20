import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { AstraRepositoryHost } from './AstraRepositoryHost';
import { emptySeasonalChoices } from '../services/SeasonalWrappedModel';
import { parseAstraBackup } from './AstraBackup';

function fixture() {
  const data = new Map<string, unknown>(); let owner = 42; let session = 'one';
  const storage = { get: async (key: string) => structuredClone(data.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }),
    setMultiple: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value)); return true; }),
    remove: async (key: string) => { data.delete(key); return true; } };
  const auth = { ensureInitialized: async () => {}, hasToken: () => owner !== 0, getSessionId: () => session, getUserCache: () => ({ userId: owner }) };
  const makeHost = () => new AstraRepositoryHost(new EventBus(), storage as never, auth as never);
  let host = makeHost();
  const command = (name: string, args: unknown[] = []) => host.dispatch(name, args, session);
  return { data, storage, command, switchAccount: (id: number) => { owner = id; session = `session-${id}`; }, restart: () => { host = makeHost(); } };
}

describe('Seasonal Wrapped durable account choices', () => {
  it('persists across host recreation, backup restore and account/logout switches', async () => {
    const f = fixture();
    const saved = await f.command('saveSeasonalChoices', ['2026-SPRING', { ...emptySeasonalChoices(), awards: { favorite: 1 }, confirmedMediaIds: [1] }]);
    f.restart();
    const json = await f.command('exportJSON') as string;
    expect(parseAstraBackup(json).seasonalWrapped?.['2026-SPRING']).toEqual(saved);
    f.switchAccount(43); expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped).toBeUndefined();
    f.switchAccount(0); expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped).toBeUndefined();
    f.switchAccount(42); await f.command('factoryReset');
    expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped).toBeUndefined();
    expect(await f.command('importJSON', [json])).toBe(true);
    expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped?.['2026-SPRING']).toEqual(saved);
  });
  it('rejects stale concurrent edits rather than overwriting picks from another tab', async () => {
    const f = fixture(); const first = { ...emptySeasonalChoices(), awards: { favorite: 1 } };
    const writes = await Promise.allSettled([f.command('saveSeasonalChoices', ['2026-SPRING', first]), f.command('saveSeasonalChoices', ['2026-SPRING', first])]);
    expect(writes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped?.['2026-SPRING'].awards).toEqual({ favorite: 1 });
  });
  it('leaves a failed commit durable and finishes it on recreation', async () => {
    const f = fixture(); f.storage.setMultiple.mockResolvedValueOnce(false);
    await expect(f.command('saveSeasonalChoices', ['2026-SPRING', { ...emptySeasonalChoices(), awards: { discovery: 2 } }])).rejects.toThrow();
    f.restart();
    expect(parseAstraBackup(await f.command('exportJSON') as string).seasonalWrapped?.['2026-SPRING'].awards).toEqual({ discovery: 2 });
  });
  it('rejects malformed commands and backups before writing', async () => {
    const f = fixture();
    await expect(f.command('saveSeasonalChoices', ['bad', emptySeasonalChoices()])).rejects.toThrow();
    await expect(f.command('saveSeasonalChoices', ['2026-SPRING', { ...emptySeasonalChoices(), awards: { favorite: -1 } }])).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled();
    const json = JSON.parse(await f.command('exportJSON') as string); json.seasonalWrapped = { bad: {} };
    expect(() => parseAstraBackup(JSON.stringify(json))).toThrow();
  });
});
