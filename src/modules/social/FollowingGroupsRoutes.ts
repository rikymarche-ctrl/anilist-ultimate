const SOCIAL_ROUTE = /^\/(anime|manga)\/[1-9]\d*(?:\/[^/]+)?\/social\/?$/;
const OVERVIEW_ROUTE = /^\/(anime|manga)\/[1-9]\d*(?:\/[^/]+)?\/?$/;
const NOT_OVERVIEW = /^\/(anime|manga)\/\d+\/(characters|staff|stats|reviews|recommendations)\/?$/;

/** The Social tab of a title or manga. */
export function isFollowingGroupsRoute(path: string): boolean {
  return SOCIAL_ROUTE.test(path);
}

/** The title Overview: not the Social tab, and not the character/staff/stats/review subroutes. */
export function isFollowingGroupsOverviewRoute(path: string): boolean {
  return OVERVIEW_ROUTE.test(path) && !NOT_OVERVIEW.test(path) && !SOCIAL_ROUTE.test(path);
}

export function isFollowingGroupsPageRoute(path: string): boolean {
  return isFollowingGroupsRoute(path) || isFollowingGroupsOverviewRoute(path);
}
