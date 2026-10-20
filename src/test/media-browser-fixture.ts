/** Real media modules, native DOM/observer and the compiled worker's public-data RPC. */
import 'reflect-metadata';
import { MediaMetadataModule } from '@/modules/media/MediaMetadataModule';
import { MediaMusicModule } from '@/modules/media/MediaMusicModule';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const until = async (predicate: () => boolean) => {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Media fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

export async function runMediaBrowserFixture(): Promise<string[]> {
  const bus = new EventBus(); const observer = new SharedGlobalObserver(); const errors: unknown[] = [];
  const context = { sessionId: 'public-media-fixture', userId: null };
  const cache = new Map<string, unknown>();
  let queries = 0;
  const api = { getContext: () => context, ensureContext: async () => context,
    query: async (_query: string, variables: { id: number; type?: string }) => {
      queries++;
      return { Media: { id: variables.id, type: variables.type ?? 'ANIME', idMal: variables.id === 191656 ? 61578 : variables.id === 206949 ? 63382 : variables.id === 3 ? null : variables.id,
        title: { english: 'Cowboy Bebop', romaji: 'Cowboy Bebop', native: null }, externalLinks: [] } };
    } };
  const storage = { get: async (key: string) => structuredClone(cache.get(key) ?? null),
    set: async (key: string, value: unknown) => { cache.set(key, structuredClone(value)); return true; } };
  const logger = { error: (error: unknown) => errors.push(error), debug: (error: unknown) => errors.push(error) };
  const metadata = new MediaMetadataModule(api as never, logger as never, observer, bus, storage as never);
  const music = new MediaMusicModule(api as never, logger as never, { isFeatureEnabled: () => true } as never, observer, bus, storage as never);
  const mount = (path: string) => {
    const previousPath = location.pathname;
    history.replaceState({}, '', path);
    document.body.innerHTML = '<main><h1>Cowboy Bebop</h1><div class="sidebar"><div class="data-set"><div class="type">Mean Score</div><div class="value">88%</div></div></div><div class="external-links-wrap"><a class="external-link" data-v-test="" href="https://example.com">Link</a></div><div class="overview"><div class="characters"><h2>Characters</h2></div><div class="staff"><h2>Staff</h2></div></div></main>';
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path, previousPath, timestamp: new Date() });
  };
  try {
    mount('/anime/1/Cowboy-Bebop'); await metadata.init(); await music.init();
    await until(() => !!document.querySelector('.au-mal-score') && !!document.querySelector('.au-music-section'));
    assert(document.querySelector('.au-mal-score .value')?.textContent?.trim() === '8.75', 'anime must render Edge MAL score');
    assert(document.querySelector('.au-music-section')?.textContent?.includes('Tank!') === true, 'Tenrai music themes must render');
    assert(document.querySelector('.staff')?.previousElementSibling?.classList.contains('au-music-section') === true, 'themes must mount before Staff in the real page hierarchy');
    assert(document.querySelector('.au-reddit-btn')?.hasAttribute('data-v-test') === true, 'Reddit link must inherit AniList scoped styling');
    const checks = ['anime score, Tenrai openings/endings and Reddit render through the compiled worker RPC'];

    const beforeRepair = queries;
    document.querySelector('.au-mal-score')!.remove(); document.querySelector('.au-music-section')!.remove();
    await until(() => !!document.querySelector('.au-mal-score') && !!document.querySelector('.au-music-section'));
    assert(queries === beforeRepair, 'native observer repair must reuse public caches');
    checks.push('native mutation observer repairs replaced content without repeating provider lookups');

    mount('/manga/2/Berserk');
    await until(() => document.querySelector('.au-mal-score .value')?.textContent?.trim() === '9.46');
    assert(document.querySelector<HTMLAnchorElement>('.au-mal-score a')?.href === 'https://myanimelist.net/manga/2', 'manga links must retain their media type');
    assert(!document.querySelector('.au-music-section'), 'anime themes must be removed on manga navigation');
    mount('/anime/3/title-without-mal-id');
    await until(() => !!document.querySelector('.au-music-section') && !!document.querySelector('.au-reddit-btn'));
    assert(!document.querySelector('.au-mal-score'), 'title-search fallback must not invent an AniList MAL cross-reference');
    checks.push('anime/manga SPA navigation and exact-title fallback use the current work and correct media type');

    const beforeReturn = queries;
    mount('/anime/1/Cowboy-Bebop');
    await until(() => !!document.querySelector('.au-music-section') && !!document.querySelector('.au-mal-score'));
    assert(queries === beforeReturn && errors.length === 0, 'return navigation must reuse caches without failures');
    assert(document.querySelectorAll('.au-music-section').length === 1 && document.querySelectorAll('.au-mal-score').length === 1, 'injections must not duplicate');
    for (const [id, opening, endingCount] of [[191656, 'Kaze no Naka', 1], [206949, 'Respawn!!', 2]] as const) {
      cache.set(`music_themes_cache_${id}`, { version: 1, mediaId: id, type: 'ANIME', cachedAt: Date.now(),
        themes: { openings: [], endings: ['Incomplete old result'] } });
      mount(`/anime/${id}/reported-title`);
      await until(() => !!document.querySelector('.au-music-section'));
      const section = document.querySelector('.au-music-section')!;
      const groups = section.children;
      assert(groups[0]?.querySelector('h2')?.textContent === 'Openings' && groups[0]?.textContent?.includes(opening) === true,
        'reported work must recover its missing opening');
      assert(groups[1]?.querySelector('h2')?.textContent === 'Endings' && groups[1]?.querySelectorAll('a[data-au-song-index]').length === endingCount,
        'reported work must preserve every ending');
      assert(!section.textContent?.includes('Incomplete old result'), 'old partial cache must not survive provider migration');
      await until(() => section.querySelectorAll('.au-theme-video').length === 2);
      assert(section.querySelectorAll('a[data-au-song-index]').length === endingCount + 1, 'YouTube must remain available beside direct playback');
      for (const play of section.querySelectorAll<HTMLAnchorElement>('.au-theme-video')) {
        assert(play.href.startsWith('https://v.animethemes.moe/') && play.target === '_blank' && play.rel === 'noopener noreferrer',
          'direct videos must open in a new tab with a trusted URL');
      }
      assert(!section.querySelector('video, audio, iframe'), 'direct links must not embed or preload media in AniList');
    }
    checks.push('reported Seitokai and Nia Liston pages recover missing openings and retain both Nia endings despite old partial caches');
    checks.push('identified direct OP/ED videos open in a new tab, retain YouTube fallback and do not preload media');
    return checks;
  } finally { await metadata.destroy(); await music.destroy(); observer.destroy(); }
}
