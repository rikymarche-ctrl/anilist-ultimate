import { describe, expect, it, vi } from 'vitest';
import { CalendarService } from './CalendarService';
import { availableEpisodes } from './CalendarAiring';
import { calendarCollection, calendarListEntry } from '@/test/calendar-fixtures';
import { syncListEntry } from '@/test/sync-fixtures';
import { SyncQueueService } from '@core/services/SyncQueueService';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function fixture() {
  let context = { userId: 1, sessionId: 'one' };
  const api = { ensureContext: vi.fn(async () => ({ ...context })), getContext: () => context,
    query: vi.fn(async (_query: string, _variables: Record<string, unknown>): Promise<unknown> => calendarCollection()) };
  const queue = { getQueue: vi.fn(async (): Promise<unknown> => []) };
  const snapshots = { getSnapshot: async () => ({ revision: 'fixture', entries: await queue.getQueue() }) };
  const service = new CalendarService(api as never, {} as never, {} as never, { ...queue, ...snapshots } as never);
  return { service, api, queue, changeAccount: () => { context = { userId: 2, sessionId: 'two' }; } };
}
function pending(progress: number | null, userId = 1, status?: string) {
  return { id: 'pending', userId, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress, ...(status ? { status } : {}) }, retries: 0 };
}

describe('calendar startup request cost', () => {
  it('loads current and repeating titles in one chunk without downloading a large completed list', async () => {
    const f = fixture();
    const rows = [calendarListEntry(), { ...calendarListEntry(2), status: 'REPEATING' },
      ...Array.from({ length: 1200 }, (_, index) => ({ ...calendarListEntry(index + 3), status: 'COMPLETED' }))];
    f.api.query.mockImplementation(async (query, variables) => {
      const statuses = query.includes('status_in: $statuses') ? variables.statuses as string[] | null : null;
      const selected = statuses ? rows.filter(row => statuses.includes(row.status)) : rows;
      const start = (Number(variables.chunk) - 1) * 500;
      return calendarCollection(selected.slice(start, start + 500), start + 500 < selected.length);
    });
    expect((await f.service.fetchAiringSchedule(1)).map(entry => entry.mediaId)).toEqual([1, 2]);
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });

  it.each(['CURRENT', 'REPEATING'])('includes titles entering the calendar through an unsynced %s status change', async status => {
    const f = fixture();
    f.queue.getQueue.mockResolvedValue([pending(0, 1, status)]);
    f.api.query.mockImplementation(async (query, variables) => {
      const statuses = query.includes('status_in: $statuses') ? variables.statuses as string[] | null : null;
      return calendarCollection(!statuses || statuses.includes('PLANNING') ? [{ ...calendarListEntry(), status: 'PLANNING' }] : []);
    });
    expect(await f.service.fetchAiringSchedule(1)).toEqual([expect.objectContaining({ mediaId: 1, progress: 0 })]);
  });

  it('widens a retried read if a queued edit activates a title during the filtered request', async () => {
    const f = fixture(); let revision = 'before';
    const queue = { getSnapshot: async () => ({ revision, entries: revision === 'before' ? [] : [pending(0, 1, 'CURRENT')] }) };
    const service = new CalendarService(f.api as never, {} as never, {} as never, queue as never);
    f.api.query.mockImplementation(async (query, variables) => {
      const statuses = query.includes('status_in: $statuses') ? variables.statuses as string[] | null : null;
      revision = 'after';
      return calendarCollection(!statuses || statuses.includes('PLANNING') ? [{ ...calendarListEntry(), status: 'PLANNING' }] : []);
    });
    expect(await service.fetchAiringSchedule(1)).toEqual([expect.objectContaining({ mediaId: 1, progress: 0 })]);
    expect(f.api.query).toHaveBeenCalledTimes(2);
  });
});

