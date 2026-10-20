import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { EventBus } from '@core/events/EventBus';
import { localStorage } from '@/test/storage-fixtures';
import { MediaMusicModule } from './MediaMusicModule';
import { MUSIC_CACHE_TTL_MS, MUSIC_EMPTY_CACHE_TTL_MS, createMusicThemeCache } from './MediaMusicResponse';


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

describe('media music data boundaries', () => {
  const modules: MediaMusicModule[] = [];
  beforeEach(() => {
    vi.clearAllMocks(); history.replaceState({}, '', '/anime/1/title');
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    document.body.innerHTML = '<div class="overview"><div>Content</div></div>';
    vi.mocked(localStorage.get).mockResolvedValue(null); vi.mocked(localStorage.set).mockResolvedValue(true);
  });
  afterEach(async () => {
    for (const module of modules.splice(0)) await module.destroy();
    vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = '';
  });
  function setup() {
    let context: ApiContext = { sessionId: 'one', userId: 1 };
    const api = { query: vi.fn(async (): Promise<unknown> => ({ Media: { id: 1, type: 'ANIME', idMal: 100,
      title: { english: 'Anime', romaji: 'Anime', native: null } } })),
      ensureContext: vi.fn(async () => context), getContext: () => context };
    const fetchMock = vi.fn(async (): Promise<unknown> => ({ success: true, data: { data: { openings: ['Song'], endings: [] } } }));
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(fetchMock as never);
    const observer = { register: vi.fn((_name: string, _callback: () => void) => {}), unregister: vi.fn() };
    const module = new MediaMusicModule(api as unknown as IApiClient, { error: vi.fn() } as never,
      { isFeatureEnabled: () => true } as never, observer as never, new EventBus(), localStorage as never);
    modules.push(module);
    return { module, api, observer, fetchMock, process: () => (module as unknown as { renderMusicThemesInternal(): Promise<void> }).renderMusicThemesInternal(),
      changeAccount: () => { context = { sessionId: 'two', userId: 2 }; } };
  }

  it.each([{}, { Media: null }, { Media: { id: 2, type: 'ANIME', idMal: 100 } }, { Media: { id: 1, type: 'MANGA', idMal: 100 } },
    { Media: { id: 1, type: 'ANIME' } }, { Media: { id: 1, type: 'ANIME', idMal: -1 } }, { Media: { id: 1, type: 'ANIME', idMal: '100' } }])('rejects malformed or mismatched AniList responses without marking them as a MAL-less anime: %j', async response => {
    const f = setup(); f.api.query.mockResolvedValue(response); await f.process(); await f.process();
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(localStorage.set).not.toHaveBeenCalled();
    expect(document.querySelector('.overview')?.hasAttribute('data-au-music')).toBe(false);
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });

  it('requests theme data through the extension background using only the MAL ID', async () => {
    const f = setup(); await f.process();
    expect(f.fetchMock).toHaveBeenCalledWith({ type: 'media:music-themes', idMal: 100 });
  });

  it('finds Jikan themes by an exact AniList title when AniList has no MAL ID', async () => {
    const f = setup(); f.api.query.mockResolvedValue({ Media: { id: 1, type: 'ANIME', idMal: null,
      title: { english: 'Romelia War Chronicle', romaji: 'Romeria Senki', native: null } } });
    f.fetchMock.mockResolvedValueOnce({ success: true, data: { data: [
      { malId: 100, title: 'Romeria Senki', titleEnglish: 'Romelia War Chronicle' },
    ] } });
    await f.process();
    expect(f.fetchMock).toHaveBeenNthCalledWith(1, { type: 'media:music-search', title: 'Romelia War Chronicle' });
    expect(f.fetchMock).toHaveBeenNthCalledWith(2, { type: 'media:music-themes', idMal: 100 });
    expect(document.querySelector('.au-music-section')?.textContent).toContain('Song');
  });

  it.each([{ openings: [42], endings: [] }, { openings: ['Song'] }, { openings: [], endings: 'Ending' }])('does not cache malformed Jikan theme data: %j', async data => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: true, data: { data } });
    await f.process(); expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it('accepts explicit null theme arrays as empty without accepting missing fields', async () => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: true, data: { data: { openings: null, endings: ['Ending'] } } });
    await f.process(); expect(document.querySelector('.au-music-section')?.textContent).toContain('Ending');
  });

  it('refetches malformed cached themes instead of throwing during song rendering', async () => {
    const f = setup(); vi.mocked(localStorage.get).mockResolvedValue({ openings: [42], endings: [] });
    await f.process(); expect(f.api.query).toHaveBeenCalledOnce(); expect(document.querySelector('.au-music-section')?.textContent).toContain('Song');
  });

  it('does not publish a request result after the account changes', async () => {
    const f = setup(); const response = deferred<unknown>(); f.api.query.mockReturnValue(response.promise);
    const pending = f.process(); await vi.waitFor(() => expect(f.api.query).toHaveBeenCalledOnce());
    f.changeAccount(); response.resolve({ Media: { id: 1, type: 'ANIME', idMal: 100 } }); await pending;
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(localStorage.set).not.toHaveBeenCalled();
    expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it('does not cache a late Jikan response after navigation', async () => {
    const f = setup(); const response = deferred<unknown>(); f.fetchMock.mockReturnValue(response.promise);
    const pending = f.process(); await vi.waitFor(() => expect(f.fetchMock).toHaveBeenCalledOnce());
    history.replaceState({}, '', '/anime/2/other');
    response.resolve({ success: true, data: { data: { openings: ['Old song'], endings: [] } } }); await pending;
    expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it.each([0, -1, 1.5, NaN, 2147483648])('rejects invalid MAL request ID %s before constructing an external URL', async idMal => {
    const f = setup(); await f.module.renderMusicThemes(1, idMal); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it('refetches an expired public cache instead of rendering stale theme titles', async () => {
    const f = setup(); vi.mocked(localStorage.get).mockResolvedValue(createMusicThemeCache(1,
      { openings: ['Expired song'], endings: [] }, Date.now() - MUSIC_CACHE_TTL_MS));
    await f.process(); expect(f.api.query).toHaveBeenCalledOnce();
    expect(document.querySelector('.au-music-section')?.textContent).toContain('Song');
    expect(document.querySelector('.au-music-section')?.textContent).not.toContain('Expired song');
  });

  it.each([
    { id: 191656, idMal: 61578, openings: ['"Kaze no Naka wa Hashiru kkya Nai!" by Sangatsu no Phantasia'], endings: ['"Pi" by Akari Nanawo'] },
    { id: 206949, idMal: 63382, openings: ['"Respawn!!" by Watame Tsunomaki (eps 2-)'],
      endings: ['1: "Respawn!!" by Watame Tsunomaki (eps 1)', '2: "Tokimeki Un, Deux, Trois♪" by Magic Vision Hirome-tai (eps 2-)'] },
  ])('replaces incomplete version-1 music data for reported anime $id, preserving OP and ED uses of the same song', async ({ id, idMal, openings, endings }) => {
    const f = setup(); history.replaceState({}, '', `/anime/${id}/title`);
    const partial = { openings: [], endings };
    vi.mocked(localStorage.get).mockResolvedValue({ ...createMusicThemeCache(id, partial), version: 1 });
    f.api.query.mockResolvedValue({ Media: { id, type: 'ANIME', idMal, title: { english: 'Title', romaji: 'Title', native: null } } });
    f.fetchMock.mockResolvedValue({ success: true, data: { data: { openings, endings } } });
    await f.process();
    expect(f.fetchMock).toHaveBeenCalledWith({ type: 'media:music-themes', idMal });
    expect(document.querySelectorAll('.au-music-section h2')).toHaveLength(2);
    expect(document.querySelector('.au-music-section')?.textContent).toContain('Openings');
    expect(document.querySelector('.au-music-section')?.textContent).toContain('Endings');
    expect(localStorage.set).toHaveBeenCalledWith(`music_themes_cache_${id}`, expect.objectContaining({ version: 3, idMal, themes: { openings, endings } }));
    expect(document.querySelectorAll('.au-music-section a')).toHaveLength(openings.length + endings.length);
  });

  it('writes a detached public cache without letting the storage adapter change the rendered response', async () => {
    const f = setup(); vi.mocked(localStorage.set).mockImplementationOnce(async (_key, value: unknown) => {
      const entry = value as { themes: { openings: string[] } }; entry.themes.openings[0] = 'Changed by storage'; return true;
    });
    await f.process(); expect(document.querySelector('.au-music-section')?.textContent).toContain('Song');
    expect(document.querySelector('.au-music-section')?.textContent).not.toContain('Changed by storage');
  });

  it('does not cache a Jikan HTTP failure or repeat it within the same page visit', async () => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: false }); await f.process(); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.overview')?.hasAttribute('data-au-music')).toBe(false);
  });

  it('caches an empty theme result for the short TTL without leaving an empty section behind', async () => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: true, data: { data: { openings: [], endings: [] } } });
    await f.process();
    expect(localStorage.set).toHaveBeenCalledWith('music_themes_cache_1', expect.objectContaining({ version: 3, idMal: 100, themes: { openings: [], endings: [] } }));
    expect(document.querySelector('.au-music-section')).toBeNull();
    expect(document.querySelector('.overview')?.getAttribute('data-au-music')).toBe('1');
  });

  it('serves a cached empty theme result without repeating the AniList or Jikan lookups', async () => {
    const f = setup(); vi.mocked(localStorage.get).mockResolvedValue(createMusicThemeCache(1, { openings: [], endings: [] }, Date.now(), 100));
    await f.process();
    expect(f.api.query).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled(); expect(localStorage.set).not.toHaveBeenCalled();
    expect(document.querySelector('.overview')?.getAttribute('data-au-music')).toBe('1');
  });
  it('re-fetches an empty theme result once its short TTL has expired', async () => {
    const f = setup(); vi.mocked(localStorage.get).mockResolvedValue(createMusicThemeCache(1, { openings: [], endings: [] }, Date.now() - MUSIC_EMPTY_CACHE_TTL_MS, 100));
    await f.process();
    expect(f.api.query).toHaveBeenCalledOnce();
  });
  it('does not repeat a failed AniList lookup within the same page visit', async () => {
    const f = setup(); f.api.query.mockRejectedValue(new Error('provider unavailable'));
    await f.process(); await f.process();
    expect(f.api.query).toHaveBeenCalledOnce(); expect(localStorage.set).not.toHaveBeenCalled();
  });
  it('makes copied observer callbacks inert and blocks future manual requests after destroy', async () => {
    const f = setup(); await f.module.init();
    await vi.waitFor(() => expect(document.querySelector('.au-music-section')).not.toBeNull());
    const callback = f.observer.register.mock.calls[0][1]; await f.module.destroy();
    f.api.query.mockClear(); f.fetchMock.mockClear(); callback(); await f.module.renderMusicThemes(1, 100);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.api.query).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it('blocks a manual Jikan rendering result when its account context changes', async () => {
    const f = setup(); const response = deferred<unknown>(); f.fetchMock.mockReturnValue(response.promise);
    const pending = f.module.renderMusicThemes(1, 100); await vi.waitFor(() => expect(f.fetchMock).toHaveBeenCalledOnce());
    f.changeAccount(); response.resolve({ success: true, data: { data: { openings: ['Old account song'], endings: [] } } });
    await pending; expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it('adds a direct video in a new tab and keeps YouTube search available', async () => {
    const f = setup();
    f.fetchMock.mockImplementation(async (message?: unknown) => (message as { type: string }).type === 'media:music-videos'
      ? { success: true, data: { idMal: 100, links: [{ type: 'OP', titles: ['Song'], url: 'https://v.animethemes.moe/Example-OP1.webm' }] } }
      : { success: true, data: { data: { openings: ['"Song" by Artist'], endings: [] } } });
    await f.process();
    await vi.waitFor(() => expect(document.querySelector('.au-theme-video')).not.toBeNull());
    const play = document.querySelector<HTMLAnchorElement>('.au-theme-video')!;
    expect(play.href).toBe('https://v.animethemes.moe/Example-OP1.webm'); expect(play.target).toBe('_blank');
    expect(play.rel).toBe('noopener noreferrer'); expect(play.hasAttribute('onclick')).toBe(false);
    expect(document.querySelector('a[data-au-song-index]')?.getAttribute('href')).toContain('youtube.com/results?');
    expect(document.querySelector('iframe, video, audio')).toBeNull();
  });

  it('renders cached songs before slow video metadata, without repeating the AniList lookup', async () => {
    const f = setup(); const videos = deferred<unknown>();
    vi.mocked(localStorage.get).mockResolvedValue(createMusicThemeCache(1, { openings: ['Song'], endings: [] }, Date.now(), 100));
    f.fetchMock.mockReturnValue(videos.promise);
    await f.process();
    expect(f.api.query).not.toHaveBeenCalled(); expect(document.querySelector('.au-music-section')).not.toBeNull();
    expect(document.querySelector('.au-theme-video')).toBeNull();
    expect(f.fetchMock).toHaveBeenCalledWith({ type: 'media:music-videos', idMal: 100 });
    videos.resolve({ success: true, data: { idMal: 100, links: [{ type: 'OP', titles: ['Song'], url: 'https://v.animethemes.moe/Example-OP1.webm' }] } });
    await vi.waitFor(() => expect(document.querySelector('.au-theme-video')).not.toBeNull());
  });

  it.each(['failure', 'wrong work', 'unsafe URL', 'wrong type'])('retains search without a misleading play link on %s', async mode => {
    const f = setup();
    const link = { type: mode === 'wrong type' ? 'ED' : 'OP', titles: ['Song'], url: mode === 'unsafe URL' ? 'https://evil.test/file.webm' : 'https://v.animethemes.moe/Example-OP1.webm' };
    f.fetchMock.mockImplementation(async (message?: unknown) => (message as { type: string }).type === 'media:music-videos'
      ? mode === 'failure' ? { success: false } : { success: true, data: { idMal: mode === 'wrong work' ? 200 : 100, links: [link] } }
      : { success: true, data: { data: { openings: ['Song'], endings: [] } } });
    await f.process(); for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(document.querySelector('.au-theme-video')).toBeNull(); expect(document.querySelector('a[data-au-song-index]')).not.toBeNull();
  });

  it.each(['navigation', 'destroy'])('ignores late video enrichment after %s', async action => {
    const f = setup(); const videos = deferred<unknown>();
    f.fetchMock.mockImplementation(async (message?: unknown) => (message as { type: string }).type === 'media:music-videos'
      ? videos.promise : { success: true, data: { data: { openings: ['Song'], endings: [] } } });
    await f.process();
    if (action === 'destroy') await f.module.destroy(); else history.replaceState({}, '', '/anime/2/other');
    videos.resolve({ success: true, data: { idMal: 100, links: [{ type: 'OP', titles: ['Song'], url: 'https://v.animethemes.moe/Example-OP1.webm' }] } });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(document.querySelector('.au-theme-video')).toBeNull();
  });
});
