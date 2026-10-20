import { describe, it, expect, vi } from 'vitest';
import { AstraSyncService } from './AstraSyncService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWork, AstraWorkSummary } from '../AstraInterfaces';
import type { AstraSyncEntry } from './AstraSyncResponse';
import type { ApiContext } from '@core/interfaces/IApiClient';

function animeEntry(mediaId = 10): AstraSyncEntry {
  return {
    id: mediaId + 100,
    userId: 1,
    mediaId,
    status: MediaListStatus.COMPLETED,
    score: 8,
    progress: 12,
    notes: '', startedAt: null, completedAt: null,
    customLists: {},
    private: false,
    hiddenFromStatusLists: false,
    media: {
      id: mediaId,
      title: { romaji: 'Frieren', english: 'Frieren', native: 'フリーレン' },
      type: 'ANIME',
      format: 'TV',
      countryOfOrigin: 'JP',
      coverImage: { extraLarge: 'xl', large: 'l', medium: 'm' },
      genres: ['Fantasy'],
      episodes: 28,
      chapters: null,
      duration: 24,
    },
  };
}

function collection(entries: unknown[] = [], hasNextChunk: boolean | null = false) {
  return { MediaListCollection: { user: { id: 1 }, hasNextChunk, lists: [{ entries }] } };
}

function existingWork(): AstraWork {
  return { id: 'local', ownerId: 1, mediaId: 10, title: 'Local title', type: 'anime', status: MediaListStatus.CURRENT,
    customLists: ['Local list'], tags: ['Local tag'], notes: 'Keep these notes', updatedAt: 123,
    progress: 5, episodes: 20, duration: 24, isPrivate: true, isHidden: true,
    seasons: [{ id: 'season', scores: { story: 9 }, episodeNotes: { 1: { text: 'Keep journal' } } }] };
}

function makeMocks() {
  const context: ApiContext = { userId: 1, sessionId: 'one' };
  const api = {
    ensureContext: vi.fn(async () => ({ ...context })),
    getContext: vi.fn(() => ({ ...context })),
    getCurrentUser: vi.fn(async () => ({ id: 1, name: 'tester' })),
    query: vi.fn(async (_q: string, vars: Record<string, unknown>): Promise<unknown> => {
      if (vars.type === 'ANIME') {
        return collection([animeEntry()]);
      }
      return collection();
    }),
  };
  const repository = {
    init: vi.fn(async () => {}),
    getSections: vi.fn(() => []),
    getSettings: vi.fn(() => ({ appendAstraToComment: false })),
    getWorks: vi.fn((): AstraWorkSummary[] => []),
    getFullWork: vi.fn(async (): Promise<AstraWork | undefined> => undefined),
    createDefaultSeason: vi.fn(() => ({
      id: 's',
      name: 'S1',
      scores: {},
      skip: [],
      episodeNotes: {},
    })),
    saveWork: vi.fn(async () => ({})),
    saveWorks: vi.fn(async (_works: AstraWork[]) => []),
    persist: vi.fn(async () => {}),
  };
  const parser = { parse: vi.fn(() => null), merge: vi.fn(() => false) };
  const eventBus = { emit: vi.fn(), on: vi.fn() };
  const queue = { getSnapshot: vi.fn(async () => ({ revision: 'stable', entries: [] as import('@core/interfaces/ISyncQueueService').QueuedMutation[] })) };
  return { api, repository, parser, eventBus, context, queue };
}

