import type { CustomLists } from './CustomListService';

export interface FollowingGroupsConfig {
  groups: string[];
  collapsed: string[];
  othersCollapsed: boolean;
}
export interface PlannedGroup {
  name: string | null /* null = Others */;
  label: string;
  count: number;
  collapsed: boolean;
}
export interface FollowingGroupPlan {
  active: boolean;
  groups: PlannedGroup[];
  assignment: Map<string, number>; /* lowercased username -> index into groups */
}

const OTHERS_LABEL = 'Others';
const hasOwn = (target: object, property: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, property);

/** Configured names that are own list properties, first occurrence only, in configured order. */
function configuredNames(groups: string[], lists: CustomLists): string[] {
  return groups.filter((name, index) => hasOwn(lists, name) && groups.indexOf(name) === index);
}

/**
 * Plans the Following column groups for the visible usernames. Pure: inputs are never mutated.
 * The first configured list containing a user wins (case-insensitive); everyone else goes to Others, always last.
 */
export function planFollowingGroups(
  usernames: string[],
  lists: CustomLists,
  config: FollowingGroupsConfig
): FollowingGroupPlan {
  const names = configuredNames(config.groups, lists);
  const owner = new Map<string, number>();
  names.forEach((name, index) => {
    for (const member of lists[name]) {
      const key = member.name.toLowerCase();
      if (!owner.has(key)) owner.set(key, index);
    }
  });

  const seen = new Set<string>();
  const counts = names.map(() => 0);
  const placements: Array<[string, number]> = []; // lowercased username -> configured index, -1 = Others
  let othersCount = 0;
  for (const username of usernames) {
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const index = owner.get(key) ?? -1;
    if (index === -1) othersCount++;
    else counts[index]++;
    placements.push([key, index]);
  }

  // Empty configured groups are omitted, so indices refer to the filtered array.
  const groups: PlannedGroup[] = [];
  const position = new Map<number, number>();
  names.forEach((name, index) => {
    if (counts[index] === 0) return;
    position.set(index, groups.length);
    groups.push({
      name,
      label: name,
      count: counts[index],
      collapsed: config.collapsed.includes(name),
    });
  });
  if (!groups.length) return { active: false, groups: [], assignment: new Map() };

  const othersIndex = groups.length;
  if (othersCount > 0)
    groups.push({
      name: null,
      label: OTHERS_LABEL,
      count: othersCount,
      collapsed: config.othersCollapsed,
    });
  const assignment = new Map<string, number>();
  for (const [key, index] of placements)
    assignment.set(key, index === -1 ? othersIndex : (position.get(index) ?? othersIndex));
  return { active: true, groups, assignment };
}
