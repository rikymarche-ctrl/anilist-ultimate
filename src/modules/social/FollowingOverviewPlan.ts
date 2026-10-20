import type { CustomLists } from './CustomListService';
import type { FollowingGroupsConfig } from './FollowingGrouping';

/** The title Overview box never shows more rows than the native box. */
export const OVERVIEW_LIMIT = 5;

export interface OverviewCandidate {
  /** Lowercased username. */
  key: string;
  /** `native` rows are already in the DOM; `fetched` rows need a clone. */
  kind: 'native' | 'fetched';
  /** Source order inside its kind: DOM order for native rows, API order for fetched ones. */
  index: number;
}

/** Group index first (Others is always last), then native before fetched, then source order. */
export function rankOverview(
  candidates: OverviewCandidate[],
  assignment: Map<string, number>,
  limit: number
): OverviewCandidate[] {
  const rankOf = (candidate: OverviewCandidate) =>
    assignment.get(candidate.key) ?? Number.MAX_SAFE_INTEGER;
  return [...candidates]
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        (a.kind === b.kind ? 0 : a.kind === 'native' ? -1 : 1) ||
        a.index - b.index
    )
    .slice(0, limit);
}

/** The Overview reads followings only when an enabled group has at least one member; otherwise it does nothing. */
export function hasEnabledMembers(lists: CustomLists, config: FollowingGroupsConfig): boolean {
  return config.groups.some(
    (name) => Object.prototype.hasOwnProperty.call(lists, name) && lists[name].length > 0
  );
}
