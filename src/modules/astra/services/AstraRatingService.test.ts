import type { AstraService } from '../AstraService';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraRatingService } from './AstraRatingService';
import { AstraParserService } from './AstraParserService';
import type { AstraWork } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { syncListEntry, syncAcknowledgement } from '@/test/sync-fixtures';
import { SyncQueueService } from '@core/services/SyncQueueService';
import { ASTRA_MARKERS } from '../utils/AstraConstants';

const work = (): AstraWork => ({
  id: 'w',
  mediaId: 1,
  title: 'Test',
  type: 'anime',
  status: MediaListStatus.COMPLETED,
  customLists: ['Favorites'],
  tags: [],
  notes: 'Old notes',
  updatedAt: 0,
  isPrivate: true,
  isHidden: true,
  progress: 3,
  seasons: [{ scores: { story: 8 }, notes: 'New notes' }],
});

function setup(append = false) {
  const astra = {
    saveWork: vi.fn(async (w: AstraWork) => w),
    getSettings: () => ({
      appendAstraToComment: append,
      autoSync: true,
      enableSeriesFinale: false,
      finaleWeightMultiplier: 1,
    }),
    getSections: () => [{ id: 'story', name: 'Story', weight: 1 }],
  } satisfies Pick<AstraService, 'saveWork' | 'getSettings' | 'getSections'>;
  const query = vi.fn(
    async (_query: string, _variables?: Record<string, unknown>): Promise<unknown> =>
      ratingResponse()
  );
  const mutate = vi.fn(
    async (_query: string, payload: Record<string, unknown> = {}): Promise<unknown> =>
      syncAcknowledgement(Number(payload.mediaId ?? payload.id), 42)
  );
  // Preserve generic API contracts while retaining Vitest's mock controls.
  const api = {
    query: Object.assign(
      async <T>(...args: Parameters<typeof query>): Promise<T> => (await query(...args)) as T,
      query
    ),
    mutate: Object.assign(
      async <T>(...args: Parameters<typeof mutate>): Promise<T> => (await mutate(...args)) as T,
      mutate
    ),
    getCurrentUserId: vi.fn(async () => 42),
    getQueueStatus: () => ({ queueLength: 0, activeRequests: 0, isRateLimited: false }),
  } satisfies Pick<IApiClient, 'query' | 'mutate' | 'getCurrentUserId' | 'getQueueStatus'>;
  const persisted = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string): Promise<T | null> =>
      structuredClone(persisted.get(key) ?? null) as T | null,
    set: async (key: string, value: unknown) => {
      persisted.set(key, structuredClone(value));
      return true;
    },
  } satisfies Pick<IStorageService, 'get' | 'set'>;
  const queue = new SyncQueueService(
    storage as IStorageService,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } satisfies Pick<
      ILogger,
      'info' | 'warn' | 'error' | 'success'
    > as unknown as ILogger,
    api as unknown as IApiClient
  );
  vi.spyOn(queue, 'enqueue');
  const parser = new AstraParserService();
  return {
    astra,
    api,
    queue,
    service: new AstraRatingService(
      astra as unknown as AstraService,
      api as unknown as IApiClient,
      queue,
      parser
    ),
  };
}

