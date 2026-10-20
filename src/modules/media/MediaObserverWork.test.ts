import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { localStorage } from '@/test/storage-fixtures';
import { MediaMetadataModule } from './MediaMetadataModule';
import { MediaMusicModule } from './MediaMusicModule';
import { createMetadataCache } from './MediaMetadataResponse';
import { createMusicThemeCache } from './MediaMusicResponse';

const mediaMarkup = '<h1>Title</h1><div class="sidebar"><div class="data-set"><div class="type">Mean Score</div></div></div><div class="external-links-wrap"></div><div class="overview"><div>Content</div></div>';
type Kind = 'metadata' | 'music';
type Processors = { checkAndProcess(): Promise<void>; renderMusicThemesInternal(): Promise<void> };
const modules: (MediaMetadataModule | MediaMusicModule)[] = [];
const observers: SharedGlobalObserver[] = [];
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.runAllTimersAsync();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.runAllTimersAsync();
}
function setup(kind: Kind) {
  const observer = new SharedGlobalObserver(); observers.push(observer);
  const registration = vi.spyOn(observer, 'register');
  const bus = new EventBus();
  let context: ApiContext = { userId: 1, sessionId: 'first' };
  const api = { query: vi.fn(async () => ({ Media: { id: 1, type: 'ANIME', idMal: null,
    title: { english: null, romaji: null, native: null }, externalLinks: [] } })),
    ensureContext: async () => context, getContext: () => context };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const module = kind === 'metadata'
    ? new MediaMetadataModule(api as unknown as IApiClient, logger as never, observer, bus, localStorage as never)
    : new MediaMusicModule(api as unknown as IApiClient, logger as never, { isFeatureEnabled: () => true } as never, observer, bus, localStorage as never);
  modules.push(module);
  const processor = vi.spyOn(module as unknown as Processors, kind === 'metadata' ? 'checkAndProcess' : 'renderMusicThemesInternal');
  const marker = kind === 'metadata' ? '.au-mal-score' : '.au-music-section';
  const target = kind === 'metadata' ? '.sidebar' : '.overview';
  return { module, observer, registration, processor, bus, api, marker, target,
    changeAccount: () => { context = { userId: 2, sessionId: 'second' }; bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 2, timestamp: new Date() }); } };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); history.replaceState({}, '', '/anime/1/title');
  document.body.innerHTML = '<section class="irrelevant"></section>' + mediaMarkup;
  vi.mocked(localStorage.get).mockImplementation(async key => key.startsWith('metadata_cache_')
    ? createMetadataCache(1, 'ANIME', { idMal: 100, malScore: '8', externalLinks: [] })
    : createMusicThemeCache(1, { openings: ['Cached song'], endings: [] }));
  vi.mocked(localStorage.set).mockResolvedValue(true);
});
afterEach(async () => {
  for (const module of modules.splice(0)) await module.destroy();
  for (const observer of observers.splice(0)) observer.destroy();
  vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '';
});

