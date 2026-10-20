import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_STATE_MAX_ENTRIES, PAGE_STATE_STORAGE_KEY, PageStateStore } from './PageStateStore';
import { parsePageStateSnapshot, type PageStateSnapshot } from './PageStateTypes';
import {
  currentHistoryEntryKey,
  isRestorablePath,
  pageStateKey,
  resolveCurrentPage,
  resolveRestorablePageKind,
} from './PageStateRoutes';

const filters = {
  view: 2,
  title: 'gundam',
  format: 'OVA',
  status: null,
  genres: ['Action', 'Mecha'],
  country: 'Japan',
  year: 2010,
  sort: 'Score',
};
const snapshot = (overrides: Partial<PageStateSnapshot> = {}): PageStateSnapshot => ({
  key: 'url:/user/Friend/animelist/Planning',
  url: '/user/Friend/animelist/Planning',
  kind: 'mediaList',
  scrollY: 1800,
  loaded: 120,
  loaderIndex: null,
  filters,
  capturedAt: 1_700_000_000_000,
  ...overrides,
});

describe('restorable routes and history keys', () => {
  it.each([
    ['/user/Friend/animelist', 'mediaList'],
    ['/user/Friend/mangalist/Planning', 'mediaList'],
    ['/user/Friend/animelist/Completed%20TV/', 'mediaList'],
    ['/user/Friend/animelist/compare', 'scrollLoader'],
    ['/search/anime?format=OVA', 'scrollLoader'],
    ['/home', 'scrollLoader'],
    ['/user/Friend', 'scrollLoader'],
    ['/user/a/b/animelist', 'scrollLoader'],
  ])('resolves %s as %s', (path, kind) => {
    expect(resolveRestorablePageKind(path)).toBe(kind);
    // Any page may hold a scroll loader: the module runs everywhere.
    expect(isRestorablePath(path)).toBe(true);
  });
  it('prefers the history entry key and falls back to the URL', () => {
    expect(pageStateKey('/search/anime?format=OVA', 'abc')).toBe('entry:abc');
    expect(pageStateKey('/search/anime?format=OVA', null)).toBe('url:/search/anime?format=OVA');
    expect(currentHistoryEntryKey({ navigation: { currentEntry: { key: 'k1' } } })).toBe('k1');
    expect(currentHistoryEntryKey({ navigation: { currentEntry: { key: 42 } } })).toBeNull();
    expect(currentHistoryEntryKey({})).toBeNull();
    expect(resolveCurrentPage({ pathname: '/search/anime', search: '?search=x' }, 'k2')).toEqual({
      kind: 'scrollLoader',
      url: '/search/anime?search=x',
      key: 'entry:k2',
    });
    expect(resolveCurrentPage({ pathname: '/home', search: '' }, null).key).toBe('url:/home');
  });
});

describe('snapshot validation', () => {
  it('accepts a well-formed snapshot and copies its genres', () => {
    const parsed = parsePageStateSnapshot(JSON.parse(JSON.stringify(snapshot())));
    expect(parsed).toEqual(snapshot());
    expect(
      parsePageStateSnapshot({ ...snapshot(), kind: 'scrollLoader', loaderIndex: 2, filters: null })
        ?.loaderIndex
    ).toBe(2);
  });
  it.each([
    ['unknown kind', { kind: 'forum' }],
    ['relative url', { url: 'user/Friend/animelist' }],
    ['empty key', { key: '' }],
    ['negative scroll', { scrollY: -1 }],
    ['fractional amount', { loaded: 1.5 }],
    ['missing amount', { loaded: undefined }],
    ['negative loader index', { loaderIndex: -1 }],
    ['huge loader index', { loaderIndex: 51 }],
    ['huge scroll', { scrollY: 1e12 }],
    ['non-finite date', { capturedAt: Number.NaN }],
    ['bad filters', { filters: { ...filters, genres: 'Action' } }],
    ['empty genre', { filters: { ...filters, genres: [''] } }],
    ['oversized text', { filters: { ...filters, format: 'x'.repeat(201) } }],
    ['missing view', { filters: { ...filters, view: undefined } }],
    [
      'too many genres',
      { filters: { ...filters, genres: Array.from({ length: 51 }, (_, i) => `g${i}`) } },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(parsePageStateSnapshot({ ...snapshot(), ...overrides })).toBeNull();
  });
  it.each([null, 'snapshot', [snapshot()], 42])('rejects non-object %j', (value) => {
    expect(parsePageStateSnapshot(value)).toBeNull();
  });
});

describe('PageStateStore', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves, replaces and deletes snapshots by key', () => {
    const store = new PageStateStore();
    store.save(snapshot());
    store.save(snapshot({ scrollY: 300 }));
    expect(store.get(snapshot().key)?.scrollY).toBe(300);
    store.delete(snapshot().key);
    expect(store.get(snapshot().key)).toBeNull();
  });
  it('survives a new document through sessionStorage', () => {
    new PageStateStore().save(snapshot());
    expect(new PageStateStore().get(snapshot().key)).toEqual(snapshot());
  });
  it('evicts the least recently saved entries beyond the cap', () => {
    const store = new PageStateStore();
    for (let i = 0; i <= PAGE_STATE_MAX_ENTRIES; i++) store.save(snapshot({ key: `entry:${i}` }));
    store.save(snapshot({ key: 'entry:1', scrollY: 5 }));
    store.save(snapshot({ key: 'entry:new' }));
    expect(store.get('entry:0')).toBeNull();
    expect(store.get('entry:2')).toBeNull();
    expect(store.get('entry:1')?.scrollY).toBe(5);
    expect(JSON.parse(sessionStorage.getItem(PAGE_STATE_STORAGE_KEY)!)).toHaveLength(
      PAGE_STATE_MAX_ENTRIES
    );
  });
  it('drops tampered or malformed persisted entries and keeps valid ones', () => {
    sessionStorage.setItem(
      PAGE_STATE_STORAGE_KEY,
      JSON.stringify([{ ...snapshot(), key: 'entry:bad', scrollY: 'top' }, snapshot()])
    );
    const store = new PageStateStore();
    expect(store.get('entry:bad')).toBeNull();
    expect(store.get(snapshot().key)).toEqual(snapshot());
    sessionStorage.setItem(PAGE_STATE_STORAGE_KEY, '{not json');
    expect(new PageStateStore().get(snapshot().key)).toBeNull();
  });
  it('keeps working in memory when sessionStorage throws', () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const store = new PageStateStore();
    expect(() => store.save(snapshot())).not.toThrow();
    expect(store.get(snapshot().key)).toEqual(snapshot());
  });
});
