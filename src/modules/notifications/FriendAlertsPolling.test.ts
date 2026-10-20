import { describe, expect, it } from 'vitest';
import { emptyFriendAlerts, parseFriendAlerts, type FriendAlertRule } from './FriendAlerts';
import { prepareFriendAlertPoll } from './FriendAlertsPolling';
import { validateApiRequest } from '@/api/ApiBoundary';

const rule = (mediaId: number, list: string | null = null, since = 1000): FriendAlertRule => ({
  mediaId, title: `Title ${mediaId}`, mediaType: 'ANIME', list, since, checkedAt: 0,
});
const user = (id: number) => ({ id, name: `User ${id}`, avatar: '' });

describe('friend alert server-filtered grouping', () => {
  it('merges equivalent custom audiences even when their names/order differ and removes self', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(10, 'A'), rule(20, 'B'), rule(30)] };
    const result = prepareFriendAlertPoll(state, { A: [user(3), user(2), user(1)], B: [user(2), user(3), user(2)] }, 1, 2000);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].variables).toMatchObject({ mediaIds: [10, 20], users: [2, 3], following: undefined });
    expect(result.tasks[1].variables).toMatchObject({ mediaIds: [30], following: true, users: undefined });
  });

  it('uses the oldest subscription checkpoint without losing each title’s own start', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(10), rule(20, null, 1800)] };
    const result = prepareFriendAlertPoll(state, {}, 1, 2000);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].variables).toMatchObject({ since: 999, until: 2000, mediaIds: [10, 20] });
    expect(state.rules.map(entry => entry.since)).toEqual([1000, 1800]);
  });

  it('preserves the exact shared window/page across reloads and ignores rule ordering', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(20), rule(10)] };
    const first = prepareFriendAlertPoll(state, {}, 1, 2000);
    first.tasks[0].scan.page = 4;
    const restored = parseFriendAlerts(state);
    const second = prepareFriendAlertPoll(restored, {}, 1, 2300);
    expect(second.tasks[0].variables).toMatchObject({ mediaIds: [10, 20], since: 999, until: 2000, page: 4 });
  });

  it('restarts pagination safely after a media/audience change and retains per-title checkpoints', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(10, 'A')] };
    const first = prepareFriendAlertPoll(state, { A: [user(2)] }, 1, 2000);
    first.tasks[0].scan.page = 4;
    state.rules.push(rule(20, 'A', 2200));
    const second = prepareFriendAlertPoll(state, { A: [user(3)] }, 1, 2300);
    expect(second.tasks[0].variables).toMatchObject({ mediaIds: [10, 20], users: [3], since: 999, until: 2300, page: 1 });
  });

  it('migrates legacy per-title scans from their committed checkpoint rather than skipping partially read pages', () => {
    const watched = rule(10);
    watched.scan = { since: 999, until: 1800, page: 7, audience: 'following' };
    watched.recent = [{ id: 7, status: 'watched', progress: '2' }];
    const state = { ...emptyFriendAlerts(), rules: [watched] };
    const result = prepareFriendAlertPoll(state, {}, 1, 2000);
    expect(result.tasks[0].variables).toMatchObject({ page: 1, since: 999, until: 2000, ids: [7] });
    expect(state.rules[0].scan).toBeUndefined();
    expect(state.rules[0].recent).toEqual(watched.recent);
  });

  it('skips missing/empty/self-only audiences without ever removing the users filter', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(10, 'Empty'), rule(20, 'Missing'), rule(30, 'Self')] };
    const result = prepareFriendAlertPoll(state, { Empty: [], Self: [user(1)] }, 1, 2000);
    expect(result.batch).toBeUndefined(); expect(result.tasks).toEqual([]);
    expect(state.rules.every(entry => entry.since === 2000)).toBe(true);
  });

  it('splits only at AniList’s documented filter size, allowing over ten thousand watched titles', () => {
    const state = { ...emptyFriendAlerts(), rules: Array.from({ length: 10001 }, (_, index) => rule(index + 1)) };
    const result = prepareFriendAlertPoll(state, {}, 1, 2000);
    expect(result.tasks.map(task => task.variables.mediaIds.length)).toEqual([10000, 1]);
    expect(result.batch).toBeDefined();
    expect(() => validateApiRequest({ ...result.batch!, method: 'query' })).not.toThrow();
  });

  it('rotates only known activity IDs across result pages while every watched title remains in the fresh filter', () => {
    const state = { ...emptyFriendAlerts(), rules: Array.from({ length: 100 }, (_, index) => ({ ...rule(index + 1),
      recent: [{ id: index + 100, status: 'watched', progress: '2' }] })) };
    const first = prepareFriendAlertPoll(state, {}, 1, 2000);
    expect(first.tasks[0].variables.ids).toEqual(Array.from({ length: 50 }, (_, index) => index + 100));
    first.tasks[0].scan.recentAfter = 149;
    first.tasks[0].scan.complete = true;
    const second = prepareFriendAlertPoll(state, {}, 1, 2300);
    expect(second.tasks[0].variables.ids).toEqual(Array.from({ length: 50 }, (_, index) => index + 150));
    expect(second.tasks[0].variables.mediaIds).toHaveLength(100);
  });

  it('packs very large audiences by the existing request byte budget and gives deferred groups priority next time', () => {
    const state = { ...emptyFriendAlerts(), rules: Array.from({ length: 10 }, (_, index) => rule(index + 1, `List ${index}`)) };
    const lists = Object.fromEntries(state.rules.map((entry, index) => [entry.list!, Array.from({ length: 10000 }, (_, j) => user(10000000 + index * 10000 + j))]));
    const first = prepareFriendAlertPoll(state, lists, 1, 2000);
    expect(first.tasks.length).toBeGreaterThan(0); expect(first.tasks.length).toBeLessThan(10);
    const processed = new Set(first.tasks.map(task => task.rules[0].mediaId));
    for (const task of first.tasks) for (const entry of task.rules) entry.checkedAt = 2000;
    const second = prepareFriendAlertPoll(state, lists, 1, 2300);
    const all = new Set([...processed, ...second.tasks.map(task => task.rules[0].mediaId)]);
    expect(all.size).toBe(10);
  });

  it('rejects malformed/shared group snapshots without discarding the original data', () => {
    const state = { ...emptyFriendAlerts(), rules: [rule(10)] };
    prepareFriendAlertPoll(state, {}, 1, 2000);
    const malformed = structuredClone(state);
    malformed.groups!.push(structuredClone(malformed.groups![0]));
    expect(() => parseFriendAlerts(malformed)).toThrow('groups');
    expect(malformed.groups).toHaveLength(2);
  });
});
