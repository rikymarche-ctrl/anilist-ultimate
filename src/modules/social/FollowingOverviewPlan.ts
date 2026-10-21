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

/** The viewer first, then group index (Others last), native before fetched, and source order. */
export function rankOverview(
  candidates: OverviewCandidate[],
  assignment: Map<string, number>,
  limit: number,
  viewerKey: string | null = null
): OverviewCandidate[] {
  const rankOf = (candidate: OverviewCandidate) =>
    candidate.key === viewerKey ? -1 : assignment.get(candidate.key) ?? Number.MAX_SAFE_INTEGER;
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
