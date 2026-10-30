import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendAlertsHost, FRIEND_ALERTS_QUERY } from './FriendAlertsHost';
import { emptyFriendAlerts, parseFriendAlerts, type FriendAlertsState } from './FriendAlerts';
import { POLL_OVERLAP_SECONDS } from './FriendAlertsPolling';
import { validateApiRequest } from '@/api/ApiBoundary';

function activity(id: number, createdAt = 1050, userId = 2, mediaId = 10) {
  return {
    id,
    type: 'ANIME_LIST',
    userId,
    createdAt,
    status: 'watched episode',
    progress: '3',
    replyCount: 0,
    likeCount: 0,
    user: { id: userId, name: 'Friend', avatar: null },
    media: { id: mediaId, type: 'ANIME', title: { romaji: 'Title' }, coverImage: null },
  };
}
function page(activities: unknown[] = [], hasNextPage = false) {
  return { Page: { activities, pageInfo: { hasNextPage } }, recent: { activities: [] } };
}
function fixture() {
  const data: Record<string, unknown> = {};
  let owner: number | null = 1;
  let session = 'one';
  let enabled = true;
  const auth = {
    ensureInitialized: async () => {},
    hasToken: () => owner !== null,
    getUserCache: () => (owner ? { userId: owner } : null),
    getSessionId: () => session,
  };
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: structuredClone(data[key]) })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(((items: Record<string, unknown>) => {
    Object.assign(data, structuredClone(items));
    return Promise.resolve();
  }) as never);
  const api = {
    query: vi.fn(async (query: string, variables?: Record<string, unknown>): Promise<unknown> => {
      if (query === FRIEND_ALERTS_QUERY) return page();
      if (query.includes('FriendAlertsBatch'))
        return Object.fromEntries(
          Object.keys(variables ?? {})
            .filter((key) => /^v\d+_mediaIds$/.test(key))
            .flatMap((key) => {
              const index = key.split('_')[0].slice(1);
              return [
                [`p${index}`, page().Page],
                [`r${index}`, page().recent],
              ];
            })
        );
      return { Media: { id: 10, type: 'ANIME', title: { romaji: 'Title' } } };
    }),
  };
  const lists = {
    dispatch: vi.fn(async () => ({ 'Best Friends': [{ id: 2, name: 'Friend', avatar: '' }] })),
  };
  const host = new FriendAlertsHost(
    auth as never,
    api as never,
    { isFeatureEnabled: () => enabled } as never,
    lists as never
  );
  return {
    host,
    data,
    api,
    lists,
    disable: () => {
      enabled = false;
    },
    logout: () => {
      owner = null;
      session = 'out';
    },
    switchAccount: () => {
      owner = 3;
      session = 'three';
    },
    watch: (list: string | null = null) => host.dispatch('watch', { mediaId: 10, list }, 'one'),
    tick: (seconds = 100) => vi.setSystemTime((1100 + seconds) * 1000),
    state: () => data.friend_alerts_account_1 as FriendAlertsState,
  };
}

