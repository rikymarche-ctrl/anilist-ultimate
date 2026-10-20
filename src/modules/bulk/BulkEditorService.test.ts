import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BulkEditorService,
  bulkRoute,
  bulkRouteOwner,
  type BulkEdit,
  type BulkSnapshot,
} from './BulkEditorService';

const context = { sessionId: 'session-a', userId: 10 };
const remote = (mediaId = 1, customLists: Record<string, boolean> = { Existing: true }) => ({
  id: mediaId + 100,
  userId: 10,
  mediaId,
  status: 'PLANNING',
  customLists,
  media: { id: mediaId, type: 'ANIME' },
});
function page(
  entries: unknown[] = [remote()],
  next = false,
  names = ['Existing', 'Priority'],
  name = 'ExAstra'
) {
  return {
    MediaListCollection: {
      user: {
        id: 10,
        name,
        mediaListOptions: {
          animeList: { customLists: names },
          mangaList: { customLists: ['Manga only'] },
        },
      },
      hasNextChunk: next,
      lists: [{ entries }],
    },
  };
}
function fixture() {
  let current = { ...context };
  const api = {
    ensureContext: vi.fn(async () => ({ ...current })),
    getContext: () => ({ ...current }),
    isAuthenticated: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => ({ id: 10, name: 'ExAstra' })),
    query: vi.fn(async () => page()),
    mutate: vi.fn(async (_query: string, variables: Record<string, unknown>) => ({
      SaveMediaListEntry: {
        ...remote(Number(variables.id) - 100),
        status: variables.status ?? 'PLANNING',
        customLists: variables.customLists
          ? Object.fromEntries((variables.customLists as string[]).map((name) => [name, true]))
          : { Existing: true },
      },
    })),
  };
  const queue = {
    getSnapshot: vi.fn(async () => ({
      revision: 'empty',
      entries: [] as Array<{ userId: number; payload: { mediaId: number } }>,
    })),
  };
  return {
    api,
    queue,
    service: new BulkEditorService(api as never, queue as never),
    switchAccount: () => {
      current = { sessionId: 'session-b', userId: 20 };
    },
  };
}
const active = () => true;
beforeEach(() => {
  history.replaceState({}, '', '/user/ExAstra/animelist');
});