describe('AstraRatingService safe persistence and sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('stops before any API write when local persistence fails', async () => {
    const { astra, api, queue, service } = setup();
    astra.saveWork.mockRejectedValue(new Error('Storage failed'));
    await expect(service.saveAndSync(work(), { overallScore: 8 })).rejects.toThrow(
      'Storage failed'
    );
    expect(api.mutate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('performs a strictly local save without fetching notes for skipSync', async () => {
    const { api, queue, service } = setup(true);
    await service.saveAndSync(work(), { overallScore: 8, skipSync: true });
    expect(api.query).not.toHaveBeenCalled();
    expect(api.mutate).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns queued for background dispatch once the write is durable, without awaiting the AniList round-trip', async () => {
    const { queue, service } = setup();
    vi.spyOn(queue, 'process').mockReturnValue(new Promise<void>(() => {}));
    await expect(service.saveAndSync(work(), { overallScore: 8, dispatch: 'background' })).resolves.toBe('queued');
    expect(vi.mocked(queue.enqueue).mock.calls[0][0]).toBe('ASTRA_SAVE');
    expect(queue.process).toHaveBeenCalledTimes(1);
  });

  it('reports synced to onDispatched once the background drain finishes', async () => {
    const { queue, service } = setup();
    vi.mocked(queue.enqueue).mockResolvedValue();
    let finish!: () => void;
    vi.spyOn(queue, 'process').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    vi.spyOn(queue, 'getQueue').mockResolvedValue([]);
    const onDispatched = vi.fn();
    await expect(service.saveAndSync(work(), { overallScore: 8, dispatch: 'background', onDispatched })).resolves.toBe('queued');
    expect(onDispatched).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalledOnce());
    expect(onDispatched).toHaveBeenCalledWith('synced');
  });

  it('reports queued to onDispatched when the save is still pending after the drain', async () => {
    const { queue, service } = setup();
    vi.spyOn(queue, 'process').mockResolvedValue();
    vi.spyOn(queue, 'getQueue').mockResolvedValue([
      { id: 'save', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 1 }, retries: 0 } as never,
    ]);
    const onDispatched = vi.fn();
    await service.saveAndSync(work(), { overallScore: 8, dispatch: 'background', onDispatched });
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalledOnce());
    expect(onDispatched).toHaveBeenCalledWith('queued');
  });

  it('reports queued and keeps the caller unaffected when the background drain throws', async () => {
    const { queue, service } = setup();
    vi.spyOn(queue, 'process').mockRejectedValue(new Error('Offline'));
    const onDispatched = vi.fn();
    await expect(service.saveAndSync(work(), { overallScore: 8, dispatch: 'background', onDispatched })).resolves.toBe('queued');
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalledOnce());
    expect(onDispatched).toHaveBeenCalledWith('queued');
  });

  it('survives a throwing onDispatched callback without an unhandled rejection', async () => {
    const { queue, service } = setup();
    vi.spyOn(queue, 'process').mockResolvedValue();
    vi.spyOn(queue, 'getQueue').mockResolvedValue([]);
    const onDispatched = vi.fn(() => { throw new Error('Callback failed'); });
    await service.saveAndSync(work(), { overallScore: 8, dispatch: 'background', onDispatched });
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalledOnce());
  });

  it('respects cleared notes, zero progress and explicitly empty lists', async () => {
    const { api, service } = setup();
    await service.saveAndSync(work(), { overallScore: 0, notes: '', progress: 0, customLists: [] });
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ notes: '', progress: 0, lists: [] });
  });

  it('omits the score key for a status save when no Astra rating exists, leaving the AniList score untouched', async () => {
    const { api, queue, service } = setup();
    api.mutate.mockRejectedValue(new Error('Offline'));
    await service.saveAndSync(work(), { overallScore: 0, progress: 3 });
    const payload = vi.mocked(queue.enqueue).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('score');
    expect(payload).toMatchObject({ mediaId: 1, progress: 3 });
  });

  it('does not include local notes in a list-only save when the caller did not edit them', async () => {
    const { api, service } = setup();
    await service.saveAndSync(work(), { overallScore: 8, progress: 0, customLists: [] });
    expect(api.mutate.mock.calls[0][1]).not.toHaveProperty('notes');
  });

  it('does not read or rewrite AniList comments for a list-only save when report syncing is enabled', async () => {
    const { api, service } = setup(true);
    await service.saveAndSync(work(), { overallScore: 8, syncAstraNotes: false });
    expect(api.query).not.toHaveBeenCalled();
    expect(api.mutate.mock.calls[0][1]).not.toHaveProperty('notes');
  });

  it('preserves privacy when omitted and does not reset an omitted repeat count', async () => {
    const { api, service } = setup();
    await service.saveAndSync(work(), { overallScore: 7.5 });
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ private: true, hidden: true, score: 75 });
    expect(api.mutate.mock.calls[0][1]!.repeat).toBeUndefined();
  });

  it('queues the complete payload when the immediate mutation fails', async () => {
    const { api, queue, service } = setup();
    api.mutate.mockRejectedValue(new Error('Offline'));
    const extra = {
      overallScore: 8,
      startedAt: { year: 2026, month: 1, day: 1 },
      completedAt: null,
    };
    await service.saveAndSync(work(), extra);
    expect(queue.enqueue).toHaveBeenCalledWith('ASTRA_SAVE', api.mutate.mock.calls[0][1]);
    expect(vi.mocked(queue.enqueue).mock.calls[0][1]).toMatchObject({
      startedAt: extra.startedAt,
      completedAt: null,
    });
  });

  it('propagates a failed durable enqueue instead of reporting success', async () => {
    const { api, queue, service } = setup();
    api.mutate.mockRejectedValue(new Error('Offline'));
    vi.mocked(queue.enqueue).mockRejectedValue(new Error('Queue storage failed'));
    await expect(service.saveAndSync(work(), { overallScore: 8 })).rejects.toThrow(
      'Queue storage failed'
    );
  });

  it('never replaces remote notes with an empty base after a failed fetch', async () => {
    const { api, service } = setup(true);
    api.query.mockRejectedValue(new Error('Offline'));
    await expect(service.saveAndSync(work(), { overallScore: 8 })).rejects.toThrow(/notes/i);
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('preserves text outside the Astra block when syncing notes', async () => {
    const { api, queue, service } = setup(true);
    await service.saveAndSync(work(), { overallScore: 8 });
    expect(api.mutate.mock.calls[0][1]!.notes).toContain('Remote text');
    // General thoughts reach AniList only when they were edited (replaceNotes).
    expect(api.mutate.mock.calls[0][1]!.notes).not.toContain('New notes');
    expect(vi.mocked(queue.enqueue).mock.calls[0][1]).toMatchObject({
      expectedNotes: 'Remote text',
      astraNotesUpdatedAt: 0,
    });
    expect(api.mutate.mock.calls[0][1]).not.toHaveProperty('expectedNotes');
  });

  it('replaces the text outside the Astra block with edited General thoughts', async () => {
    const { api, service } = setup(true);
    await service.saveAndSync(work(), { overallScore: 8, replaceNotes: true });
    expect(api.mutate.mock.calls[0][1]!.notes).toBe('New notes\n\nBREAKDOWN:\n• Story: 8/10');
  });

  it('sends edited General thoughts on a notes-only save even when the report is unchanged', async () => {
    const { api, service } = setup(true);
    await service.saveAndSync(work(), {
      overallScore: 8,
      syncAstraNotes: false,
      replaceNotes: true,
    });
    expect(api.mutate.mock.calls[0][1]!.notes).toBe('New notes\n\nBREAKDOWN:\n• Story: 8/10');
  });

  it.each(['incomplete block', 'oversized report', 'reserved marker'])(
    'keeps the local save and stops dispatch for %s',
    async (failure) => {
      const { astra, api, queue, service } = setup(true);
      const draft = work();
      if (failure === 'incomplete block') {
        const response = ratingResponse();
        response.Media.mediaListEntry.notes = `${ASTRA_MARKERS.HEADER}\nPersonal text without footer`;
        api.query.mockResolvedValue(response);
      } else
        draft.seasons[0].notes =
          failure === 'oversized report' ? 'x'.repeat(6000) : `Review\n${ASTRA_MARKERS.FOOTER}`;
      await expect(
        service.saveAndSync(draft, { overallScore: 8, replaceNotes: true })
      ).rejects.toMatchObject({
        stage: 'NOTES',
        localCommitted: true,
      });
      expect(astra.saveWork).toHaveBeenCalledOnce();
      expect(api.mutate).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    }
  );

  it('omits the automatic report if the option is disabled during the remote read', async () => {
    const { astra, api, service } = setup(true);
    const enabled = astra.getSettings();
    vi.spyOn(astra, 'getSettings')
      .mockReturnValueOnce(enabled)
      .mockReturnValue({ ...enabled, appendAstraToComment: false });
    await service.saveAndSync(work(), { overallScore: 8 });
    expect(api.mutate.mock.calls[0][1]).not.toHaveProperty('notes');
    expect(api.mutate.mock.calls[0][1]).toHaveProperty('score', 80);
  });

  it('loads the manga custom lists and chapter metadata for manga entries', async () => {
    const { api, service } = setup();
    const response = ratingResponse();
    Object.assign(response.Media, { type: 'MANGA', chapters: 20 });
    response.Viewer.mediaListOptions.animeList.customLists = ['Anime'];
    api.query.mockResolvedValue(response);
    expect((await service.getMediaRatingData(1))?.allCustomLists).toEqual(['Manga']);
    expect(api.query.mock.calls[0][0]).toContain('chapters');
    expect(api.query.mock.calls[0][0]).toContain('mangaList');
  });

  it.each([NaN, Infinity, -1, 12])(
    'rejects invalid score %s before writing local or remote data',
    async (score) => {
      const { astra, api, service } = setup();
      await expect(service.saveAndSync(work(), { overallScore: score })).rejects.toThrow(/score/i);
      expect(astra.saveWork).not.toHaveBeenCalled();
      expect(api.mutate).not.toHaveBeenCalled();
    }
  );

  it('returns distinct synced and durably queued results', async () => {
    const { api, service } = setup();
    expect(await service.saveAndSync(work(), { overallScore: 8 })).toBe('synced');
    api.mutate.mockRejectedValue(new Error('Offline'));
    expect(await service.saveAndSync(work(), { overallScore: 8 })).toBe('queued');
  });

  it.each([false, true])(
    'reports whether accepted deletion is still queued (%s)',
    async (pending) => {
      const f = setup();
      vi.mocked(f.queue.enqueue).mockResolvedValue();
      vi.spyOn(f.queue, 'process').mockResolvedValue();
      vi.spyOn(f.queue, 'getQueue').mockResolvedValue(
        pending
          ? [
              {
                id: 'delete',
                type: 'ASTRA_DELETE',
                userId: 42,
                payload: { mediaId: 1 },
                retries: 0,
              },
            ]
          : []
      );
      expect(await f.service.deleteEntry(1)).toBe(pending ? 'queued' : 'synced');
      expect(f.queue.enqueue).toHaveBeenCalledWith('ASTRA_DELETE', { mediaId: 1 });
      expect(f.astra.saveWork).not.toHaveBeenCalled();
    }
  );

  it('marks an owned pending deletion so Quick Edit cannot reopen it as an editable entry', async () => {
    const f = setup();
    vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
      revision: 'deleting',
      entries: [
        { id: 'delete', type: 'ASTRA_DELETE', userId: 42, payload: { mediaId: 1 }, retries: 0 },
      ],
    });
    expect((await f.service.getMediaRatingData(1))?.pendingDeletion).toBe(true);
  });

  it('includes the real previous progress in an increment result', async () => {
    const { api, service } = setup();
    api.query.mockResolvedValue({ MediaList: syncListEntry(1, 42, 3) });
    expect(await service.updateProgress(1)).toMatchObject({
      mediaId: 1,
      progress: 4,
      previousProgress: 3,
      userId: 42,
      status: 'CURRENT',
    });
  });

  it('replaces an older offline save before sending a newer successful save', async () => {
    const { api, queue, service } = setup();
    await queue.enqueue('ASTRA_SAVE', { mediaId: 1, score: 40, notes: 'Old offline note' });
    expect(await service.saveAndSync(work(), { overallScore: 9, notes: 'Latest note' })).toBe(
      'synced'
    );
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ score: 90, notes: 'Latest note' });
    expect(await queue.getQueue()).toEqual([]);
  });

  it('stops synchronization when the account switches while notes are fetched', async () => {
    const { api, service, queue } = setup(true);
    let session = 'one';
    Object.assign(api, {
      getContext: () => ({ sessionId: session, userId: session === 'one' ? 1 : 2 }),
      ensureContext: async () => ({ sessionId: session, userId: session === 'one' ? 1 : 2 }),
    });
    api.query.mockImplementationOnce(async () => {
      session = 'two';
      return ratingResponse(1, 2);
    });
    await expect(
      service.saveAndSync({ ...work(), ownerId: 1 }, { overallScore: 8 })
    ).rejects.toThrow('account changed');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('advances the caller draft version after local commit even if queue persistence fails', async () => {
    const { astra, service, queue } = setup();
    astra.saveWork.mockImplementationOnce(async (w) => ({ ...w, updatedAt: 1234, ownerId: 1 }));
    vi.mocked(queue.enqueue).mockRejectedValueOnce(new Error('Queue write failed'));
    const draft = work();
    await expect(service.saveAndSync(draft, { overallScore: 8 })).rejects.toThrow(
      'Queue write failed'
    );
    expect(draft).toMatchObject({ updatedAt: 1234, ownerId: 1 });
  });

  it.each(['media', 'viewer', 'notes'])(
    'keeps the local save without dispatch when remote %s is unsafe',
    async (field) => {
      const { api, astra, queue, service } = setup(true);
      const response = ratingResponse();
      if (field === 'media') response.Media.id = 2;
      if (field === 'viewer') response.Viewer.id = 43;
      if (field === 'notes') Object.assign(response.Media.mediaListEntry, { notes: undefined });
      api.query.mockResolvedValueOnce(response);
      const draft = work();
      astra.saveWork.mockImplementationOnce(async (w) => ({ ...w, updatedAt: 1234, ownerId: 42 }));
      await expect(service.saveAndSync(draft, { overallScore: 8 })).rejects.toThrow(/notes safely/);
      expect(draft).toMatchObject({ ownerId: 42, updatedAt: 1234 });
      expect(astra.saveWork).toHaveBeenCalledTimes(1);
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(api.mutate).not.toHaveBeenCalled();
    }
  );

  it('uses confirmed null notes as an empty base and writes only the Astra block', async () => {
    const { api, astra, service } = setup(true);
    const response = ratingResponse();
    Object.assign(response.Media.mediaListEntry, { notes: null });
    api.query.mockResolvedValueOnce(response);
    expect(await service.saveAndSync(work(), { overallScore: 8 })).toBe('synced');
    expect(api.mutate.mock.calls[0][1]!.notes).toBe('BREAKDOWN:\n• Story: 8/10');
    // The local General thoughts stay saved locally even though a score save does not send them.
    expect(astra.saveWork.mock.calls[0][0].seasons[0].notes).toBe('New notes');
  });
  it('persists explicit fuzzy dates locally before queueing, retaining Clear and omitted legacy fields', async () => {
    const f = setup();
    const draft = work();
    const startedAt = { year: 2026, month: null, day: 5 };
    await f.service.saveAndSync(draft, {
      overallScore: 8,
      startedAt,
      completedAt: null,
      skipSync: true,
    });
    expect(f.astra.saveWork.mock.calls[0][0]).toMatchObject({ startedAt, completedAt: null });
    expect(draft).toMatchObject({ startedAt, completedAt: null });
    startedAt.year = 1990;
    expect((draft as unknown as { startedAt: { year: number } }).startedAt.year).toBe(2026);
    expect(f.queue.enqueue).not.toHaveBeenCalled();
  });
  it.each(['bad', { year: 0, month: null, day: null }, { year: 2026, month: 2, day: 30 }])(
    'rejects malformed save date %j before local persistence',
    async (startedAt) => {
      const f = setup();
      await expect(
        f.service.saveAndSync(work(), { overallScore: 8, startedAt } as never)
      ).rejects.toThrow();
      expect(f.astra.saveWork).not.toHaveBeenCalled();
      expect(f.queue.enqueue).not.toHaveBeenCalled();
    }
  );
  it('overlays queued dates including Clear onto a remote form response without extra provider queries', async () => {
    const f = setup();
    await f.queue.enqueue('ASTRA_SAVE', {
      mediaId: 1,
      startedAt: null,
      completedAt: { year: 2027 },
    });
    const snapshot = await f.queue.getSnapshot();
    vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
      ...snapshot,
      entries: snapshot.entries.map((entry) => ({ ...entry, userId: 42 })),
    });
    const result = await f.service.getMediaRatingData(1);
    expect(result?.media.mediaListEntry).toMatchObject({
      startedAt: null,
      completedAt: { year: 2027, month: null, day: null },
    });
    expect(f.api.query).toHaveBeenCalledOnce();
  });
  it('lets this viewer’s durable queued list fields beat a stale AniList response', async () => {
    const f = setup();
    await f.queue.enqueue('ASTRA_SAVE', {
      mediaId: 1,
      status: 'PLANNING',
      progress: 0,
      repeat: 2,
      private: true,
      hidden: true,
      lists: [],
    });
    const snapshot = await f.queue.getSnapshot();
    vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
      ...snapshot,
      entries: snapshot.entries.map((entry) => ({ ...entry, userId: 42 })),
    });

    const result = await f.service.getMediaRatingData(1);
    expect(result?.media.mediaListEntry).toMatchObject({
      status: 'PLANNING',
      progress: 0,
      repeat: 2,
      private: true,
      hiddenFromStatusLists: true,
      customLists: {},
    });
    expect(result?.pendingListState).toMatchObject({
      status: 'PLANNING',
      progress: 0,
      repeat: 2,
      private: true,
      hidden: true,
      customLists: [],
    });
  });
  it('retries an old form response if background synchronization completes during the read', async () => {
    const f = setup();
    vi.spyOn(f.queue, 'getSnapshot')
      .mockResolvedValue({ revision: 'two', entries: [] })
      .mockResolvedValueOnce({ revision: 'one', entries: [] });
    const fresh = ratingResponse();
    fresh.Media.mediaListEntry.progress = 4;
    f.api.query.mockResolvedValueOnce(ratingResponse()).mockResolvedValueOnce(fresh);
    expect((await f.service.getMediaRatingData(1))?.media.mediaListEntry?.progress).toBe(4);
    expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('bounds retries when the pending revision keeps changing', async () => {
    const f = setup();
    let revision = 0;
    vi.spyOn(f.queue, 'getSnapshot').mockImplementation(async () => ({
      revision: `r${revision++}`,
      entries: [],
    }));
    expect(await f.service.getMediaRatingData(1)).toBeNull();
    expect(f.api.query).toHaveBeenCalledTimes(3);
  });
  it.each([undefined, 43])(
    'does not attribute pending dates owned by %s to the current viewer',
    async (owner) => {
      const f = setup();
      vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
        revision: 'foreign',
        entries: [
          {
            id: 'foreign-date',
            type: 'ASTRA_SAVE',
            payload: { mediaId: 1, startedAt: null },
            retries: 0,
            userId: owner,
          },
        ],
      });
      expect((await f.service.getMediaRatingData(1))?.media.mediaListEntry?.startedAt?.year).toBe(
        2026
      );
    }
  );
  it('preserves queued dates separately when the remote entry has not been created yet', async () => {
    const f = setup();
    const response = ratingResponse();
    Object.assign(response.Media, { mediaListEntry: null });
    f.api.query.mockResolvedValueOnce(response);
    vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
      revision: 'pending-new',
      entries: [
        {
          id: 'new-date',
          type: 'ASTRA_SAVE',
          payload: { mediaId: 1, startedAt: { year: 2027 }, completedAt: null },
          retries: 0,
          userId: 42,
        },
      ],
    });
    const result = await f.service.getMediaRatingData(1);
    expect(result?.media.mediaListEntry).toBeNull();
    expect(result?.pendingDates).toEqual({
      startedAt: { year: 2027, month: null, day: null },
      completedAt: null,
    });
  });
  it('omits the Astra score when syncScore is false, so a stale local score cannot overwrite AniList', async () => {
    const { api, service } = setup();
    await service.saveAndSync(work(), { overallScore: 8, syncScore: false, progress: 3 });
    expect(api.mutate.mock.calls[0][1]).not.toHaveProperty('score');
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ progress: 3 });
  });
  it('still sends the Astra score by default', async () => {
    const { api, service } = setup();
    await service.saveAndSync(work(), { overallScore: 8 });
    expect(api.mutate.mock.calls[0][1]).toMatchObject({ score: 80 });
  });
  it.each([
    {
      label: 'notes',
      entry: {
        type: 'ASTRA_SAVE' as const,
        userId: 42,
        payload: { mediaId: 1, notes: 'Queued note' },
      },
      expected: true,
    },
    {
      label: 'score',
      entry: { type: 'ASTRA_SAVE' as const, userId: 42, payload: { mediaId: 1, score: 80 } },
      expected: true,
    },
    {
      label: 'progress only',
      entry: { type: 'ASTRA_SAVE' as const, userId: 42, payload: { mediaId: 1, progress: 4 } },
      expected: false,
    },
    {
      label: 'another account',
      entry: {
        type: 'ASTRA_SAVE' as const,
        userId: 7,
        payload: { mediaId: 1, notes: 'Queued note' },
      },
      expected: false,
    },
  ])(
    'reports pendingReport for a queued $label entry as $expected',
    async ({ entry, expected }) => {
      const f = setup();
      vi.spyOn(f.queue, 'getSnapshot').mockResolvedValue({
        revision: 'queued',
        entries: [{ id: 'save', retries: 0, ...entry }],
      });
      expect((await f.service.getMediaRatingData(1))?.pendingReport).toBe(expected);
    }
  );
});