describe('calendar external response boundaries', () => {
  it('loads all chunks, deduplicating the same entry grouped in custom lists', async () => {
    const f = fixture(); const row = calendarListEntry();
    f.api.query.mockResolvedValueOnce(calendarCollection([row, row], true)).mockResolvedValueOnce(calendarCollection([calendarListEntry(2)]));
    const entries = await f.service.fetchAiringSchedule(1);
    expect(entries.map(e => e.mediaId)).toEqual([1, 2]);
    expect(f.api.query.mock.calls.map(call => call[1])).toEqual([
      { userId: 1, type: 'ANIME', chunk: 1, perChunk: 500, statuses: ['CURRENT', 'REPEATING'] },
      { userId: 1, type: 'ANIME', chunk: 2, perChunk: 500, statuses: ['CURRENT', 'REPEATING'] },
    ]);
  });
  it.each([0, -1, 1.5, 2147483648])('rejects invalid owner %s before context, queue or query', async owner => {
    const f = fixture(); await expect(f.service.fetchAiringSchedule(owner)).rejects.toThrow('owner');
    expect(f.api.ensureContext).not.toHaveBeenCalled(); expect(f.queue.getQueue).not.toHaveBeenCalled(); expect(f.api.query).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 2 }, { mediaId: 3 }, { id: 0 }, { progress: -1 }, { progress: '2' }, { status: 'WATCHING' },
    { media: undefined }, { media: { ...calendarListEntry().media, id: 2 } },
    { media: { ...calendarListEntry().media, title: {} } }, { media: { ...calendarListEntry().media, episodes: -1 } },
    { media: { ...calendarListEntry().media, type: 'CHARACTER' } },
    { media: { ...calendarListEntry().media, coverImage: { large: {} } } },
    { media: { ...calendarListEntry().media, nextAiringEpisode: { ...calendarListEntry().media.nextAiringEpisode, mediaId: 2 } } },
    { media: { ...calendarListEntry().media, nextAiringEpisode: { ...calendarListEntry().media.nextAiringEpisode, episode: 0 } } },
    { media: { ...calendarListEntry().media, nextAiringEpisode: { ...calendarListEntry().media.nextAiringEpisode, airingAt: NaN } } },
  ])('rejects malformed or unrelated rows: %j', async patch => {
    const f = fixture(); f.api.query.mockResolvedValue(calendarCollection([{ ...calendarListEntry(), ...patch }]));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('calendar');
  });
  it.each([{}, { MediaListCollection: null }, { MediaListCollection: { ...calendarCollection().MediaListCollection, user: { id: 2 } } },
    { MediaListCollection: { ...calendarCollection().MediaListCollection, hasNextChunk: 'yes' } }])('rejects invalid collection envelopes: %j', async response => {
    const f = fixture(); f.api.query.mockResolvedValue(response); await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('calendar');
  });
  it('normalizes documented nullable fields without rejecting a valid schedule', async () => {
    const f = fixture(); const row = calendarListEntry();
    f.api.query.mockResolvedValue(calendarCollection([null, { ...row, progress: null, media: { ...row.media, title: null, coverImage: null, siteUrl: null, episodes: null } },
      { ...calendarListEntry(2), media: null }]));
    expect(await f.service.fetchAiringSchedule(1)).toEqual([expect.objectContaining({ mediaId: 1, title: 'Anime 1', progress: 0, coverImage: '', totalEpisodes: null })]);
  });
  it('preserves filtering policy and catch-up entries on a releasing cour break', async () => {
    const f = fixture(); const row = calendarListEntry();
    f.api.query.mockResolvedValue(calendarCollection([
      { ...row, media: { ...row.media, nextAiringEpisode: null } },
      { ...calendarListEntry(2), status: 'PLANNING' }, { ...calendarListEntry(3), status: 'REPEATING' },
      { ...calendarListEntry(4), media: { ...calendarListEntry(4).media, type: 'MANGA' } },
      { ...calendarListEntry(5), media: { ...calendarListEntry(5).media, nextAiringEpisode: null, status: 'FINISHED' } },
    ]));
    const entries = await f.service.fetchAiringSchedule(1);
    expect(entries.map(e => e.mediaId).sort()).toEqual([1, 3]); // The break row has no aired count from the planned total: it is listed at progress with no behind count.
    expect(entries.find(e => e.mediaId === 1)).toMatchObject({ episode: 10, progress: 10 });
    expect(availableEpisodes(entries.find(e => e.mediaId === 1)!)).toBe(10);
  });
  it('marks schedule-backed rows as airing and leaves catch-up rows unmarked', async () => {
    const f = fixture(); const row = calendarListEntry();
    f.api.query.mockResolvedValue(calendarCollection([row, { ...calendarListEntry(2), media: { ...calendarListEntry(2).media, nextAiringEpisode: null } }]));
    const entries = await f.service.fetchAiringSchedule(1);
    expect(entries.find(e => e.mediaId === 1)?.calendarKind).toBe('airing');
    expect(entries.find(e => e.mediaId === 2)?.calendarKind).toBeUndefined();
  });
  it('shows no behind count for a releasing show between cours even when the planned total is higher', async () => {
    const f = fixture(); const row = calendarListEntry();
    f.api.query.mockResolvedValue(calendarCollection([{ ...row, progress: 12, media: { ...row.media, episodes: 24, nextAiringEpisode: null } }]));
    const [entry] = await f.service.fetchAiringSchedule(1);
    expect(entry).toMatchObject({ mediaId: 1, episode: 12, progress: 12, totalEpisodes: 24 });
    expect(availableEpisodes(entry)).toBe(12);
  });
  it('keeps a returning show whose stored plan total was already reached', async () => {
    const f = fixture(); const row = calendarListEntry();
    const plan = { mediaId: 1, title: 'Plan 1', coverImage: '', siteUrl: 'https://anilist.co/anime/1', totalEpisodes: 12, progress: 12, dayOfWeek: 'Monday' as const, time: '20:00' };
    f.api.query.mockResolvedValue(calendarCollection([{ ...row, progress: 12, media: { ...row.media, episodes: 24 } }]));
    expect((await f.service.fetchAiringSchedule(1, [plan])).map(e => e.mediaId)).toEqual([1]);
  });
  it('rejects conflicting duplicates instead of silently keeping an arbitrary progress', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(calendarCollection([calendarListEntry(), { ...calendarListEntry(), progress: 9 }]));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('calendar');
  });
  it('rejects a non-advancing chunk rather than publishing a partial collection', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(calendarCollection([calendarListEntry()], true));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('calendar'); expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('does not query the next chunk after an account change', async () => {
    const f = fixture(); f.api.query.mockImplementationOnce(async () => { f.changeAccount(); return calendarCollection([calendarListEntry()], true); });
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('account changed'); expect(f.api.query).toHaveBeenCalledTimes(1);
  });
  it('stops before any query when account changes during context initialization', async () => {
    const f = fixture(); f.api.ensureContext.mockImplementationOnce(async () => { f.changeAccount(); return { userId: 1, sessionId: 'one' }; });
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('account changed'); expect(f.api.query).not.toHaveBeenCalled();
  });
  it('refuses oversized chunks and an endless collection rather than truncating them', async () => {
    const f = fixture(); f.api.query.mockResolvedValueOnce(calendarCollection(Array.from({ length: 501 }, (_, index) => calendarListEntry(index + 1))));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('calendar chunk size');
    f.api.query.mockImplementation(async (_query, variables) => calendarCollection([calendarListEntry(Number(variables.chunk))], true));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('Incomplete calendar collection'); expect(f.api.query).toHaveBeenCalledTimes(101);
  });
  it('accepts explicit nullable collection arrays and excludes null status', async () => {
    const f = fixture(); f.api.query.mockResolvedValueOnce({ MediaListCollection: { user: null, lists: null, hasNextChunk: null } });
    expect(await f.service.fetchAiringSchedule(1)).toEqual([]);
    f.api.query.mockResolvedValueOnce(calendarCollection([null, { ...calendarListEntry(), status: null }]));
    expect(await f.service.fetchAiringSchedule(1)).toEqual([]);
  });
  it('rejects one list entry ID used for different media across chunks', async () => {
    const f = fixture(); f.api.query.mockResolvedValueOnce(calendarCollection([calendarListEntry()], true))
      .mockResolvedValueOnce(calendarCollection([{ ...calendarListEntry(2), id: calendarListEntry().id }]));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('Conflicting calendar entries');
  });
});

