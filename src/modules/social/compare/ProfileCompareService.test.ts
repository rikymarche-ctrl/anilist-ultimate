import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_COMPARE_LIST_QUERY } from '@/api/queries/profile-compare';
import { dayNumber, parseCompareList } from './ProfileCompareResponse';
import { CompareError, MAX_CHUNKS, ProfileCompareService } from './ProfileCompareService';

const user = (id: number, name: string) => ({
  id,
  name,
  avatar: { large: 'https://s4.anilist.co/a.png' },
  statistics: { anime: { minutesWatched: 120 } },
});

const row = (mediaId: number) => ({
  mediaId,
  status: 'COMPLETED',
  score: 8,
  private: false,
  startedAt: { year: 2020, month: 1, day: 2 },
  completedAt: { year: null, month: null, day: null },
  media: {
    id: mediaId,
    isAdult: false,
    status: 'FINISHED',
    title: { userPreferred: `Title ${mediaId}` },
    coverImage: { extraLarge: 'https://s4.anilist.co/c.png', large: null },
    genres: ['Drama'],
  },
});

const page = (userId: number, ids: number[], hasNextChunk = false) => ({
  data: {
    MediaListCollection: { user: { id: userId }, hasNextChunk, lists: [{ entries: ids.map(row) }] },
  },
});

describe('ProfileCompareService', () => {
  let queryRaw: ReturnType<typeof vi.fn>;
  let service: ProfileCompareService;
  let context: { sessionId: string; userId: number };

  const listCalls = () =>
    queryRaw.mock.calls.filter(([query]) => query === PROFILE_COMPARE_LIST_QUERY);

  const respond = (lists: (userId: number, chunk: number) => unknown) => {
    queryRaw.mockImplementation(
      async (query: string, variables: { userId: number; chunk: number }) =>
        query.includes('ProfileCompareUsers')
          ? { data: { Viewer: user(1, 'Me'), User: user(2, 'Friend') } }
          : lists(variables.userId, variables.chunk)
    );
  };

  beforeEach(() => {
    context = { sessionId: 's', userId: 1 };
    queryRaw = vi.fn();
    service = new ProfileCompareService({
      isAuthenticated: () => true,
      ensureContext: async () => context,
      getContext: () => context,
      queryRaw,
    } as never);
  });

  it('loads both lists through the priority queue, the other person first', async () => {
    respond((userId) => page(userId, [userId * 10]));

    const data = await service.load('Friend');

    expect(data.viewer.name).toBe('Me');
    expect(data.otherEntries.map((entry) => entry.mediaId)).toEqual([20]);
    expect(data.viewerEntries.map((entry) => entry.mediaId)).toEqual([10]);
    expect(listCalls().map(([, variables]) => variables.userId)).toEqual([2, 1]);
    for (const [, , options] of queryRaw.mock.calls) expect(options).toEqual({ priority: true });
  });

  it('follows chunks and reports progress', async () => {
    respond((userId, chunk) => page(userId, [userId * 100 + chunk], userId === 2 && chunk < 3));
    const progress = vi.fn();

    const data = await service.load('Friend', 'ANIME', progress);

    expect(data.otherEntries).toHaveLength(3);
    expect(progress).toHaveBeenCalledWith({ name: 'Friend', isViewer: false, loaded: 3 });
    expect(progress).toHaveBeenLastCalledWith({ name: 'Me', isViewer: true, loaded: 1 });
  });

  it('caches the other list but rereads the viewer list, so a new score shows at once', async () => {
    let score = 8;
    respond((userId) => {
      const answer = page(userId, [userId]);
      answer.data.MediaListCollection.lists[0].entries[0].score = userId === 1 ? score : 5;
      return answer;
    });

    await service.load('Friend');
    score = 3;
    const second = await service.load('Friend');

    expect(second.viewerEntries[0].score).toBe(3);
    expect(listCalls().map(([, variables]) => variables.userId)).toEqual([2, 1, 1]);
  });

  it('does not read the viewer list when the other list is private', async () => {
    respond(() => ({
      data: { MediaListCollection: null },
      errors: [{ message: 'Private User', status: 404 }],
    }));

    await expect(service.load('Friend')).rejects.toMatchObject({ kind: 'private' });
    expect(listCalls()).toHaveLength(1);
  });

  it('retries a private list on the next attempt instead of caching the failure', async () => {
    respond(() => ({
      data: { MediaListCollection: null },
      errors: [{ message: 'Private User', status: 404 }],
    }));
    await expect(service.load('Friend')).rejects.toBeInstanceOf(CompareError);

    respond((userId) => page(userId, [userId]));

    await expect(service.load('Friend')).resolves.toBeTruthy();
  });

  it.each([
    [
      'a missing user',
      { data: { User: null }, errors: [{ message: 'Not Found.', status: 404 }] },
      'not-found',
    ],
    [
      'the viewer themself',
      { data: { Viewer: user(2, 'Friend'), User: user(2, 'Friend') } },
      'self',
    ],
    ['no viewer', { data: { Viewer: null, User: user(2, 'Friend') } }, 'signed-out'],
    ['a malformed answer', { data: { Viewer: user(1, 'Me'), User: 'nope' } }, 'unavailable'],
  ])('reports %s', async (_name, response, kind) => {
    queryRaw.mockResolvedValue(response);

    await expect(service.load('Friend')).rejects.toMatchObject({ kind });
    expect(listCalls()).toHaveLength(0);
  });

  it('refuses to start when signed out', async () => {
    service = new ProfileCompareService({ isAuthenticated: () => false, queryRaw } as never);

    await expect(service.load('Friend')).rejects.toMatchObject({ kind: 'signed-out' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('turns a transport failure into a retryable state', async () => {
    queryRaw.mockRejectedValue(new Error('Failed to fetch'));

    await expect(service.load('Friend')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('stops at the chunk cap on an endless list', async () => {
    respond((userId, chunk) => page(userId, [chunk], true));

    await expect(service.load('Friend')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(listCalls()).toHaveLength(MAX_CHUNKS);
  });

  it('stops when an account change happens mid-load', async () => {
    respond((userId) => {
      context = { sessionId: 'other', userId: 9 };
      return page(userId, [userId]);
    });

    await expect(service.load('Friend')).rejects.toThrow('Astra account changed');
    expect(listCalls()).toHaveLength(1);
  });
});

describe('parseCompareList', () => {
  it('refuses a list that belongs to someone else', () => {
    expect(() => parseCompareList(page(3, [1]).data, 2)).toThrow('Unrelated');
  });

  it('skips broken rows and collapses a title in several custom lists', () => {
    const data = page(2, [1, 1]).data;
    data.MediaListCollection.lists[0].entries.push({ mediaId: 5 } as never);

    const { entries } = parseCompareList(data, 2);

    expect(entries.map((entry) => entry.mediaId)).toEqual([1]);
    expect(entries[0]).toMatchObject({
      started: dayNumber({ year: 2020, month: 1, day: 2 }),
      completed: null,
      score: 8,
    });
  });
});

describe('dayNumber', () => {
  it('reads full dates and refuses partial or impossible ones', () => {
    expect(dayNumber({ year: 1970, month: 1, day: 2 })).toBe(1);
    expect(dayNumber({ year: 2020, month: 2, day: null })).toBeNull();
    expect(dayNumber({ year: 2021, month: 2, day: 30 })).toBeNull();
    expect(dayNumber(null)).toBeNull();
  });
});