describe('AstraRatingService hover prefetch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const withContext = (f: ReturnType<typeof setup>, context = { sessionId: 's1', userId: 42 }) => {
    const ctx = { current: context };
    Object.assign(f.api, { getContext: () => ctx.current, ensureContext: async () => ctx.current });
    return ctx;
  };

  it('opens from a settled prefetch without a second AniList read', async () => {
    const f = setup();
    withContext(f);
    f.service.prefetchMediaRatingData(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect((await f.service.getMediaRatingData(1))?.media.id).toBe(1);
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the hover leaves before the dwell elapses', async () => {
    const f = setup();
    withContext(f);
    f.service.prefetchMediaRatingData(1);
    await vi.advanceTimersByTimeAsync(100);
    f.service.cancelPrefetch();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.api.query).not.toHaveBeenCalled();
  });

  it('caps prefetches per minute and keeps them out of the priority lane', async () => {
    const f = setup();
    withContext(f);
    for (let id = 1; id <= 6; id++) {
      f.service.prefetchMediaRatingData(id);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(f.api.query).toHaveBeenCalledTimes(4);
    expect(f.api.query.mock.calls.every((call) => call.length < 4)).toBe(true);
  });

  it('reads again when the account changed after the prefetch', async () => {
    const f = setup();
    const ctx = withContext(f);
    f.service.prefetchMediaRatingData(1);
    await vi.advanceTimersByTimeAsync(200);
    ctx.current = { sessionId: 's2', userId: 42 };
    await f.service.getMediaRatingData(1);
    expect(f.api.query).toHaveBeenCalledTimes(2);
  });

  it('reads again when the sync queue changed after the prefetch', async () => {
    const f = setup();
    withContext(f);
    vi.spyOn(f.queue, 'getSnapshot')
      .mockResolvedValue({ revision: 'two', entries: [] })
      .mockResolvedValueOnce({ revision: 'one', entries: [] });
    f.service.prefetchMediaRatingData(1);
    await vi.advanceTimersByTimeAsync(200);
    await f.service.getMediaRatingData(1);
    expect(f.api.query).toHaveBeenCalledTimes(2);
  });
});
