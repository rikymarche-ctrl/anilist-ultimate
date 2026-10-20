import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { localStorage } from '@/test/storage-fixtures';
import { MediaMetadataModule } from './MediaMetadataModule';
import { MediaMusicModule } from './MediaMusicModule';
import { createMusicThemeCache } from './MediaMusicResponse';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';

type MediaProcessor = { checkAndProcess(): Promise<void>; renderMusicThemesInternal(): Promise<void> };


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('Media modules navigation and lifecycle', () => {
  const modules: (MediaMetadataModule | MediaMusicModule)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    history.replaceState({}, '', '/anime/1/title');
    document.body.innerHTML = '<h1>Title</h1><div class="sidebar"><div class="data-set"><div class="type">Mean Score</div></div></div><div class="external-links-wrap"></div><div class="overview"><div>Content</div></div>';
    vi.mocked(localStorage.get).mockResolvedValue(null);
    vi.mocked(localStorage.set).mockResolvedValue(true);
  });
  afterEach(async () => {
    for (const module of modules.splice(0)) await module.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup(kind: 'metadata' | 'music') {
    const bus = new EventBus();
    const api = { query: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ Media: { id: 1, type: 'ANIME', idMal: null,
      title: { english: null, romaji: null, native: null }, externalLinks: [] } })) };
    const observer = { register: vi.fn(), unregister: vi.fn() };
    const logger = { debug: vi.fn(), error: vi.fn() };
    const module = kind === 'metadata'
      ? new MediaMetadataModule(api as unknown as IApiClient, logger as unknown as ILogger, observer as unknown as SharedGlobalObserver, bus, localStorage as never)
      : new MediaMusicModule(api as unknown as IApiClient, logger as unknown as ILogger, { isFeatureEnabled: () => true } as unknown as IConfigManager, observer as unknown as SharedGlobalObserver, bus, localStorage as never);
    modules.push(module);
    const process = () => kind === 'metadata'
      ? (module as unknown as MediaProcessor).checkAndProcess() : (module as unknown as MediaProcessor).renderMusicThemesInternal();
    return { bus, api, observer, module, process };
  }

  it.each(['metadata', 'music'] as const)('%s releases the shared observer on destroy', async kind => {
    const { module, observer } = setup(kind);
    await module.init();
    expect(observer.register).toHaveBeenCalledTimes(1);
    observer.unregister.mockClear();
    await module.destroy();
    expect(observer.unregister).toHaveBeenCalledTimes(1);
  });

  it('does not inject metadata into a reused sidebar after navigation', async () => {
    const { api, process } = setup('metadata');
    const response = deferred<unknown>();
    api.query.mockReturnValue(response.promise);
    const pending = process();
    await vi.waitFor(() => expect(api.query).toHaveBeenCalledTimes(1));
    history.replaceState({}, '', '/manga/2/other');
    response.resolve({ Media: { id: 1, type: 'ANIME', idMal: 100, externalLinks: [] } });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true, data: { data: { malId: 100, score: 8 } } });
    await pending;
    expect(document.querySelector('.au-mal-score')).toBeNull();
    expect(document.querySelector('.au-reddit-btn')).toBeNull();
  });

  it('uses the request media type even when the route changes while fetching', async () => {
    const { api, process } = setup('metadata');
    const response = deferred<unknown>();
    api.query.mockReturnValue(response.promise);
    const fetchMock = vi.fn(async () => ({ success: true, data: { data: { malId: 100, score: 8 } } }));
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(fetchMock as never);
    const pending = process();
    await vi.waitFor(() => expect(api.query).toHaveBeenCalledTimes(1));
    history.replaceState({}, '', '/manga/2/other');
    response.resolve({ Media: { id: 1, type: 'ANIME', idMal: 100, externalLinks: [] } });
    await pending;
    expect(fetchMock).toHaveBeenCalledWith({ type: 'media:metadata-score', mediaType: 'ANIME', idMal: 100 });
  });

  it('does not insert late music after destroy', async () => {
    const { module } = setup('music');
    const response = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockReturnValue(response.promise as never);
    const pending = (module as MediaMusicModule).renderMusicThemes(1, 100);
    await module.destroy();
    response.resolve({ success: true, data: { data: { openings: ['Song'], endings: [] } } });
    await pending;
    expect(document.querySelector('.au-music-section')).toBeNull();
  });

  it('does not repeat the MAL query on every DOM mutation for a MAL-less anime', async () => {
    const { api, process } = setup('music');
    await process();
    await process();
    await process();
    expect(api.query).toHaveBeenCalledTimes(1);
  });

  it('restores a music section removed by a DOM rerender using cached themes', async () => {
    const { process } = setup('music');
    vi.mocked(localStorage.get).mockResolvedValue(createMusicThemeCache(1, { openings: ['Cached song'], endings: [] }));
    await process();
    document.querySelector('.au-music-section')!.remove();
    await process();
    expect(document.querySelector('.au-music-section')?.textContent).toContain('Cached song');
  });

  it.each(['/character/1/anime/2', '/staff/1/anime/2', '/anime/12oops'])('excludes non-media route %s', async path => {
    history.replaceState({}, '', path);
    const { api, process } = setup('music');
    await process();
    expect(api.query).not.toHaveBeenCalled();
  });

  it('renders external song text and links without interpreting HTML or attributes', async () => {
    const { module } = setup('music');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true, data: {
      data: { openings: ['"<img src=x onerror=evil()>" by Artist https://example.com/"onclick="evil'], endings: [] },
    } } as never);
    await (module as MediaMusicModule).renderMusicThemes(1, 100);
    const music = document.querySelector('.au-music-section')!;
    expect(music.querySelector('img')).toBeNull();
    expect(music.textContent).toContain('<img src=x onerror=evil()>');
    expect(music.querySelector('a')!.hasAttribute('onclick')).toBe(false);
  });
});