describe('AstraSyncService.syncWithAniList', () => {
  it('imports a new AniList entry and reports it as added', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(
      api as never,
      repository as never,
      parser as never,
      eventBus as never, queue as never
    );

    const result = await service.syncWithAniList();

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(repository.saveWorks).toHaveBeenCalledTimes(1);
    expect(repository.saveWorks).toHaveBeenCalledWith([expect.objectContaining({ mediaId: 10 })]);
  });

  it('commits a bulk sync once without intermediate partial saves', async () => {
    // Regression guard for the O(n^2) sync fix.
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(
      api as never,
      repository as never,
      parser as never,
      eventBus as never, queue as never
    );

    await service.syncWithAniList();

    expect(repository.saveWorks).toHaveBeenCalledTimes(1);
    expect(repository.saveWork).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('queries both ANIME and MANGA collections', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(
      api as never,
      repository as never,
      parser as never,
      eventBus as never, queue as never
    );

    await service.syncWithAniList();

    const types = api.query.mock.calls.map(call => call[1].type);
    expect(types).toContain('ANIME');
    expect(types).toContain('MANGA');
  });

  it('emits ASTRA_SYNC_COMPLETE with the counts', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const service = new AstraSyncService(
      api as never,
      repository as never,
      parser as never,
      eventBus as never, queue as never
    );

    await service.syncWithAniList();

    expect(eventBus.emit).toHaveBeenCalledWith(
      EVENT_TYPES.ASTRA_SYNC_COMPLETE,
      expect.objectContaining({ added: 1, updated: 0 })
    );
  });
});