describe('bulk editor ownership and reads', () => {
  it('accepts nullable empty memberships and end-of-collection metadata', async () => {
    const f = fixture();
    const response = page([{ ...remote(), customLists: null }]);
    f.api.query.mockResolvedValue({
      ...response,
      MediaListCollection: { ...response.MediaListCollection, hasNextChunk: null },
    } as never);
    expect((await f.service.load('ANIME', active)).entries.get(1)?.customLists).toEqual([]);
  });
  it('matches any profile list route, including list filters and trailing slashes', () => {
    for (const path of [
      '/user/ExAstra/animelist',
      '/user/exastra/animelist/Planning',
      '/user/Riccardo/animelist/',
    ])
      expect(bulkRoute(path)).toBe('ANIME');
    expect(bulkRoute('/user/ExAstra/mangalist/Reading')).toBe('MANGA');
    expect(bulkRouteOwner('/user/Riccardo/mangalist/Reading')).toBe('Riccardo');
    for (const path of [
      '/user/ExAstra',
      '/user/ExAstra/animelist-other',
      '/user/ExAstra/favourites',
      '/anime/1',
    ]) {
      expect(bulkRoute(path)).toBeNull();
      expect(bulkRouteOwner(path)).toBeNull();
    }
  });
  it('deduplicates entries repeated in custom groups and handles chunks', async () => {
    const f = fixture();
    const first = page([remote()], true);
    first.MediaListCollection.lists.push({ entries: [remote()] });
    f.api.query.mockResolvedValueOnce(first).mockResolvedValueOnce(page([remote(2)]));
    const snapshot = await f.service.load('ANIME', active);
    expect([...snapshot.entries.keys()]).toEqual([1, 2]);
    expect(snapshot.lists).toEqual(['Existing', 'Priority']);
    expect(f.api.query.mock.calls).toHaveLength(2);
  });
  it('does not read the collection for another authenticated owner', async () => {
    const f = fixture();
    f.api.getCurrentUser.mockResolvedValue({ id: 10, name: 'Other' });
    await expect(f.service.load('ANIME', active)).rejects.toThrow('owns this list');
    expect(f.api.query).not.toHaveBeenCalled();
  });
  it("loads the signed-in viewer's own list under any username, ignoring case", async () => {
    history.replaceState({}, '', '/user/riccardo/animelist');
    const f = fixture();
    f.api.getCurrentUser.mockResolvedValue({ id: 10, name: 'Riccardo' });
    f.api.query.mockResolvedValue(page([remote()], false, ['Existing'], 'Riccardo'));
    const snapshot = await f.service.load('ANIME', active);
    expect([...snapshot.entries.keys()]).toEqual([1]);
  });
  it('reports the viewer name only while a session exists', async () => {
    const f = fixture();
    expect(await f.service.viewerName()).toBe('ExAstra');
    f.api.isAuthenticated.mockReturnValue(false);
    expect(await f.service.viewerName()).toBeNull();
    expect(f.api.getCurrentUser).toHaveBeenCalledTimes(1);
  });
  it('rejects logout, account changes, navigation and retired sessions', async () => {
    for (const mode of ['logout', 'account', 'route', 'retired']) {
      history.replaceState({}, '', '/user/ExAstra/animelist');
      const f = fixture();
      f.api.query.mockImplementation(async () => {
        if (mode === 'logout') f.api.isAuthenticated.mockReturnValue(false);
        if (mode === 'account') f.switchAccount();
        if (mode === 'route') history.replaceState({}, '', '/user/Other/animelist');
        return page();
      });
      let calls = 0;
      await expect(
        f.service.load('ANIME', () => mode !== 'retired' || ++calls < 3)
      ).rejects.toThrow();
    }
  });
  it.each([
    () => ({ MediaListCollection: null }),
    () => page([{ ...remote(), userId: 20 }]),
    () => page([{ ...remote(), media: { id: 1, type: 'MANGA' } }]),
    () => page([{ ...remote(), customLists: { Existing: 'true' } }]),
    () => page([{ ...remote(), status: 'UNKNOWN' }]),
    () => page([remote(), { ...remote(), id: 900 }]),
    () => page([remote(), { ...remote(2), id: 101 }]),
  ])('rejects malformed or conflicting collection identities', async (build) => {
    const f = fixture();
    f.api.query.mockResolvedValue(build() as never);
    await expect(f.service.load('ANIME', active)).rejects.toThrow();
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('rejects non-advancing chunks', async () => {
    const f = fixture();
    f.api.query.mockResolvedValue(page([remote()], true));
    await expect(f.service.load('ANIME', active)).rejects.toThrow();
    expect(f.api.query).toHaveBeenCalledTimes(2);
  });
  it('loads manga custom lists separately', async () => {
    history.replaceState({}, '', '/user/ExAstra/mangalist');
    const f = fixture();
    f.api.query.mockResolvedValue(page([{ ...remote(), media: { id: 1, type: 'MANGA' } }]));
    expect((await f.service.load('MANGA', active)).lists).toEqual(['Manga only']);
  });
});

describe('bulk editor writes', () => {
  let f: ReturnType<typeof fixture>;
  let snapshot: BulkSnapshot;
  beforeEach(async () => {
    f = fixture();
    snapshot = await f.service.load('ANIME', active);
  });
  it('blocks pending Astra writes for selected entries before any mutation', async () => {
    f.queue.getSnapshot.mockResolvedValue({
      revision: 'queued',
      entries: [{ userId: 10, payload: { mediaId: 1 } }],
    });
    await expect(
      f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn())
    ).rejects.toThrow('Wait for Astra');
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('rejects queue revision changes during preflight even with an empty queue', async () => {
    f.queue.getSnapshot
      .mockResolvedValueOnce({ revision: 'before', entries: [] })
      .mockResolvedValueOnce({ revision: 'after', entries: [] });
    await expect(
      f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn())
    ).rejects.toThrow('Wait for Astra');
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('rejects a second batch while a save is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.api.query.mockImplementationOnce(async () => {
      await gate;
      return page();
    });
    const first = f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn());
    await expect(
      f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn())
    ).rejects.toThrow('already running');
    release();
    expect((await first).saved).toEqual([1]);
  });
  it('stops new writes after an account change during a request', async () => {
    f.api.query.mockResolvedValue(page([remote(1), remote(2)]));
    snapshot = await f.service.load('ANIME', active);
    f.api.mutate.mockImplementationOnce(async () => {
      f.switchAccount();
      return { SaveMediaListEntry: { ...remote(), status: 'CURRENT' } };
    });
    const result = await f.service.apply(
      snapshot,
      [1, 2],
      { lists: {}, status: 'CURRENT' },
      active,
      vi.fn()
    );
    expect(result).toEqual({ saved: [], failed: 1, remaining: [1, 2] });
    expect(f.api.mutate).toHaveBeenCalledTimes(1);
  });
  it('uses fresh memberships, sends only chosen fields, and confirms the response', async () => {
    f.api.query.mockResolvedValue(page([remote(1, { Existing: true, 'Added elsewhere': true })]));
    const onSaved = vi.fn();
    expect(
      await f.service.apply(snapshot, [1, 1], { lists: { Priority: 'add' } }, active, onSaved)
    ).toEqual({ saved: [1], failed: null, remaining: [] });
    expect(f.api.mutate.mock.calls[0][1]).toEqual({
      id: 101,
      customLists: ['Added elsewhere', 'Existing', 'Priority'],
    });
    expect(onSaved).toHaveBeenCalledWith(1, 1, 1);
  });
  it('removes only the chosen list, preserving unrelated memberships', async () => {
    f.api.query.mockResolvedValue(page([remote(1, { Existing: true, Priority: true })]));
    await f.service.apply(snapshot, [1], { lists: { Existing: 'remove' } }, active, vi.fn());
    expect(f.api.mutate.mock.calls[0][1]).toEqual({ id: 101, customLists: ['Priority'] });
  });
  it('does not send memberships, notes, scores, progress or dates for a status-only edit', async () => {
    await f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn());
    expect(f.api.mutate.mock.calls[0][1]).toEqual({ id: 101, status: 'CURRENT' });
  });
  it('skips already satisfied updates', async () => {
    expect(
      (await f.service.apply(snapshot, [1], { lists: { Existing: 'add' } }, active, vi.fn())).saved
    ).toEqual([1]);
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('preflights every identity and configured list before any mutation', async () => {
    for (const response of [
      page([]),
      page([{ ...remote(), id: 999 }]),
      page([remote()], false, ['Existing']),
    ]) {
      f.api.query.mockResolvedValue(response);
      await expect(
        f.service.apply(snapshot, [1], { lists: { Priority: 'add' } }, active, vi.fn())
      ).rejects.toThrow();
    }
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('stops after an uncertain request and reports only confirmed successes', async () => {
    f.api.query.mockResolvedValue(page([remote(1), remote(2), remote(3)]));
    snapshot = await f.service.load('ANIME', active);
    f.api.mutate
      .mockImplementationOnce(
        async (_query, variables) =>
          ({ SaveMediaListEntry: { ...remote(), status: variables.status } }) as never
      )
      .mockRejectedValueOnce(new Error('Network error'));
    const result = await f.service.apply(
      snapshot,
      [1, 2, 3],
      { lists: {}, status: 'CURRENT' },
      active,
      vi.fn()
    );
    expect(result).toEqual({ saved: [1], failed: 2, remaining: [2, 3] });
    expect(f.api.mutate).toHaveBeenCalledTimes(2);
  });
  it('rejects mismatched confirmation without marking the entry saved', async () => {
    f.api.mutate.mockResolvedValue({ SaveMediaListEntry: { ...remote(), userId: 99 } });
    const onSaved = vi.fn();
    expect(
      await f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, onSaved)
    ).toEqual({ saved: [], failed: 1, remaining: [1] });
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('rejects stale accounts before writing', async () => {
    f.switchAccount();
    await expect(
      f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn())
    ).rejects.toThrow();
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('rejects a batch with no actual chosen fields or unknown media/list names', async () => {
    const edits: BulkEdit[] = [{ lists: {} }, { lists: { Unknown: 'add' } }];
    for (const edit of edits)
      await expect(f.service.apply(snapshot, [1], edit, active, vi.fn())).rejects.toThrow();
    await expect(
      f.service.apply(snapshot, [999], { lists: {}, status: 'CURRENT' }, active, vi.fn())
    ).rejects.toThrow();
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('stops before the next entry once stop is requested and keeps the partial result', async () => {
    f.api.query.mockResolvedValue(page([remote(1), remote(2), remote(3)]));
    snapshot = await f.service.load('ANIME', active);
    let stop = false;
    f.api.mutate.mockImplementationOnce(async (_query, variables) => {
      stop = true; // Stop pressed while this request is in flight
      return { SaveMediaListEntry: { ...remote(), status: variables.status } } as never;
    });
    const result = await f.service.apply(
      snapshot,
      [1, 2, 3],
      { lists: {}, status: 'CURRENT' },
      active,
      vi.fn(),
      () => stop
    );
    expect(result).toEqual({ saved: [1], failed: null, remaining: [2, 3], reason: 'stopped' });
    expect(f.api.mutate).toHaveBeenCalledTimes(1);
  });
  it('writes nothing when stop was requested before the first write', async () => {
    f.api.query.mockResolvedValue(page([remote(1), remote(2)]));
    snapshot = await f.service.load('ANIME', active);
    const result = await f.service.apply(
      snapshot,
      [1, 2],
      { lists: {}, status: 'CURRENT' },
      active,
      vi.fn(),
      () => true
    );
    expect(result).toEqual({ saved: [], failed: null, remaining: [1, 2], reason: 'stopped' });
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
  it('pauses with a queue reason when Astra sync changes mid-run, before the next write', async () => {
    f.queue.getSnapshot
      .mockResolvedValueOnce({ revision: 'steady', entries: [] })
      .mockResolvedValueOnce({ revision: 'steady', entries: [] })
      .mockResolvedValueOnce({ revision: 'moved', entries: [] });
    const result = await f.service.apply(snapshot, [1], { lists: {}, status: 'CURRENT' }, active, vi.fn());
    expect(result).toEqual({ saved: [], failed: 1, remaining: [1], reason: 'queue' });
    expect(f.api.mutate).not.toHaveBeenCalled();
  });
});
