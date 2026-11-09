import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEY, AUTH_SESSION_KEY } from '@shared/messages';
import { STORAGE_PREFIX } from '@core/constants';
import { buildBackup, isBackedUpKey, parseBackup, restoreBackup } from './ExtensionBackup';
import { PAGE_PREFS_MIRROR_KEY, hydratePagePrefs, mirrorPagePref } from './PagePrefsMirror';

const P = STORAGE_PREFIX;

function area(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (_keys: unknown) => Object.fromEntries(data)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) data.delete(key);
    }),
  };
}

describe('backup contents', () => {
  it('keeps preferences, custom lists and Astra; drops login, pending writes and caches', () => {
    expect(isBackedUpKey(`${P}config`)).toBe(true);
    expect(isBackedUpKey('custom_lists_account_local')).toBe(true);
    expect(isBackedUpKey(`${P}astra_account_5_au_astra_manifest`)).toBe(true);
    expect(isBackedUpKey(AUTH_STORAGE_KEY)).toBe(false);
    expect(isBackedUpKey(AUTH_SESSION_KEY)).toBe(false);
    expect(isBackedUpKey(`${P}sync_queue_v1`)).toBe(false);
    expect(isBackedUpKey(`${P}cache_calendar_schedule`)).toBe(false);
    expect(isBackedUpKey(`${P}sync_recovery_abc`)).toBe(false);
  });

  it('round-trips through the file format and rejects other files', () => {
    const backup = buildBackup(
      { [`${P}config`]: { a: 1 } },
      { [AUTH_STORAGE_KEY]: 'secret', custom_lists_account_local: [1] },
      new Date('2026-11-08T10:00:00Z')
    );
    expect(JSON.stringify(backup)).not.toContain('secret');
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.sync).toEqual({ [`${P}config`]: { a: 1 } });
    expect(parsed.local).toEqual({ custom_lists_account_local: [1] });
    expect(() => parseBackup('nope')).toThrow('not a valid backup');
    expect(() => parseBackup('{"format":"other"}')).toThrow('not an AniList Ultimate backup');
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 99 }))).toThrow('newer version');
  });

  it('a tampered file cannot smuggle in a login token', () => {
    const text = JSON.stringify({
      format: 'anilist-ultimate-backup',
      version: 1,
      sync: {},
      local: { [AUTH_STORAGE_KEY]: 'evil' },
    });
    expect(parseBackup(text).local).toEqual({});
  });
});

describe('restoring', () => {
  it('replaces data but leaves the login of this browser alone', async () => {
    const sync = area({ [`${P}config`]: 'old', [`${P}stale`]: 1 });
    const local = area({ [AUTH_STORAGE_KEY]: 'mine', [`${P}cache_x`]: 1, old_list: 1 });
    const backup = parseBackup(
      JSON.stringify({
        format: 'anilist-ultimate-backup',
        version: 1,
        sync: { [`${P}config`]: 'new' },
        local: { new_list: 2, [PAGE_PREFS_MIRROR_KEY]: { values: { k: 'v' } } },
      })
    );
    await restoreBackup(backup, { sync, local }, 1234);
    expect(Object.fromEntries(sync.data)).toEqual({ [`${P}config`]: 'new' });
    expect(local.data.get(AUTH_STORAGE_KEY)).toBe('mine');
    expect(local.data.get(`${P}cache_x`)).toBe(1);
    expect(local.data.has('old_list')).toBe(false);
    expect(local.data.get('new_list')).toBe(2);
    expect(local.data.get(PAGE_PREFS_MIRROR_KEY)).toEqual({ values: { k: 'v' }, restoredAt: 1234 });
  });
});

describe('page preference mirror', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
  const stubChrome = (store: ReturnType<typeof area>) =>
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (key: string) => (store.data.has(key) ? { [key]: store.data.get(key) } : {}),
          set: store.set,
        },
      },
    });

  it('copies saved preferences into extension storage', async () => {
    const store = area();
    stubChrome(store);
    mirrorPagePref('au-watchorder-prefs', '{"mode":"map"}');
    mirrorPagePref('au-section-collapse', '["staff"]');
    await vi.waitFor(() =>
      expect(store.data.get(PAGE_PREFS_MIRROR_KEY)).toEqual({
        values: { 'au-watchorder-prefs': '{"mode":"map"}', 'au-section-collapse': '["staff"]' },
      })
    );
  });

  it('fills a new browser, and overwrites the page once after a restore', async () => {
    const store = area({ [PAGE_PREFS_MIRROR_KEY]: { values: { a: 'mirror', b: 'mirror' } } });
    stubChrome(store);
    window.localStorage.setItem('a', 'page');
    await hydratePagePrefs(['a', 'b']);
    expect(window.localStorage.getItem('a')).toBe('page');
    expect(window.localStorage.getItem('b')).toBe('mirror');

    store.data.set(PAGE_PREFS_MIRROR_KEY, { values: { a: 'restored' }, restoredAt: 50 });
    await hydratePagePrefs(['a']);
    expect(window.localStorage.getItem('a')).toBe('restored');
    window.localStorage.setItem('a', 'changed later');
    await hydratePagePrefs(['a']);
    expect(window.localStorage.getItem('a')).toBe('changed later');
  });
});
