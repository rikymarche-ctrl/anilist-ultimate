import { describe, expect, it } from 'vitest';
import type { CustomLists } from './CustomListService';
import { planFollowingGroups, type FollowingGroupsConfig } from './FollowingGrouping';

const user = (name: string, id = 1) => ({ id, name, avatar: '' });
const config = (overrides: Partial<FollowingGroupsConfig> = {}): FollowingGroupsConfig => ({
  groups: [],
  collapsed: [],
  othersCollapsed: false,
  ...overrides,
});

describe('following group planning', () => {
  it('gives a user shared by two lists to the first configured group', () => {
    // Arrange
    const lists: CustomLists = {
      Trusted: [user('bob', 2)],
      Friends: [user('ann'), user('bob', 2)],
    };
    // Act
    const plan = planFollowingGroups(
      ['ann', 'bob'],
      lists,
      config({ groups: ['Trusted', 'Friends'] })
    );
    // Assert
    expect(plan.groups.map((group) => [group.name, group.count])).toEqual([
      ['Trusted', 1],
      ['Friends', 1],
    ]);
    expect(plan.assignment.get('bob')).toBe(0);
    expect(plan.assignment.get('ann')).toBe(1);
  });

  it('follows the configured order rather than the order of the lists object', () => {
    const lists: CustomLists = { Trusted: [user('bob', 2)], Friends: [user('bob', 2)] };
    const plan = planFollowingGroups(['bob'], lists, config({ groups: ['Friends', 'Trusted'] }));
    expect(plan.groups.map((group) => group.name)).toEqual(['Friends']);
  });

  it('matches usernames case-insensitively and counts case-variant duplicates once', () => {
    const lists: CustomLists = { Friends: [user('Ann')] };
    const plan = planFollowingGroups(['ANN', 'ann'], lists, config({ groups: ['Friends'] }));
    expect(plan.groups).toEqual([
      { name: 'Friends', label: 'Friends', count: 1, collapsed: false },
    ]);
    expect(plan.assignment.get('ann')).toBe(0);
  });

  it('ignores configured names that are not own properties of the lists', () => {
    const lists: CustomLists = { Friends: [user('ann')] };
    const plan = planFollowingGroups(
      ['ann'],
      lists,
      config({ groups: ['toString', 'constructor', 'Missing', 'Friends'] })
    );
    expect(plan.active).toBe(true);
    expect(plan.groups.map((group) => group.name)).toEqual(['Friends']);
  });

  it('is inactive when no configured member is visible', () => {
    const plan = planFollowingGroups(
      ['stranger'],
      { Friends: [user('ann')] },
      config({ groups: ['Friends'] })
    );
    expect(plan).toEqual({ active: false, groups: [], assignment: new Map() });
  });

  it('is inactive when no group is configured, even if every user is visible', () => {
    const plan = planFollowingGroups(['ann'], { Friends: [user('ann')] }, config());
    expect(plan.active).toBe(false);
  });

  it('omits configured groups without visible members and keeps indices relative to the filtered groups', () => {
    const lists: CustomLists = {
      Empty: [user('nobody')],
      Friends: [user('ann')],
      Trusted: [user('bob', 2)],
    };
    const plan = planFollowingGroups(
      ['ann', 'bob'],
      lists,
      config({ groups: ['Empty', 'Friends', 'Trusted'] })
    );
    expect(plan.groups.map((group) => group.name)).toEqual(['Friends', 'Trusted']);
    expect(plan.assignment.get('bob')).toBe(1);
  });

  it('places Others last with its own collapsed flag, and omits it when nobody falls through', () => {
    const lists: CustomLists = { Friends: [user('ann')] };
    const withOthers = planFollowingGroups(
      ['stranger', 'ann', 'other'],
      lists,
      config({ groups: ['Friends'], othersCollapsed: true })
    );
    expect(withOthers.groups[withOthers.groups.length - 1]).toEqual({
      name: null,
      label: 'Others',
      count: 2,
      collapsed: true,
    });
    expect(withOthers.assignment.get('stranger')).toBe(1);

    const withoutOthers = planFollowingGroups(
      ['ann'],
      lists,
      config({ groups: ['Friends'], othersCollapsed: true })
    );
    expect(withoutOthers.groups.map((group) => group.name)).toEqual(['Friends']);
  });

  it('marks a group collapsed only when it is listed in the config', () => {
    const lists: CustomLists = { Friends: [user('ann')], Trusted: [user('bob', 2)] };
    const plan = planFollowingGroups(
      ['ann', 'bob'],
      lists,
      config({ groups: ['Friends', 'Trusted'], collapsed: ['Trusted'] })
    );
    expect(plan.groups.map((group) => group.collapsed)).toEqual([false, true]);
  });

  it('does not mutate its inputs', () => {
    const lists: CustomLists = { Friends: [user('ann')] };
    const usernames = ['ann', 'Ann', 'stranger', 'stranger'];
    const settings = config({ groups: ['Friends'], collapsed: ['Friends'] });
    const snapshot = structuredClone({ lists, usernames, settings });

    const plan = planFollowingGroups(usernames, lists, settings);

    expect(plan.groups[0].count).toBe(1);
    expect(plan.groups[plan.groups.length - 1]).toMatchObject({ name: null, count: 1 });
    expect({ lists, usernames, settings }).toEqual(snapshot);
  });
});