describe('friend alerts background owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);
  });
  afterEach(() => vi.useRealTimers());
  it('starts at subscription time and queries following activity without history', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7), activity(8, 1051, 1)]));
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(result.alerts.map((alert) => alert.id)).toEqual([7]);
    expect(f.api.query).toHaveBeenLastCalledWith(
      FRIEND_ALERTS_QUERY,
      expect.objectContaining({
        mediaIds: [10],
        following: true,
        users: undefined,
        since: 999,
        until: 1200,
      }),
      true
    );
  });
  it('allows more than twenty watched titles and persists a new subscription', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: Array.from({ length: 30 }, (_, index) => ({
        mediaId: index + 100,
        title: `Title ${index}`,
        mediaType: 'ANIME',
        list: null,
        since: 1000,
        checkedAt: 0,
      })),
    };
    const result = await f.watch();
    expect(result.rules).toHaveLength(31);
    expect(parseFriendAlerts(f.state()).rules).toHaveLength(31);
  });
  it('does not refetch metadata or reset the start time for an unchanged subscription', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    await f.watch();
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect(f.state().rules[0].since).toBe(1000);
  });
  it('names a new watched title by the viewer-preferred title, then romaji, then English', async () => {
    const f = fixture();
    f.api.query.mockResolvedValueOnce({
      Media: {
        id: 10,
        type: 'ANIME',
        title: {
          userPreferred: 'Seitokai ni mo Ana wa Aru!',
          romaji: 'Romaji',
          english: 'English',
        },
      },
    });
    expect((await f.watch()).rules[0].title).toBe('Seitokai ni mo Ana wa Aru!');
    const g = fixture();
    g.api.query.mockResolvedValueOnce({
      Media: {
        id: 10,
        type: 'ANIME',
        title: { userPreferred: null, romaji: 'Romaji', english: 'English' },
      },
    });
    expect((await g.watch()).rules[0].title).toBe('Romaji');
    const h = fixture();
    h.api.query.mockResolvedValueOnce({
      Media: {
        id: 10,
        type: 'ANIME',
        title: { userPreferred: null, romaji: null, english: 'English' },
      },
    });
    expect((await h.watch()).rules[0].title).toBe('English');
  });
  it('reuses the saved title metadata when changing an existing audience', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    await f.watch('Best Friends');
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect(f.state().rules[0]).toMatchObject({ list: 'Best Friends', since: 1200, title: 'Title' });
  });

  it('does not backfill a newer subscription from the group’s older time window', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: [
        { mediaId: 10, title: 'Old', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
        { mediaId: 20, title: 'New', mediaType: 'ANIME', list: null, since: 1100, checkedAt: 0 },
      ],
    };
    f.tick();
    f.api.query.mockResolvedValueOnce(
      page([activity(7), activity(8, 1050, 2, 20), activity(9, 1150, 2, 20)])
    );
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect(result.alerts.map((entry) => entry.id)).toEqual([9, 7]);
    // The older rule's checkpoint lags the window by the overlap; the newer rule keeps its own start.
    expect(result.rules.map((entry) => entry.since)).toEqual([1200 - POLL_OVERLAP_SECONDS, 1100]);
  });

  it('restarts a shared backlog safely when a watched title is removed', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: [
        { mediaId: 10, title: 'One', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
        { mediaId: 20, title: 'Two', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
      ],
    };
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7)], true));
    await f.host.dispatch('poll', undefined, 'one');
    await f.host.dispatch('remove', { mediaId: 20 }, 'one');
    expect(f.state().groups).toEqual([]);
    f.tick(500);
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query.mock.calls.at(-1)?.[1]).toMatchObject({
      mediaIds: [10],
      page: 1,
      since: 999,
    });
  });

  it('retains a shared page after malformed or unrelated results without partially collecting the group', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: [
        { mediaId: 10, title: 'One', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
        { mediaId: 20, title: 'Two', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
      ],
    };
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7), activity(8, 1050, 2, 30)]));
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(result.failed).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.groups?.[0]).toMatchObject({ page: 1, since: 999, until: 1200 });
    expect(result.rules.map((entry) => entry.since)).toEqual([1000, 1000]);
  });
  it('checks fifty watched titles in one server-filtered group on every cycle', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: Array.from({ length: 50 }, (_, index) => ({
        mediaId: index + 100,
        title: 'Title ' + index,
        mediaType: 'ANIME',
        list: null,
        since: 1000,
        checkedAt: 0,
      })),
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      f.tick(cycle * 300);
      const before = f.api.query.mock.calls.length;
      const result = await f.host.dispatch('poll', undefined, 'one');
      expect(f.api.query.mock.calls.length - before).toBe(1);
      expect(f.api.query.mock.calls.at(-1)?.[1]?.mediaIds).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 100)
      );
      expect(result.rules.every((rule) => rule.checkedAt === 1100 + cycle * 300)).toBe(true);
      expect(result.groups).toHaveLength(1);
    }
  });
  it('checks more than six different audiences in the same HTTP request', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: Array.from({ length: 12 }, (_, index) => ({
        mediaId: index + 10,
        title: `Title ${index}`,
        mediaType: 'ANIME',
        list: `List ${index}`,
        since: 1000,
        checkedAt: 0,
      })),
    };
    f.lists.dispatch.mockResolvedValue(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `List ${index}`,
          [{ id: index + 2, name: 'Friend', avatar: '' }],
        ])
      ) as never
    );
    f.tick();
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect(
      result.rules.every(
        (rule) => rule.since === 1200 - POLL_OVERLAP_SECONDS && rule.checkedAt === 1200
      )
    ).toBe(true);
    expect(result.failed).toBe(false);
  });

  it('does not mark an already-read inbox item unread when a rebuilt group replays it', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    await f.host.dispatch('poll', undefined, 'one');
    await f.host.dispatch('read', { id: 7 }, 'one');
    // Simulate rebuilding a still-open historical window after a watchlist edit.
    f.state().rules[0].since = 1000;
    f.state().rules[0].recent = [];
    f.state().groups = [];
    f.tick(500);
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].read).toBe(true);
  });
  it('uses current custom list members even when they are not followed', async () => {
    const f = fixture();
    await f.watch('Best Friends');
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    expect((await f.host.dispatch('poll', undefined, 'one')).alerts).toHaveLength(1);
    expect(f.api.query).toHaveBeenLastCalledWith(
      FRIEND_ALERTS_QUERY,
      expect.objectContaining({ users: [2], following: undefined }),
      true
    );
  });
  it('never turns a deleted or empty custom list into a global query', async () => {
    const f = fixture();
    await f.watch('Best Friends');
    f.lists.dispatch.mockResolvedValue({} as never);
    f.tick();
    f.api.query.mockClear();
    expect((await f.host.dispatch('poll', undefined, 'one')).alerts).toEqual([]);
    expect(f.api.query).not.toHaveBeenCalled();
  });
  it('deduplicates overlap and serializes read updates across clients', async () => {
    const f = fixture();
    await f.watch();
    f.tick(0);
    f.api.query.mockResolvedValueOnce(page([activity(7, 1099)]));
    await f.host.dispatch('poll', undefined, 'one');
    f.tick(500);
    f.api.query.mockResolvedValueOnce(page([activity(7, 1101), activity(8, 1102)]));
    await f.host.dispatch('poll', undefined, 'one');
    await Promise.all([
      f.host.dispatch('read', { id: 7 }, 'one'),
      f.host.dispatch('read', { id: 8 }, 'one'),
    ]);
    expect(f.state().alerts).toHaveLength(2);
    expect(f.state().alerts.every((alert) => alert.read)).toBe(true);
  });
  it('bounds requests and resumes a backlog after a worker restart', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockResolvedValue(page([activity(7)], true));
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.state().groups?.[0].page).toBe(2);
    expect(f.state().rules[0].since).toBe(1000);
    f.tick(500);
    f.api.query.mockResolvedValue(page([activity(8, 1060)], false));
    const restarted = new FriendAlertsHost(
      {
        ensureInitialized: async () => {},
        hasToken: () => true,
        getUserCache: () => ({ userId: 1 }),
        getSessionId: () => 'one',
      } as never,
      f.api as never,
      { isFeatureEnabled: () => true } as never,
      f.lists as never
    );
    await restarted.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenLastCalledWith(
      FRIEND_ALERTS_QUERY,
      expect.objectContaining({ page: 2, until: 1200 }),
      true
    );
    expect(f.state().groups?.[0].complete).toBe(true);
    expect(f.state().rules[0].since).toBe(1200 - POLL_OVERLAP_SECONDS);
  });
  it('keeps a failed page for retry and reports partial failure', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockRejectedValueOnce(new Error('offline'));
    const failed = await f.host.dispatch('poll', undefined, 'one');
    expect(failed.failed).toBe(true);
    expect(failed.rules[0].since).toBe(1000);
    expect(failed.groups?.[0].page).toBe(1);
    f.tick(500);
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    const recovered = await f.host.dispatch('poll', undefined, 'one');
    expect(recovered.failed).toBe(false);
    expect(recovered.alerts).toHaveLength(1);
  });
  it('rejects malformed or out-of-scope data without advancing the checkpoint', async () => {
    const f = fixture();
    await f.watch('Best Friends');
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7, 1050, 9)]));
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(result.failed).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.rules[0].since).toBe(1000);
  });
  it('stops polling when disabled and coalesces requests from multiple tabs', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockClear();
    await Promise.all([
      f.host.dispatch('poll', undefined, 'one'),
      f.host.dispatch('poll', undefined, 'one'),
    ]);
    expect(f.api.query).toHaveBeenCalledTimes(1);
    f.disable();
    f.tick(500);
    await f.host.poll();
    expect(f.api.query).toHaveBeenCalledTimes(1);
  });
  it('rejects new alert subscriptions while disabled without a metadata request', async () => {
    const f = fixture();
    f.disable();
    await expect(f.watch()).rejects.toThrow('disabled');
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.data.friend_alerts_account_1).toBeUndefined();
  });
  it('does not dispatch when settings are turned off during preparation', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockClear();
    f.lists.dispatch.mockImplementationOnce(async () => {
      f.disable();
      return { 'Best Friends': [] };
    });
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.state().rules).toHaveLength(1);
  });
  it('does not collect a response that finishes after settings are turned off', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockImplementationOnce(async () => {
      f.disable();
      return page([activity(7)]);
    });
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.state().alerts).toEqual([]);
    expect(f.state().rules[0].since).toBe(1000);
  });
  it('isolates accounts and rejects a stale session before reading its inbox', async () => {
    const f = fixture();
    await f.watch();
    f.switchAccount();
    expect(await f.host.dispatch('get', undefined, 'three')).toEqual(emptyFriendAlerts());
    await expect(f.host.dispatch('clear', undefined, 'one')).rejects.toThrow('account changed');
    expect(f.state().rules).toHaveLength(1);
  });
  it('discards an in-flight response after logout', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    const original = structuredClone(f.state());
    f.api.query.mockImplementationOnce(async () => {
      f.logout();
      return page([activity(7)]);
    });
    await expect(f.host.dispatch('poll', undefined, 'one')).rejects.toThrow('account changed');
    expect(f.state().alerts).toEqual(original.alerts);
    expect(f.state().rules).toEqual(original.rules);
    expect(f.state().lastPoll).toBe(1200);
  });
  it('preserves corrupt storage and propagates failed writes', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = { alerts: 'broken' };
    await expect(f.host.dispatch('get', undefined, 'one')).rejects.toThrow('Invalid');
    expect(f.data.friend_alerts_account_1).toEqual({ alerts: 'broken' });
    delete f.data.friend_alerts_account_1;
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));
    await expect(f.watch()).rejects.toThrow('quota');
    expect(f.data.friend_alerts_account_1).toBeUndefined();
  });
  it('removes subscriptions separately from clearing the inbox', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    await f.host.dispatch('poll', undefined, 'one');
    expect((await f.host.dispatch('clear', undefined, 'one')).rules).toHaveLength(1);
    expect((await f.host.dispatch('remove', { mediaId: 10 }, 'one')).rules).toEqual([]);
  });
  it('detects merged progress after clearing the inbox even when createdAt stays unchanged', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockResolvedValueOnce(page([activity(7)]));
    await f.host.dispatch('poll', undefined, 'one');
    await f.host.dispatch('clear', undefined, 'one');
    f.tick(500);
    f.api.query.mockResolvedValueOnce({
      ...page(),
      recent: { activities: [{ ...activity(7), progress: '4' }] },
    });
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({ id: 7, progress: '4', read: false });
    expect(f.api.query).toHaveBeenLastCalledWith(
      FRIEND_ALERTS_QUERY,
      expect.objectContaining({ ids: [7] }),
      true
    );
  });
  it('validates the query through the API allowlist and rejects corrupt alert IDs', () => {
    expect(
      validateApiRequest({
        method: 'query',
        query: FRIEND_ALERTS_QUERY,
        variables: { mediaIds: [10], since: 1000, until: 1200, page: 1 },
      }).method
    ).toBe('query');
    expect(() => parseFriendAlerts({ ...emptyFriendAlerts(), alerts: [{ id: '../bad' }] })).toThrow(
      'Invalid'
    );
  });
  it('reserves five minutes across manual clicks and worker restarts, including failures', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockRejectedValueOnce(new Error('offline'));
    await f.host.dispatch('poll', undefined, 'one');
    const calls = f.api.query.mock.calls.length;
    // The alarm path tolerates FRIEND_ALERTS_JITTER_SECONDS, so its gate is 285 s, not 300 s.
    f.tick(384); // 1484: one second before the jitter-tolerant interval expires.
    const restarted = new FriendAlertsHost(
      {
        ensureInitialized: async () => {},
        hasToken: () => true,
        getUserCache: () => ({ userId: 1 }),
        getSessionId: () => 'one',
      } as never,
      f.api as never,
      { isFeatureEnabled: () => true } as never,
      f.lists as never
    );
    await restarted.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(calls);
    f.tick(385); // 1485: the jitter-tolerant interval has expired.
    await restarted.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(calls + 1);
  });
  it('lets "Check now" run after thirty seconds while the alarm keeps its jittered cadence', async () => {
    const f = fixture();
    await f.watch();
    f.tick(); // 1200
    await f.host.dispatch('poll', undefined, 'one');
    const calls = f.api.query.mock.calls.length;
    f.tick(120); // 1220
    expect((await f.host.dispatch('poll', { manual: true }, 'one')).lastPoll).toBe(1200);
    expect(f.api.query).toHaveBeenCalledTimes(calls);
    f.tick(130); // 1230
    expect((await f.host.dispatch('poll', { manual: true }, 'one')).lastPoll).toBe(1230);
    expect(f.api.query).toHaveBeenCalledTimes(calls + 1);
    f.tick(414); // 1514: 284 s after the manual check, still inside the alarm gate.
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(calls + 1);
    f.tick(415); // 1515: 285 s, the alarm runs.
    await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(calls + 2);
  });
  it('answers reads from storage while a slow poll is still waiting on the network', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    const before = f.api.query.mock.calls.length;
    let release!: (value: unknown) => void;
    f.api.query.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        })
    );
    const polling = f.host.dispatch('poll', undefined, 'one');
    for (let turn = 0; turn < 500 && f.api.query.mock.calls.length === before; turn++)
      await Promise.resolve();
    expect(f.api.query.mock.calls.length).toBe(before + 1);
    const read = await f.host.dispatch('get', undefined, 'one');
    expect(read.rules).toHaveLength(1);
    release(page([activity(7, 1100)]));
    expect((await polling).alerts.map((alert) => alert.id)).toEqual([7]);
  });
  it('keeps an activity that became visible after a window closed, and dedupes its overlap repeat', async () => {
    const f = fixture();
    await f.watch();
    f.tick(); // 1200: completes the first window and lags the checkpoint by the overlap.
    f.api.query.mockResolvedValueOnce(page());
    await f.host.dispatch('poll', undefined, 'one');
    f.tick(400); // 1500
    f.api.query.mockResolvedValueOnce(page([activity(7, 1100), activity(8, 1420)]));
    expect(
      (await f.host.dispatch('poll', undefined, 'one')).alerts.map((alert) => alert.id)
    ).toEqual([8, 7]);
    f.tick(700); // 1800: the next window overlaps the previous one by POLL_OVERLAP_SECONDS.
    f.api.query.mockResolvedValueOnce(page([activity(8, 1420)]));
    expect(
      (await f.host.dispatch('poll', undefined, 'one')).alerts.map((alert) => alert.id)
    ).toEqual([8, 7]);
  });
  it('makes no activity request when reserving the interval cannot be persisted', async () => {
    const f = fixture();
    await f.watch();
    f.tick();
    f.api.query.mockClear();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));
    await expect(f.host.dispatch('poll', undefined, 'one')).rejects.toThrow('quota');
    expect(f.api.query).not.toHaveBeenCalled();
  });
  it('keeps audience filters isolated and commits valid siblings from a single batched response', async () => {
    const f = fixture();
    f.data.friend_alerts_account_1 = {
      ...emptyFriendAlerts(),
      rules: [
        { mediaId: 10, title: 'One', mediaType: 'ANIME', list: null, since: 1000, checkedAt: 0 },
        {
          mediaId: 20,
          title: 'Two',
          mediaType: 'ANIME',
          list: 'Best Friends',
          since: 1000,
          checkedAt: 0,
        },
      ],
    };
    f.tick();
    const wrongAudience = activity(8, 1050, 9);
    wrongAudience.media.id = 20;
    f.api.query.mockResolvedValueOnce({
      p0: page([activity(7)]).Page,
      r0: page().recent,
      p1: page([wrongAudience]).Page,
      r1: page().recent,
    });
    const result = await f.host.dispatch('poll', undefined, 'one');
    expect(f.api.query).toHaveBeenCalledTimes(1);
    expect(result.alerts.map((alert) => alert.id)).toEqual([7]);
    expect(result.rules.map((rule) => rule.since)).toEqual([1200 - POLL_OVERLAP_SECONDS, 1000]);
    expect(result.failed).toBe(true);
  });
});