describe('calendar local queued progress', () => {
  it.each([0, 5, 11])('uses the exact queued progress %s, including deliberate decreases and zero', async progress => {
    const f = fixture(); f.queue.getQueue.mockResolvedValue([pending(progress)]);
    expect((await f.service.fetchAiringSchedule(1))[0].progress).toBe(progress);
  });
  it('ignores other owners and unowned recovery records', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValue([pending(99, 2), { ...pending(88), userId: undefined }]);
    expect((await f.service.fetchAiringSchedule(1))[0].progress).toBe(10);
  });
  it('keeps progress captured before a stale provider read even if sync finishes meanwhile', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValueOnce([pending(11)]).mockResolvedValueOnce([]);
    expect((await f.service.fetchAiringSchedule(1))[0].progress).toBe(11);
  });
  it('uses a newer queued value written while the provider read was in flight', async () => {
    const f = fixture(); const gate = deferred<unknown>(); f.api.query.mockReturnValueOnce(gate.promise);
    f.queue.getQueue.mockResolvedValueOnce([pending(11)]).mockResolvedValueOnce([pending(3)]);
    const loaded = f.service.fetchAiringSchedule(1); await vi.waitFor(() => expect(f.api.query).toHaveBeenCalled());
    gate.resolve(calendarCollection()); expect((await loaded)[0].progress).toBe(3);
  });
  it('applies queued status before filtering so completed work leaves the calendar', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValue([pending(12, 1, 'COMPLETED')]);
    expect(await f.service.fetchAiringSchedule(1)).toEqual([]);
  });
  it('does not guess remote progress when reading the durable queue fails', async () => {
    const f = fixture(); f.queue.getQueue.mockRejectedValue(new Error('queue unavailable'));
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('queue unavailable'); expect(f.api.query).not.toHaveBeenCalled();
  });
  it('rejects corrupt pending values rather than silently regressing progress', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValue([pending(-1)]);
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow(); expect(f.api.query).not.toHaveBeenCalled();
  });
  it('reads current queue changes, ignores explicit null progress and preserves zero/status', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValue([{ ...pending(null), type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 0, status: 'REPEATING' } }]);
    expect((await f.service.fetchAiringSchedule(1))[0].progress).toBe(0);
    f.queue.getQueue.mockResolvedValue([pending(null)]); expect((await f.service.fetchAiringSchedule(1))[0].progress).toBe(10);
  });
  it('rejects an account change during the final queue read', async () => {
    const f = fixture(); f.queue.getQueue.mockResolvedValueOnce([]).mockImplementationOnce(async () => { f.changeAccount(); return []; });
    await expect(f.service.fetchAiringSchedule(1)).rejects.toThrow('account changed');
  });
  it('recovers the exact unsynced progress from the real durable queue after reopening storage', async () => {
    vi.useFakeTimers();
    try {
      const values = new Map<string, unknown>();
      const storage = { get: async (key: string) => structuredClone(values.get(key) ?? null),
        set: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); return true; } };
      const auth = { ensureInitialized: async () => {}, hasToken: () => true, getSessionId: () => 'one', getUserCache: () => ({ userId: 1 }) };
      const api = { ensureContext: async () => ({ userId: 1, sessionId: 'one' }), getContext: () => ({ userId: 1, sessionId: 'one' }),
        getQueueStatus: () => ({ isRateLimited: false }),
        query: vi.fn(async (query: string) => query.includes('MediaList(')
          ? { MediaList: syncListEntry(1, 1, 10) }
          : calendarCollection()), mutate: vi.fn(async () => { throw new Error('Synthetic network offline'); }) };
      const logger = { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
      const queue = new SyncQueueService(storage as never, logger as never, api as never, auth as never);
      expect((await queue.updateProgress(1, 3, 'one')).syncState).toBe('queued');
      const reopened = new SyncQueueService(storage as never, logger as never, api as never, auth as never);
      const service = new CalendarService(api as never, {} as never, {} as never, reopened);
      expect((await service.fetchAiringSchedule(1))[0].progress).toBe(3);
      expect((await reopened.getQueue())[0].payload.progress).toBe(3);
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
});


describe('calendar revision retries', () => {
  it('restarts all chunks when revision changes between chunk reads', async () => {
    const f = fixture(); let revision = 'first';
    const queue = { getSnapshot: async () => ({ revision, entries: [] }) };
    f.api.query.mockImplementation(async (_query, variables) => {
      if (variables.chunk === 1) return calendarCollection([{ ...calendarListEntry(), progress: revision === 'first' ? 10 : 0 }], true);
      revision = 'second'; return calendarCollection([calendarListEntry(2)]);
    });
    const service = new CalendarService(f.api as never, {} as never, {} as never, queue as never);
    expect((await service.fetchAiringSchedule(1))[0].progress).toBe(0);
    expect(f.api.query.mock.calls.map(call => call[1].chunk)).toEqual([1, 2, 1, 2]);
  });
  it('fails explicitly instead of returning a stale collection under continuous queue changes', async () => {
    const f = fixture(); let revision = 0;
    const service = new CalendarService(f.api as never, {} as never, {} as never,
      { getSnapshot: async () => ({ revision: `revision-${revision++}`, entries: [] }) } as never);
    await expect(service.fetchAiringSchedule(1)).rejects.toThrow('changed during loading'); expect(f.api.query).toHaveBeenCalledTimes(3);
  });
});