describe('media consumers with the real shared observer and native mutation delivery', () => {
  it.each(['metadata', 'music'] as const)('%s skips 100 unrelated additions without entering its processor or querying its root', async kind => {
    const f = setup(kind); await f.module.init(); await settle();
    expect(document.querySelector(f.marker)).not.toBeNull(); f.processor.mockClear();
    const query = vi.spyOn(document, 'querySelector');
    const unrelated = document.querySelector('.irrelevant')!; query.mockClear();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 100; i++) fragment.appendChild(document.createElement('p'));
    unrelated.appendChild(fragment); await settle();
    expect.soft(f.processor).not.toHaveBeenCalled();
    expect(query.mock.calls.filter(([selector]) => selector === f.target)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['metadata', 'music'] as const)('%s repairs owned content removed inside its current root', async kind => {
    const f = setup(kind); await f.module.init(); await settle(); f.processor.mockClear();
    document.querySelector(f.marker)!.remove(); await settle();
    expect(f.processor).toHaveBeenCalled(); expect(document.querySelector(f.marker)).not.toBeNull();
    expect(f.api.query).not.toHaveBeenCalled();
    expect(document.querySelectorAll(f.marker)).toHaveLength(1);
  });
  it.each(['metadata', 'music'] as const)('%s accepts delayed relevant content nested inside an otherwise unrelated wrapper', async kind => {
    document.body.innerHTML = '<section class="irrelevant"></section>';
    const f = setup(kind); await f.module.init(); await settle();
    expect(document.querySelector(f.marker)).toBeNull();
    const wrapper = document.createElement('article'); wrapper.innerHTML = mediaMarkup;
    document.querySelector('.irrelevant')!.appendChild(wrapper); await settle();
    expect(document.querySelector(f.marker)).not.toBeNull(); expect(f.api.query).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'music'] as const)('%s repairs a root replaced together with its surrounding wrapper', async kind => {
    const f = setup(kind); await f.module.init(); await settle();
    document.querySelector(f.target)!.remove(); await settle();
    const wrapper = document.createElement('article');
    wrapper.innerHTML = kind === 'metadata' ? '<div class="sidebar"><div class="data-set"><div class="type">Mean Score</div></div></div>' : '<div class="overview"><div>Replacement</div></div>';
    document.body.appendChild(wrapper); await settle();
    expect(document.querySelectorAll(f.marker)).toHaveLength(1); expect(f.api.query).not.toHaveBeenCalled();
  });
  it.each(['score header', 'external links'] as const)('metadata reacts when delayed %s content arrives', async missing => {
    if (missing === 'score header') document.querySelector('.sidebar')!.innerHTML = '';
    else document.querySelector('.external-links-wrap')!.remove();
    const f = setup('metadata'); await f.module.init(); await settle();
    expect(document.querySelector(f.marker)).toBeNull(); f.processor.mockClear();
    if (missing === 'score header') document.querySelector('.sidebar')!.innerHTML = '<div class="data-set"><div class="type">Mean Score</div></div>';
    else document.body.insertAdjacentHTML('beforeend', '<div class="external-links-wrap"></div>');
    await settle();
    expect(f.processor).toHaveBeenCalled(); expect(document.querySelectorAll(f.marker)).toHaveLength(1);
    expect(document.querySelectorAll('.au-reddit-btn')).toHaveLength(1); expect(f.api.query).not.toHaveBeenCalled();
  });
  it('metadata observes title child replacement while music skips mutations outside overview', async () => {
    const metadata = setup('metadata'); const music = setup('music');
    await metadata.module.init(); await music.module.init(); await settle();
    metadata.processor.mockClear(); music.processor.mockClear();
    document.querySelector('h1')!.textContent = 'New title'; await settle();
    expect(metadata.processor).toHaveBeenCalledOnce(); expect(music.processor).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'music'] as const)('%s preserves the child-list-only contract for href attributes', async kind => {
    const f = setup(kind); await f.module.init(); await settle(); f.processor.mockClear();
    document.querySelector(f.marker === '.au-mal-score' ? '.au-reddit-btn' : '.au-music-section a')!.setAttribute('href', 'https://example.com/replaced');
    await settle(); expect(f.processor).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'music'] as const)('%s does not repeat a failed lookup when relevant content changes within the same visit', async kind => {
    vi.mocked(localStorage.get).mockResolvedValue(null);
    const f = setup(kind); f.api.query.mockRejectedValueOnce(new Error('Unavailable'));
    await f.module.init(); await settle(); expect(f.api.query).toHaveBeenCalledOnce();
    document.querySelector(f.target)!.appendChild(document.createElement('p')); await settle();
    expect(f.api.query).toHaveBeenCalledOnce();
  });
  it.each(['metadata', 'music'] as const)('%s ignores a captured registration callback after navigation', async kind => {
    const f = setup(kind); await f.module.init(); await settle();
    const obsolete = f.registration.mock.calls[0][1];
    history.replaceState({}, '', '/anime/2/other');
    busPage(f.bus, '/anime/1/title'); await settle(); f.processor.mockClear();
    obsolete([], {} as MutationObserver); await settle();
    expect(f.processor).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'music'] as const)('%s ignores a captured registration callback after an account restart', async kind => {
    const f = setup(kind); await f.module.init(); await settle();
    const obsolete = f.registration.mock.calls[0][1]; f.changeAccount(); await settle(); f.processor.mockClear();
    obsolete([], {} as MutationObserver); await settle();
    expect(f.processor).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'music'] as const)('%s cancels relevant scheduled delivery on destruction', async kind => {
    const f = setup(kind); await f.module.init(); await settle(); f.processor.mockClear();
    document.querySelector(f.marker)!.remove();
    await Promise.resolve(); await f.module.destroy(); await settle();
    expect(f.processor).not.toHaveBeenCalled(); expect(document.querySelector(f.marker)).toBeNull();
    expect(f.observer.getStatus().callbackCount).toBe(0);
  });
});
function busPage(bus: EventBus, previousPath: string) {
  bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath, timestamp: new Date() });
}
