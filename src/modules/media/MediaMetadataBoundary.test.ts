import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { EventBus } from '@core/events/EventBus';
import { localStorage } from '@/test/storage-fixtures';
import { MediaMetadataModule } from './MediaMetadataModule';
import { METADATA_CACHE_TTL_MS, createMetadataCache } from './MediaMetadataResponse';

const media = { id: 1, type: 'ANIME', idMal: 100, externalLinks: [{ site: 'Reddit', url: 'https://www.reddit.com/r/anime' }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

describe('media metadata response and cache boundaries', () => {
  const modules: MediaMetadataModule[] = [];
  beforeEach(() => {
    vi.clearAllMocks(); history.replaceState({}, '', '/anime/1/title');
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    document.body.innerHTML = '<h1>Title</h1><div class="sidebar"><div class="data-set"><div class="type">Mean Score</div></div></div><div class="external-links-wrap"></div>';
    vi.mocked(localStorage.get).mockResolvedValue(null); vi.mocked(localStorage.set).mockResolvedValue(true);
  });
  afterEach(async () => {
    for (const module of modules.splice(0)) await module.destroy();
    vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = '';
  });
  function setup() {
    let context: ApiContext = { sessionId: 'one', userId: 1 };
    const api = { query: vi.fn(async (): Promise<unknown> => ({ Media: structuredClone(media) })),
      ensureContext: vi.fn(async () => context), getContext: () => context };
    const fetchMock = vi.fn(async (): Promise<unknown> => ({ success: true, data: { data: { malId: 100, score: 8.5 } } }));
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(fetchMock as never);
    const observer = { register: vi.fn((_name: string, _callback: () => void) => {}), unregister: vi.fn() };
    const module = new MediaMetadataModule(api as unknown as IApiClient, { debug: vi.fn() } as never, observer as never, new EventBus(), localStorage as never);
    modules.push(module);
    return { module, api, observer, fetchMock, process: () => (module as unknown as { checkAndProcess(): Promise<void> }).checkAndProcess(),
      changeAccount: () => { context = { sessionId: 'two', userId: 2 }; } };
  }

  it.each([{}, { Media: {} }, { Media: { ...media, id: 2 } }, { Media: { ...media, type: 'MANGA' } },
    { Media: { ...media, idMal: -1 } }, { Media: { ...media, idMal: '100' } }, { Media: { ...media, externalLinks: {} } },
    { Media: { ...media, externalLinks: [{ url: 42, site: 'Reddit' }] } }, { Media: { ...media, externalLinks: [{ url: 'https://reddit.com', site: null }] } }])('rejects malformed or mismatched metadata without caching or repeating the lookup within the visit: %j', async response => {
    const f = setup(); f.api.query.mockResolvedValue(response); await f.process(); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.sidebar')?.hasAttribute('data-au-meta')).toBe(false);
    expect(document.querySelector('.au-mal-score')).toBeNull(); expect(f.api.query).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { data: {} }, { data: { malId: 101, score: 8 } }, { data: { malId: 100, score: '8.5' } },
    { data: { malId: 100, score: {} } }, { data: { malId: 100, score: NaN } }, { data: { malId: 100, score: 11 } }])('does not cache malformed or mismatched Jikan scores: %j', async response => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: true, data: response }); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-mal-score')).toBeNull();
    expect(document.querySelector('.sidebar')?.hasAttribute('data-au-meta')).toBe(false);
  });

  it('distinguishes zero score from explicit null or failed metadata', async () => {
    const f = setup(); f.fetchMock.mockResolvedValue({ success: true, data: { data: { malId: 100, score: 0 } } });
    await f.process(); expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('0');
  });

  it('refetches malformed raw cached metadata instead of letting it bypass response validation', async () => {
    const f = setup(); vi.mocked(localStorage.get).mockResolvedValue({ idMal: 100, malScore: 'bad', externalLinks: [{ site: 'Reddit', url: 42 }] });
    await f.process(); expect(f.api.query).toHaveBeenCalledOnce(); expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('8.5');
  });

  it('does not repeat a failed API request within the same page visit', async () => {
    const f = setup(); f.api.query.mockRejectedValueOnce(new Error('Disconnected')); await f.process(); await f.process();
    expect(f.api.query).toHaveBeenCalledTimes(1); expect(document.querySelector('.au-mal-score')).toBeNull();
  });

  it.each(['https://reddit.com.evil.test/r/anime', 'https://evil.test/path?reddit.com', 'https://reddit.com@evil.test/r/anime'])('uses a safe fallback instead of trusting Reddit substring %s', async url => {
    const f = setup(); f.api.query.mockResolvedValue({ Media: { ...media, externalLinks: [{ site: 'Reddit', url }] } });
    await f.process(); expect(document.querySelector<HTMLAnchorElement>('.au-reddit-btn')?.href).toBe('https://www.reddit.com/search/?q=Title');
  });

  it('does not cache or inject a late result after account replacement', async () => {
    const f = setup(); const response = deferred<unknown>(); f.api.query.mockReturnValue(response.promise);
    const pending = f.process(); await vi.waitFor(() => expect(f.api.query).toHaveBeenCalledOnce());
    f.changeAccount(); response.resolve({ Media: structuredClone(media) }); await pending;
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-mal-score')).toBeNull();
  });

  it('does not cache or inject a late Jikan result after navigation', async () => {
    const f = setup(); const response = deferred<unknown>(); f.fetchMock.mockReturnValue(response.promise);
    const pending = f.process(); await vi.waitFor(() => expect(f.fetchMock).toHaveBeenCalledOnce()); history.replaceState({}, '', '/manga/2/other');
    response.resolve({ success: true, data: { data: { malId: 100, score: 8.5 } } }); await pending;
    expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-mal-score')).toBeNull();
  });

  it('renders and deduplicates a legitimate MAL-less anime without requesting a score', async () => {
    const f = setup(); f.api.query.mockResolvedValue({ Media: { ...media, idMal: null, externalLinks: null } });
    await f.process(); await f.process();
    expect(f.api.query).toHaveBeenCalledOnce(); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.au-mal-score')).toBeNull(); expect(document.querySelector('.au-reddit-btn')).not.toBeNull();
    expect(document.querySelector('.sidebar')?.getAttribute('data-au-meta')).toBe('1');
  });

  it('keeps explicit not-found distinct from failures and does not persist it as successful metadata', async () => {
    const f = setup(); f.api.query.mockResolvedValue({ Media: null }); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLAnchorElement>('.au-reddit-btn')?.href).toBe('https://www.reddit.com/search/?q=Title');
  });

  it('shows N/A for an explicitly null score', async () => {
    const f = setup(); f.fetchMock.mockResolvedValueOnce({ success: true, data: { data: { malId: 100, score: null } } }); await f.process();
    expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('N/A');
  });
  it('does not repeat a failed MAL score request within the same page visit', async () => {
    const f = setup(); f.fetchMock.mockResolvedValueOnce({ success: false }); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.sidebar')?.hasAttribute('data-au-meta')).toBe(false);
    await f.process(); expect(f.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads fresh cached metadata without a provider refresh and refetches it when expired', async () => {
    const f = setup(); const cached = { idMal: 100, malScore: '7.5', externalLinks: structuredClone(media.externalLinks) };
    vi.mocked(localStorage.get).mockResolvedValueOnce(createMetadataCache(1, 'ANIME', cached)); await f.process();
    expect(f.api.query).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('7.5');
    document.querySelector('.sidebar')?.removeAttribute('data-au-meta'); document.querySelector('.au-mal-score')?.remove();
    vi.mocked(localStorage.get).mockResolvedValueOnce(createMetadataCache(1, 'ANIME', cached, Date.now() - METADATA_CACHE_TTL_MS)); await f.process();
    expect(f.api.query).toHaveBeenCalledOnce(); expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('8.5');
  });

  it('writes a detached public cache while ignoring unrequested private metadata', async () => {
    const f = setup(); f.api.query.mockResolvedValue({ Media: { ...media, viewerPrivate: 'secret' } });
    vi.mocked(localStorage.set).mockImplementationOnce(async (_key, value: unknown) => {
      const entry = value as { info: { malScore: string; viewerPrivate?: string } };
      expect(entry.info.viewerPrivate).toBeUndefined(); entry.info.malScore = '1'; return true;
    });
    await f.process(); expect(document.querySelector('.au-mal-score .value')?.textContent?.trim()).toBe('8.5');
  });

  it('ignores an unsafe native Reddit-looking link and injects a trusted destination', async () => {
    const f = setup(); document.querySelector('.external-links-wrap')!.innerHTML = '<a href="https://reddit.com.evil.test/r/anime">Other link</a>';
    await f.process(); expect(document.querySelector<HTMLAnchorElement>('.au-reddit-btn')?.href).toBe('https://www.reddit.com/r/anime');
  });

  it('blocks copied observer callbacks and late Jikan results after destroy', async () => {
    const f = setup(); const response = deferred<unknown>(); f.fetchMock.mockReturnValue(response.promise); await f.module.init();
    await vi.waitFor(() => expect(f.fetchMock).toHaveBeenCalledOnce()); const callback = f.observer.register.mock.calls[0][1];
    await f.module.destroy(); response.resolve({ success: true, data: { data: { malId: 100, score: 8.5 } } });
    for (let i = 0; i < 12; i++) await Promise.resolve(); callback(); await f.process();
    expect(localStorage.set).not.toHaveBeenCalled(); expect(document.querySelector('.au-mal-score')).toBeNull();
    expect(f.api.query).toHaveBeenCalledOnce();
  });

  it.each(['score header', 'external links'] as const)('waits for a delayed %s and reuses public metadata without duplicate injection', async missing => {
    const f = setup();
    let cached: unknown = null;
    vi.mocked(localStorage.get).mockImplementation(async () => cached);
    vi.mocked(localStorage.set).mockImplementation(async (_key, value: unknown) => { cached = value; return true; });
    const sidebar = document.querySelector('.sidebar')!;
    if (missing === 'score header') sidebar.innerHTML = '';
    else document.querySelector('.external-links-wrap')!.remove();

    await f.process(); await f.process();
    expect(sidebar.hasAttribute('data-au-meta')).toBe(false);
    expect(document.querySelector('.au-mal-score')).toBeNull();
    expect(document.querySelector('.au-reddit-btn')).toBeNull();
    expect(f.api.query).toHaveBeenCalledOnce(); expect(f.fetchMock).toHaveBeenCalledOnce();

    if (missing === 'score header') sidebar.innerHTML = '<div class="data-set"><div class="type">Mean Score</div></div>';
    else document.body.insertAdjacentHTML('beforeend', '<div class="external-links-wrap"></div>');
    await f.process(); await f.process();
    expect(sidebar.getAttribute('data-au-meta')).toBe('1');
    expect(document.querySelectorAll('.au-mal-score')).toHaveLength(1);
    expect(document.querySelectorAll('.au-reddit-btn')).toHaveLength(1);
    expect(f.api.query).toHaveBeenCalledOnce(); expect(f.fetchMock).toHaveBeenCalledOnce();
  });

  it('copies scoped styling attributes without treating them as template bindings', async () => {
    const f = setup();
    document.querySelector('.external-links-wrap')!.innerHTML = '<a class="external-link" data-v-aaa133fc="" href="https://example.com">Other</a>';
    await f.process();
    const button = document.querySelector('.au-reddit-btn');
    expect(button).not.toBeNull();
    expect(button?.hasAttribute('data-v-aaa133fc')).toBe(true);
    expect(button?.querySelector('.icon-wrap')?.hasAttribute('data-v-aaa133fc')).toBe(true);
    expect(button?.querySelector('.name')?.hasAttribute('data-v-aaa133fc')).toBe(true);
    expect(document.querySelector('.sidebar')?.getAttribute('data-au-meta')).toBe('1');
  });

  it('does not complete delayed targets through copied callbacks after destruction', async () => {
    const f = setup(); let cached: unknown = null;
    vi.mocked(localStorage.get).mockImplementation(async () => cached);
    vi.mocked(localStorage.set).mockImplementation(async (_key, value: unknown) => { cached = value; return true; });
    document.querySelector('.external-links-wrap')!.remove();
    await f.module.init();
    await vi.waitFor(() => expect(localStorage.set).toHaveBeenCalledOnce());
    const callback = f.observer.register.mock.calls[0][1];
    await f.module.destroy();
    document.body.insertAdjacentHTML('beforeend', '<div class="external-links-wrap"></div>');
    callback(); await f.process();
    expect(document.querySelector('.au-mal-score')).toBeNull();
    expect(document.querySelector('.au-reddit-btn')).toBeNull();
    expect(f.api.query).toHaveBeenCalledOnce();
  });

  it.each(['.au-mal-score', '.au-reddit-btn'])('restores a removed %s while retaining the sidebar marker and reusing its cache', async selector => {
    const f = setup(); let cached: unknown = null;
    vi.mocked(localStorage.get).mockImplementation(async () => cached);
    vi.mocked(localStorage.set).mockImplementation(async (_key, value: unknown) => { cached = value; return true; });
    await f.process(); document.querySelector(selector)!.remove();
    expect(document.querySelector('.sidebar')?.getAttribute('data-au-meta')).toBe('1');
    await f.process(); await f.process();
    expect(document.querySelectorAll('.au-mal-score')).toHaveLength(1);
    expect(document.querySelectorAll('.au-reddit-btn')).toHaveLength(1);
    expect(f.api.query).toHaveBeenCalledOnce(); expect(f.fetchMock).toHaveBeenCalledOnce();
  });
});
