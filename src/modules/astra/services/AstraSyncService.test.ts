import { describe, it, expect, vi } from 'vitest';
import { AstraSyncService } from './AstraSyncService';
import { EVENT_TYPES } from '@core/events/EventTypes';

function animeEntry() {
  return {
    mediaId: 10,
    status: 'COMPLETED',
    score: 8,
    progress: 12,
    notes: '',
    customLists: {},
    private: false,
    hiddenFromStatusLists: false,
    media: {
      title: { romaji: 'Frieren', english: 'Frieren', native: 'フリーレン' },
      type: 'ANIME',
      format: 'TV',
      countryOfOrigin: 'JP',
      coverImage: { extraLarge: 'xl', large: 'l', medium: 'm' },
      siteUrl: 'https://anilist.co/anime/10',
      genres: ['Fantasy'],
      episodes: 28,
      chapters: null,
      duration: 24,
    },
  };
}

function makeMocks() {
  const api = {
    getCurrentUser: vi.fn(async () => ({ id: 1, name: 'tester' })),
    query: vi.fn(async (_q: string, vars: any) => {
      if (vars.type === 'ANIME') {
        return { MediaListCollection: { lists: [{ entries: [animeEntry()] }] } };
      }
      return { MediaListCollection: { lists: [] } };
    }),
  };
  const repository = {
    init: vi.fn(async () => {}),
    getSections: vi.fn(() => []),
    getWorks: vi.fn(() => []),
    getFullWork: vi.fn(async () => undefined),
    createDefaultSeason: vi.fn(() => ({ id: 's', label: 'S1', scores: {}, skip: [], episodeNotes: {} })),
    saveWork: vi.fn(async () => ({})),
    persist: vi.fn(async () => {}),
  };
  const parser = { parse: vi.fn(() => null), merge: vi.fn(() => false) };
  const eventBus = { emit: vi.fn(), on: vi.fn() };
  return { api, repository, parser, eventBus };
}

describe('AstraSyncService.syncWithAniList', () => {
  it('imports a new AniList entry and reports it as added', async () => {
    const { api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(api as any, repository as any, parser as any, eventBus as any);

    const result = await service.syncWithAniList();

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(repository.saveWork).toHaveBeenCalledTimes(1);
  });

  it('defers the manifest write: saveWork is called with skipPersist=true and persist() once', async () => {
    // Regression guard for the O(n^2) sync fix.
    const { api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(api as any, repository as any, parser as any, eventBus as any);

    await service.syncWithAniList();

    expect(repository.saveWork).toHaveBeenCalledWith(expect.anything(), true);
    expect(repository.persist).toHaveBeenCalledTimes(1);
  });

  it('queries both ANIME and MANGA collections', async () => {
    const { api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(api as any, repository as any, parser as any, eventBus as any);

    await service.syncWithAniList();

    const types = api.query.mock.calls.map((c: any[]) => c[1].type);
    expect(types).toContain('ANIME');
    expect(types).toContain('MANGA');
  });

  it('emits ASTRA_SYNC_COMPLETE with the counts', async () => {
    const { api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(api as any, repository as any, parser as any, eventBus as any);

    await service.syncWithAniList();

    expect(eventBus.emit).toHaveBeenCalledWith(
      EVENT_TYPES.ASTRA_SYNC_COMPLETE,
      expect.objectContaining({ added: 1, updated: 0 })
    );
  });
});