describe('Astra sync validates all remote data before touching local works', () => {
  it.each([
    { label: 'null collection', response: { MediaListCollection: null } },
    { label: 'missing collection', response: {} },
    { label: 'missing privacy', response: collection([{ ...animeEntry(), private: undefined }]) },
    { label: 'missing custom lists', response: collection([{ ...animeEntry(), customLists: undefined }]) },
    { label: 'missing metadata', response: collection([{ ...animeEntry(), media: { ...animeEntry().media, episodes: undefined } }]) },
    { label: 'wrong owner', response: { MediaListCollection: { ...collection().MediaListCollection, user: { id: 2 } } } },
    { label: 'wrong media identity', response: collection([{ ...animeEntry(), media: { ...animeEntry().media, id: 11 } }]) },
    { label: 'wrong request type', response: collection([{ ...animeEntry(), media: { ...animeEntry().media, type: 'MANGA' } }]) },
  ])('rejects $label and preserves existing work', async ({ response }) => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const work = existingWork(); const original = structuredClone(work);
    repository.getWorks.mockReturnValue([{ ...work, currentScore: 9 }]);
    repository.getFullWork.mockResolvedValue(work);
    api.query.mockResolvedValueOnce(response).mockResolvedValueOnce(collection());
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Invalid AniList Astra collection response');
    expect(repository.getFullWork).not.toHaveBeenCalled();
    expect(repository.saveWorks).not.toHaveBeenCalled();
    expect(parser.merge).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(work).toEqual(original);
  });

  it('rejects a broken second collection before staging a valid first collection', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    repository.getWorks.mockReturnValue([{ ...existingWork(), currentScore: 9 }]);
    api.query.mockResolvedValueOnce(collection([animeEntry()])).mockResolvedValueOnce({ MediaListCollection: null });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Invalid AniList Astra collection response');
    expect(repository.getWorks).not.toHaveBeenCalled();
    expect(repository.saveWorks).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('rejects an unrelated viewer before collection requests', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    api.getCurrentUser.mockResolvedValue({ id: 2, name: 'other' });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Invalid AniList Astra viewer response');
    expect(api.query).not.toHaveBeenCalled(); expect(repository.saveWorks).not.toHaveBeenCalled();
  });

  it('copies remote data before an awaited local lookup can alter the received payload', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const remote = animeEntry(); const work = existingWork(); const original = structuredClone(work);
    repository.getWorks.mockReturnValue([{ ...work, currentScore: 9 }]);
    api.query.mockImplementation(async (_query, vars) => vars.type === 'ANIME' ? collection([remote]) : collection());
    repository.getFullWork.mockImplementation(async () => {
      remote.media.title.english = 'Unrelated title'; remote.media.genres.push('Injected'); remote.customLists.Injected = true;
      return work;
    });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).resolves.toEqual({ added: 0, updated: 1 });
    expect(repository.saveWorks).toHaveBeenCalledWith([expect.objectContaining({ title: 'Frieren', genres: ['Fantasy'], customLists: [] })]);
    expect(work).toEqual(original);
  });

  it('rejects an unrelated local work identity without modifying it', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const work = { ...existingWork(), mediaId: 99 }; const original = structuredClone(work);
    repository.getWorks.mockReturnValue([{ ...existingWork(), currentScore: 9 }]);
    repository.getFullWork.mockResolvedValue(work);
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Invalid Astra local work identity');
    expect(repository.saveWorks).not.toHaveBeenCalled(); expect(work).toEqual(original);
  });

  it('retains the existing work when durable bulk persistence fails', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const work = existingWork(); const original = structuredClone(work);
    repository.getWorks.mockReturnValue([{ ...work, currentScore: 9 }]);
    repository.getFullWork.mockResolvedValue(work);
    repository.saveWorks.mockRejectedValue(new Error('Disk unavailable'));
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Disk unavailable');
    expect(work).toEqual(original); expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('rejects an unavailable full work instead of reporting an incomplete local update as complete', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    repository.getWorks.mockReturnValue([{ ...existingWork(), currentScore: 9 }]);
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Astra local work is unavailable');
    expect(repository.saveWorks).not.toHaveBeenCalled(); expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe('Astra complete collection chunk reads', () => {
  it('does not import a remote work while its deletion is durably pending for this account', async () => {
    const f = makeMocks();
    f.queue.getSnapshot.mockResolvedValue({ revision: 'deletion', entries: [
      { id: 'delete', type: 'ASTRA_DELETE', userId: 1, payload: { mediaId: 10 }, retries: 0 },
    ] });
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    expect(await service.syncWithAniList()).toEqual({ added: 0, updated: 0 });
    expect(f.repository.saveWorks).toHaveBeenCalledWith([]);
  });

  it('preserves the local review and Journal when an older remote report is read while a Notes write is pending', async () => {
    const f = makeMocks(); const local = existingWork(); local.seasons[0].notes = 'New local review';
    f.repository.getWorks.mockReturnValue([{ mediaId: 10 } as AstraWorkSummary]);
    f.repository.getFullWork.mockResolvedValue(local);
    f.queue.getSnapshot.mockResolvedValue({ revision: 'pending-notes', entries: [
      { id: 'offline', type: 'ASTRA_SAVE', userId: 1, retries: 1, payload: { mediaId: 10, notes: 'New serialized report' } },
    ] });
    f.api.query.mockImplementation(async (_query, vars) => collection(vars.type === 'ANIME' ? [{ ...animeEntry(), notes: 'Old remote review' }] : []));
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    await service.syncWithAniList();
    expect(f.parser.parse).not.toHaveBeenCalled(); expect(f.parser.merge).not.toHaveBeenCalled();
    expect(f.repository.saveWorks.mock.calls[0][0][0]).toMatchObject({ notes: 'Keep these notes',
      seasons: [{ notes: 'New local review', episodeNotes: { 1: { text: 'Keep journal' } } }] });
  });
  it('indexes pending dates once for multiple works, preserving the latest explicit date fields', async () => {
    const f = makeMocks();
    const entries: import('@core/interfaces/ISyncQueueService').QueuedMutation[] = [
      { id: 'older', type: 'ASTRA_SAVE', userId: 1, retries: 0, payload: { mediaId: 10, startedAt: { year: 2025 }, completedAt: null } },
      { id: 'newer', type: 'ASTRA_SAVE', userId: 1, retries: 0, payload: { mediaId: 10, startedAt: null } },
      { id: 'notes-only', type: 'ASTRA_SAVE', userId: 1, retries: 0, payload: { mediaId: 20, notes: 'Unchanged' } },
    ];
    const iterate = vi.spyOn(entries, Symbol.iterator);
    f.queue.getSnapshot.mockResolvedValue({ revision: 'indexed', entries });
    f.api.query.mockImplementation(async (_query, vars) => collection(vars.type === 'ANIME' ? [animeEntry(), animeEntry(20)] : []));
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    await service.syncWithAniList();
    expect(iterate).toHaveBeenCalledOnce();
    expect(f.repository.saveWorks.mock.calls[0][0]).toEqual([
      expect.objectContaining({ mediaId: 10, startedAt: null, completedAt: null }),
    ]);
    // Media 20 has a pending Notes replacement and no local work: wait for it
    // to finish instead of importing its older remote report as a new work.
  });
  it('imports dates in the existing bulk requests and overlays only explicit pending fields for the current owner', async () => {
    const f = makeMocks(); const startedAt = { year: 2025, month: null, day: 4 };
    f.api.query.mockImplementation(async (_query, vars) => collection(vars.type === 'ANIME'
      ? [{ ...animeEntry(), startedAt, completedAt: { year: 2026, month: 10, day: 1 } }] : []));
    f.queue.getSnapshot.mockResolvedValue({ revision: 'dates', entries: [
      { id: 'own', userId: 1, type: 'ASTRA_SAVE', retries: 0, payload: { mediaId: 10, completedAt: null } },
      { id: 'other', userId: 2, type: 'ASTRA_SAVE', retries: 0, payload: { mediaId: 10, startedAt: null } },
    ] });
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    await service.syncWithAniList();
    expect(f.repository.saveWorks).toHaveBeenCalledWith([expect.objectContaining({ startedAt, completedAt: null })]);
    expect(f.api.query).toHaveBeenCalledTimes(2);
    startedAt.year = 2000;
    expect(f.repository.saveWorks.mock.calls[0][0][0].startedAt?.year).toBe(2025);
  });

  it('persists changed dates on an existing work without changing the original until commit', async () => {
    const f = makeMocks(); const work = existingWork(); work.startedAt = { year: 2020, month: null, day: null };
    f.repository.getWorks.mockReturnValue([{ ...work, currentScore: 8 }]); f.repository.getFullWork.mockResolvedValue(work);
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    await service.syncWithAniList();
    expect(f.repository.saveWorks).toHaveBeenCalledWith([expect.objectContaining({ startedAt: null, completedAt: null })]);
    expect(work.startedAt.year).toBe(2020);
  });

  it('rejects a queue revision change before bulk commit even after a successful save emptied the queue', async () => {
    const f = makeMocks(); f.queue.getSnapshot.mockResolvedValueOnce({ revision: 'before', entries: [] })
      .mockResolvedValueOnce({ revision: 'after', entries: [] });
    const service = new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue);
    await expect(service.syncWithAniList()).rejects.toThrow('pending dates changed');
    expect(f.repository.saveWorks).not.toHaveBeenCalled(); expect(f.eventBus.emit).not.toHaveBeenCalled();
  });

  it.each(['malformed collection', 'rejected request'] as const)('stops a pending sibling read after a %s', async failure => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    let finishAnime!: (value: unknown) => void;
    const animeResponse = new Promise<unknown>(resolve => { finishAnime = resolve; });
    api.query.mockImplementation(async (_query, vars) => {
      if (vars.type === 'ANIME') return animeResponse;
      if (failure === 'rejected request') throw new Error('Collection unavailable');
      return { MediaListCollection: null };
    });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow(failure === 'rejected request'
      ? 'Collection unavailable' : 'Invalid AniList Astra collection response');
    finishAnime(collection([animeEntry()], true));
    // Let all work scheduled by the accepted response settle before asserting
    // the absence of a second request or any local publication.
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    expect(api.query.mock.calls.map(call => call[1])).toEqual([
      { userId: 1, type: 'ANIME', chunk: 1, perChunk: 500 },
      { userId: 1, type: 'MANGA', chunk: 1, perChunk: 500 },
    ]);
    expect(repository.getWorks).not.toHaveBeenCalled(); expect(repository.getFullWork).not.toHaveBeenCalled();
    expect(repository.saveWorks).not.toHaveBeenCalled(); expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('reads both types to completion and deduplicates coherent rows before one commit', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    const manga = { ...animeEntry(30), media: { ...animeEntry(30).media, type: 'MANGA', format: 'NOVEL' } };
    api.query.mockImplementation(async (_query, vars) => {
      if (vars.type === 'MANGA') return collection([manga]);
      return vars.chunk === 1 ? collection([animeEntry()], true) : collection([animeEntry(), animeEntry(20)]);
    });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).resolves.toEqual({ added: 3, updated: 0 });
    expect(api.query.mock.calls.map(call => call[1])).toEqual([
      { userId: 1, type: 'ANIME', chunk: 1, perChunk: 500 },
      { userId: 1, type: 'MANGA', chunk: 1, perChunk: 500 },
      { userId: 1, type: 'ANIME', chunk: 2, perChunk: 500 },
    ]);
    expect(repository.saveWorks).toHaveBeenCalledTimes(1);
    expect(repository.saveWorks).toHaveBeenCalledWith([
      expect.objectContaining({ mediaId: 10, seasons: [expect.objectContaining({ scores: {} })] }),
      expect.objectContaining({ mediaId: 20 }), expect.objectContaining({ mediaId: 30, type: 'novel' }),
    ]);
  });

  it.each(['broken later chunk', 'conflicting duplicate', 'nonadvancing chunk'] as const)('rejects %s without a partial commit', async failure => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    api.query.mockImplementation(async (_query, vars) => {
      if (vars.type === 'MANGA') return collection();
      if (vars.chunk === 1) return collection([animeEntry()], true);
      if (failure === 'broken later chunk') return { MediaListCollection: null };
      if (failure === 'conflicting duplicate') return collection([{ ...animeEntry(), notes: 'Different snapshot' }]);
      return collection([animeEntry()], true);
    });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow(/Invalid|Incomplete/);
    expect(repository.getWorks).not.toHaveBeenCalled(); expect(repository.saveWorks).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('stops an endlessly advancing collection at the chunk guard', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    api.query.mockImplementation(async (_query, vars) => vars.type === 'MANGA' ? collection()
      : collection([animeEntry(Number(vars.chunk))], true));
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('Incomplete AniList Astra collection');
    expect(api.query.mock.calls.filter(call => call[1].type === 'ANIME')).toHaveLength(100);
    expect(repository.saveWorks).not.toHaveBeenCalled();
  });

  it('stops oversized complete reads as soon as their combined archive capacity is exceeded', async () => {
    const { queue, api, repository, parser, eventBus } = makeMocks();
    api.query.mockImplementation(async (_query, vars) => vars.type === 'MANGA' ? collection()
      : collection(Array.from({ length: 500 }, (_, index) => animeEntry((Number(vars.chunk) - 1) * 500 + index + 1)), true));
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('exceeds archive capacity');
    expect(api.query.mock.calls.filter(call => call[1].type === 'ANIME')).toHaveLength(21);
    expect(repository.saveWorks).not.toHaveBeenCalled(); expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('stops an account switch between chunks before another read or any commit', async () => {
    const { queue, api, repository, parser, eventBus, context } = makeMocks();
    api.query.mockImplementation(async (_query, vars) => {
      if (vars.type === 'ANIME') context.sessionId = 'two';
      return vars.type === 'ANIME' ? collection([animeEntry()], true) : collection();
    });
    const service = new AstraSyncService(api as never, repository as never, parser as never, eventBus as never, queue as never);
    await expect(service.syncWithAniList()).rejects.toThrow('account changed');
    expect(api.query.mock.calls.every(call => call[1].chunk === 1)).toBe(true);
    expect(repository.saveWorks).not.toHaveBeenCalled();
  });
});

describe('AstraSyncService merge guards', () => {
  const build = (f: ReturnType<typeof makeMocks>) =>
    new AstraSyncService(f.api as never, f.repository as never, f.parser as never, f.eventBus as never, f.queue as never);
  const withAnimeEntries = (entries: AstraSyncEntry[]) => {
    const f = makeMocks();
    f.api.query.mockImplementation(async (_query, vars) => collection(vars.type === 'ANIME' ? entries : []));
    return f;
  };
  const report = (cleanText: string) => ({ sectionScores: { story: 9 }, subSectionScores: {}, journal: {}, cleanText });

  it('does not merge a remote Astra block into an existing work while appendAstraToComment is off', async () => {
    const f = withAnimeEntries([{ ...animeEntry(), notes: 'Remote block' }]);
    f.repository.getSettings.mockReturnValue({ appendAstraToComment: false } as never);
    f.repository.getWorks.mockReturnValue([{ mediaId: 10 } as AstraWorkSummary]);
    f.repository.getFullWork.mockResolvedValue(existingWork());
    f.parser.parse.mockReturnValue(report('Remote text') as never);
    await build(f).syncWithAniList();
    expect(f.parser.merge).not.toHaveBeenCalled();
    expect(f.repository.saveWorks.mock.calls[0][0][0]).toMatchObject({ notes: 'Keep these notes' });
  });

  it('keeps the raw block out of a new work\'s local notes while appendAstraToComment is off', async () => {
    const f = withAnimeEntries([{ ...animeEntry(), notes: 'Personal text\n<block>' }]);
    f.repository.getSettings.mockReturnValue({ appendAstraToComment: false } as never);
    f.parser.parse.mockReturnValue(report('Personal text') as never);
    await build(f).syncWithAniList();
    expect(f.parser.merge).not.toHaveBeenCalled();
    expect(f.repository.saveWorks.mock.calls[0][0][0]).toMatchObject({ mediaId: 10, notes: 'Personal text' });
  });

  it('merges the remote Astra block when appendAstraToComment is on', async () => {
    const f = withAnimeEntries([{ ...animeEntry(), notes: 'Remote block' }]);
    f.repository.getSettings.mockReturnValue({ appendAstraToComment: true } as never);
    f.parser.parse.mockReturnValue(report('Remote text') as never);
    await build(f).syncWithAniList();
    expect(f.parser.merge).toHaveBeenCalledOnce();
  });

  it('skips only the notes of an entry whose Astra block is unreadable and keeps syncing', async () => {
    const f = withAnimeEntries([{ ...animeEntry(10), notes: 'Broken block' }, { ...animeEntry(11), notes: '' }]);
    f.repository.getSettings.mockReturnValue({ appendAstraToComment: true } as never);
    f.parser.parse.mockImplementation(() => { throw new Error('Incomplete or ambiguous Astra Notes block'); });
    await expect(build(f).syncWithAniList()).resolves.toEqual({ added: 2, updated: 0 });
    expect(f.parser.merge).not.toHaveBeenCalled();
    expect(f.repository.saveWorks.mock.calls[0][0]).toEqual([
      expect.objectContaining({ mediaId: 10, notes: 'Broken block' }),
      expect.objectContaining({ mediaId: 11 }),
    ]);
  });

  it('overlays the newest queued list fields for the same owner over remote values', async () => {
    const f = withAnimeEntries([{ ...animeEntry(), status: MediaListStatus.CURRENT, progress: 2, private: false,
      hiddenFromStatusLists: false, customLists: { Remote: true } }]);
    f.repository.getWorks.mockReturnValue([{ mediaId: 10 } as AstraWorkSummary]);
    f.repository.getFullWork.mockResolvedValue(existingWork());
    f.queue.getSnapshot.mockResolvedValue({ revision: 'pending-list', entries: [
      { id: 'q1', type: 'ASTRA_SAVE', userId: 1, retries: 0, payload: { mediaId: 10, status: 'PLANNING', progress: 7, private: true, hidden: true, lists: ['Queued'] } },
      { id: 'q2', type: 'ASTRA_SAVE', userId: 2, retries: 0, payload: { mediaId: 10, status: 'DROPPED', progress: 99, lists: ['Other account'] } },
    ] } as never);
    await build(f).syncWithAniList();
    expect(f.repository.saveWorks.mock.calls[0][0][0]).toMatchObject({ status: 'PLANNING', progress: 7,
      isPrivate: true, isHidden: true, customLists: ['Queued'] });
  });
});
