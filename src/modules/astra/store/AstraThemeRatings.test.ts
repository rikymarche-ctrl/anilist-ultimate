import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { AstraRepositoryHost } from './AstraRepositoryHost';
import { parseAstraBackup } from './AstraBackup';
import {
  themeAverages,
  validateThemeRatingArchive,
  withThemeRating,
  withThemesPrompted,
  type ThemeMediaRatings,
} from './AstraThemeRatings';

const OP1 = '5:OP:1:guren-no-yumiya';
const ED1 = '5:ED:1:utsukushiki-zankoku-na-sekai';

function fixture() {
  const data = new Map<string, unknown>();
  let owner = 42;
  let session = 'one';
  const storage = {
    get: async (key: string) => structuredClone(data.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
      return true;
    }),
    setMultiple: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
      return true;
    }),
    remove: async (key: string) => {
      data.delete(key);
      return true;
    },
  };
  const auth = {
    ensureInitialized: async () => {},
    hasToken: () => owner !== 0,
    getSessionId: () => session,
    getUserCache: () => ({ userId: owner }),
  };
  const makeHost = () => new AstraRepositoryHost(new EventBus(), storage as never, auth as never);
  let host = makeHost();
  const command = (name: string, args: unknown[] = []) => host.dispatch(name, args, session);
  return {
    data,
    storage,
    command,
    switchAccount: (id: number) => {
      owner = id;
      session = `session-${id}`;
    },
    restart: () => {
      host = makeHost();
    },
  };
}

describe('theme rating persistence', () => {
  it('stores, clears and reloads per-song ratings in the account scope', async () => {
    const f = fixture();
    await f.command('saveThemeRating', [
      5,
      OP1,
      { score: 8.5, kind: 'OP', title: 'Guren no Yumiya' },
    ]);
    await f.command('saveThemeRating', [5, ED1, { score: 7, kind: 'ED', title: 'Utsukushiki' }]);
    f.restart();
    const stored = (await f.command('getThemeRatings', [5])) as ThemeMediaRatings;
    expect(Object.keys(stored.ratings)).toEqual([OP1, ED1]);
    expect(stored.ratings[OP1].score).toBe(8.5);
    expect([...f.data.keys()]).toContain('astra_account_42_au_astra_theme_ratings');

    const cleared = (await f.command('saveThemeRating', [5, ED1, null])) as ThemeMediaRatings;
    expect(Object.keys(cleared.ratings)).toEqual([OP1]);

    f.switchAccount(43);
    expect(((await f.command('getThemeRatings', [5])) as ThemeMediaRatings).ratings).toEqual({});
  });

  it('round-trips through the Astra backup and factory reset', async () => {
    const f = fixture();
    await f.command('saveThemeRating', [5, OP1, { score: 9, kind: 'OP', title: 'A' }]);
    const json = (await f.command('exportJSON')) as string;
    expect(parseAstraBackup(json).themeRatings?.['5'].ratings[OP1].score).toBe(9);
    await f.command('factoryReset');
    expect(((await f.command('getThemeRatings', [5])) as ThemeMediaRatings).ratings).toEqual({});
    expect(await f.command('importJSON', [json])).toBe(true);
    expect(
      ((await f.command('getThemeRatings', [5])) as ThemeMediaRatings).ratings[OP1].score
    ).toBe(9);
  });

  it('keeps stored ratings when importing an older backup without them', async () => {
    const f = fixture();
    const old = (await f.command('exportJSON')) as string;
    await f.command('saveThemeRating', [5, OP1, { score: 6, kind: 'OP', title: 'A' }]);
    expect(await f.command('importJSON', [old])).toBe(true);
    expect(
      ((await f.command('getThemeRatings', [5])) as ThemeMediaRatings).ratings[OP1].score
    ).toBe(6);
  });

  it('remembers prompted songs without rating them', async () => {
    const f = fixture();
    const saved = (await f.command('markThemesPrompted', [5, [ED1, ED1]])) as ThemeMediaRatings;
    expect(saved).toEqual({ ratings: {}, prompted: [ED1] });
  });

  it('rejects malformed commands before writing', async () => {
    const f = fixture();
    await expect(
      f.command('saveThemeRating', [5, 'bad id', { score: 5, kind: 'OP', title: 'A' }])
    ).rejects.toThrow();
    await expect(
      f.command('saveThemeRating', [5, OP1, { score: 11, kind: 'OP', title: 'A' }])
    ).rejects.toThrow();
    await expect(
      f.command('saveThemeRating', [5, OP1, { score: 5.55, kind: 'OP', title: 'A' }])
    ).rejects.toThrow();
    await expect(
      f.command('saveThemeRating', [6, OP1, { score: 5, kind: 'OP', title: 'A' }])
    ).rejects.toThrow();
    expect(f.storage.set).not.toHaveBeenCalled();
  });
});

describe('theme rating model', () => {
  it('updates immutably and drops empty media entries', () => {
    const empty = {};
    const one = withThemeRating(empty, 5, OP1, { score: 7.3, kind: 'OP', title: 'A' }, 10);
    expect(empty).toEqual({});
    expect(one['5'].ratings[OP1]).toEqual({ score: 7.3, kind: 'OP', title: 'A', updatedAt: 10 });
    expect(withThemeRating(one, 5, OP1, null)).toEqual({});
    expect(withThemesPrompted(one, 5, [ED1])['5'].prompted).toEqual([ED1]);
  });

  it('averages each kind separately', () => {
    const ratings = {
      [OP1]: { score: 8, kind: 'OP' as const, title: '', updatedAt: 0 },
      '5:ED:1:a': { score: 8, kind: 'ED' as const, title: '', updatedAt: 0 },
      '5:ED:2:b': { score: 7, kind: 'ED' as const, title: '', updatedAt: 0 },
    };
    expect(themeAverages(ratings)).toEqual({ OP: 8, ED: 7.5 });
    expect(themeAverages({})).toEqual({ OP: null, ED: null });
  });

  it('rejects foreign ids and unsafe keys in an archive', () => {
    expect(() =>
      validateThemeRatingArchive({
        5: { ratings: { '6:OP:1:a': { score: 5, kind: 'OP', title: '', updatedAt: 0 } } },
      })
    ).toThrow();
    expect(() => validateThemeRatingArchive({ abc: { ratings: {} } })).toThrow();
    expect(() =>
      validateThemeRatingArchive(JSON.parse('{"5":{"ratings":{"__proto__":{}}}}'))
    ).toThrow();
  });
});
