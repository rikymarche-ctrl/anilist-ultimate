import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchOrderModule } from './WatchOrderModule';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EVENT_TYPES } from '@core/events/EventTypes';

const SECTION = '.au-watchorder-section';

/** Two titles, 1 → 2, linked both ways as AniList reports them. */
function media(id: number) {
  return {
    id,
    format: 'TV',
    episodes: 12,
    title: { romaji: `Title ${id}`, english: null },
    startDate: { year: 2009 + id, month: 1, day: 1 },
    mediaListEntry: null,
    relations: {
      edges: [
        {
          relationType: id === 1 ? 'SEQUEL' : 'PREQUEL',
          node: { id: id === 1 ? 2 : 1, type: 'ANIME' },
        },
      ],
    },
  };
}

/** AniList's overview: Relations, Characters, Staff (the section goes right after Relations). */
function overviewHtml(): string {
  return `<div class="overview">
    <div class="relations"><h2>Relations</h2></div>
    <div class="characters"><h2>Characters</h2></div>
    <div class="staff"><h2>Staff</h2></div>
  </div>`;
}

function setup() {
  const handlers = new Map<string, Set<(data?: unknown) => void>>();
  const bus = {
    on: (type: string, handler: (data?: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return { unsubscribe: () => handlers.get(type)!.delete(handler) };
    },
    emit: (type: string, data?: unknown) => {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(data);
    },
    off: () => undefined,
  };
  const api = {
    query: vi.fn(async (_query: string, variables: { ids: number[] }) => ({
      Page: { media: variables.ids.map(media) },
    })),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const config = { isFeatureEnabled: () => true };
  const observer = new SharedGlobalObserver();
  const module = new WatchOrderModule(
    api as never,
    logger as never,
    config as never,
    observer,
    bus as never
  );
  const navigate = (path: string) => {
    history.pushState(null, '', path);
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path });
  };
  return { module, navigate, logger, api };
}

describe('WatchOrderModule mounting', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({ success: false, error: 'offline' })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('mounts on a fresh load of an anime page', async () => {
    history.pushState(null, '', '/anime/1/Title');
    document.querySelector('#app')!.innerHTML = overviewHtml();
    const { module } = setup();
    await module.init();
    await vi.waitFor(() => expect(document.querySelector(`.overview ${SECTION}`)).not.toBeNull());
    expect(document.querySelector('.relations')!.nextElementSibling!.matches(SECTION)).toBe(true);
    await module.destroy();
  });

  it('mounts after an in-app navigation from a page that is not an anime page', async () => {
    history.pushState(null, '', '/search/anime');
    document.querySelector('#app')!.innerHTML = '<div class="search-page"></div>';
    const { module, navigate } = setup();
    // ModuleRegistry starts the module lazily, while the old page is still on screen.
    navigate('/anime/1/Title');
    await module.init();
    setTimeout(() => {
      document.querySelector('#app')!.innerHTML = overviewHtml();
    }, 30);
    await vi.waitFor(() => expect(document.querySelector(`.overview ${SECTION}`)).not.toBeNull(), {
      timeout: 3000,
    });
    await module.destroy();
  });

  it('mounts again after moving to another anime page that reuses the overview', async () => {
    history.pushState(null, '', '/anime/1/Title');
    document.querySelector('#app')!.innerHTML = overviewHtml();
    const { module, navigate } = setup();
    await module.init();
    await vi.waitFor(() => expect(document.querySelector(`.overview ${SECTION}`)).not.toBeNull());
    navigate('/search/anime');
    document.querySelector('#app')!.innerHTML = '<div class="search-page"></div>';
    await new Promise((resolve) => setTimeout(resolve, 300));
    navigate('/anime/2/Title');
    setTimeout(() => {
      document.querySelector('#app')!.innerHTML = overviewHtml();
    }, 30);
    await vi.waitFor(() => expect(document.querySelector(`.overview ${SECTION}`)).not.toBeNull(), {
      timeout: 3000,
    });
    await module.destroy();
  });
});
