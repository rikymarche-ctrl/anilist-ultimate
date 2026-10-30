/**
 * @file ProfileConnections.ts
 * @description Bounded AniList reads and pure set logic for profile relations.
 *
 * Two features read a profile's relations: the "connections" line (who among the
 * people the viewer follows follows, or is followed by, this profile) and the
 * Social sidebar counts. AniList's `pageInfo.total` is exact for followers,
 * following, mutual followers and thread comments, but returns a placeholder
 * (5000) for threads and messages, so those are counted by paging. Every page of
 * every relation is an aliased `Page` root of ONE GraphQL operation, so a feature
 * costs a single request against the 30/minute limit. The page count is capped; a
 * count stopped by the cap is reported as incomplete ("at least").
 */

import type { IApiClient } from '@core/interfaces/IApiClient';
import { isRecord } from '@/api/GraphQLResponse';
import type { CustomLists } from './CustomListService';
import { isAniListId, parseFollowingPage, parseSocialUser } from './SocialResponse';

export interface SocialUser {
  id: number;
  name: string;
  avatar: { medium: string };
}

/** A count that may have been stopped by the request cap. */
export interface RelationTally {
  count: number;
  /** False when the cap stopped paging: the real count is at least `count`. */
  complete: boolean;
}

export interface ConnectionGroup {
  users: SocialUser[];
  complete: boolean;
}

export interface ListAttribution {
  name: string;
  users: SocialUser[];
}

export interface ProfileConnections {
  /** People the viewer follows who follow this profile. */
  followers: ConnectionGroup;
  /** People the viewer follows whom this profile follows. */
  following: ConnectionGroup;
  /** Connected people per custom list, in list order; empty lists are left out. */
  lists: ListAttribution[];
}

export interface ProfileSocialCounts {
  mutualFollowers: RelationTally | null;
  forumThreads: RelationTally;
  forumComments: RelationTally | null;
  messages: RelationTally;
}

export type PagedRelation = 'followers' | 'following' | 'threads' | 'messages';
export type TotalRelation = 'mutualFollowers' | 'threadComments';
/** Pages to read per relation in the single request. */
export type PagePlan = Partial<Record<PagedRelation, number>>;

export const RELATION_PAGE_SIZE = 50;
/** Followers and following read for the connections line: 10 × 50 per side, in one request. */
export const CONNECTIONS_MAX_PAGES = 10;
/** Threads and messages counted for the sidebar: up to 200 each, in one request. */
export const SIDEBAR_MAX_PAGES = 4;
/** Every page of every relation in one operation is capped here (ApiBoundary allows far more). */
const MAX_PAGES_PER_QUERY = 2 * CONNECTIONS_MAX_PAGES;
/** AniList answers deeper totals with this ceiling, so a total at or above it is a lower bound. */
const PROVIDER_TOTAL_CEILING = 5000;

const PAGED_FIELDS: Record<PagedRelation, { field: string; selection: string }> = {
  followers: {
    field: 'followers',
    selection: 'followers(userId: $userId) { id name avatar { medium } }',
  },
  following: {
    field: 'following',
    selection: 'following(userId: $userId) { id name avatar { medium } }',
  },
  threads: { field: 'threads', selection: 'threads(userId: $userId) { id }' },
  messages: {
    field: 'activities',
    // AniList's Messages tab lists the messages the owner SENT on other profiles; for messages
    // `userId` is the recipient, so it would count received ones. Blocked recipients are hidden there too.
    selection:
      'activities(messengerId: $userId, type: MESSAGE) { ... on MessageActivity { id recipient { isBlocked } } }',
  },
};
const TOTAL_FIELDS: Record<TotalRelation, string> = {
  mutualFollowers: 'mutualFollowers(userId: $userId) { id }',
  threadComments: 'threadComments(userId: $userId) { id }',
};

/** Pages needed to read `total` entries, capped; an exact total of 0 needs none. */
export function pagesFor(total: number, maxPages: number): number {
  return Math.min(maxPages, Math.ceil(Math.max(0, total) / RELATION_PAGE_SIZE));
}

const entries = (plan: PagePlan): [PagedRelation, number][] =>
  (Object.entries(plan) as [PagedRelation, number][]).filter(([, pages]) => pages > 0);

/** One operation with an aliased `Page` root per page (`followers1`, `followers2`, ...) and per total. */
export function buildRelationsQuery(plan: PagePlan, totals: readonly TotalRelation[] = []): string {
  const pages = entries(plan).flatMap(([relation, count]) =>
    Array.from(
      { length: count },
      (_, index) =>
        `${relation}${index + 1}: Page(page: ${index + 1}, perPage: ${RELATION_PAGE_SIZE}) { pageInfo { hasNextPage } ${PAGED_FIELDS[relation].selection} }`
    )
  );
  if (pages.length > MAX_PAGES_PER_QUERY) throw new Error('Too many relation pages');
  const counts = totals.map(
    (relation) => `${relation}: Page(perPage: 1) { pageInfo { total } ${TOTAL_FIELDS[relation]} }`
  );
  if (pages.length + counts.length === 0) throw new Error('Empty relations query');
  return `query ($userId: Int!) {\n  ${[...pages, ...counts].join('\n  ')}\n}`;
}

function fail(): never {
  throw new Error('Invalid relations response');
}

function parseIdPage(value: unknown, field: string): { count: number; hasNextPage: boolean } {
  if (
    !isRecord(value) ||
    !isRecord(value.pageInfo) ||
    typeof value.pageInfo.hasNextPage !== 'boolean'
  )
    fail();
  const rows = value[field];
  if (!Array.isArray(rows) || rows.length > RELATION_PAGE_SIZE) fail();
  // Activities of another type come back as empty objects through the inline fragment.
  const ids = rows.filter((row) => isRecord(row) && row.id !== undefined);
  if (!ids.every((row) => isAniListId((row as { id: unknown }).id))) fail();
  return { count: ids.filter((row) => !isHiddenRow(row)).length, hasNextPage: value.pageInfo.hasNextPage };
}

/** A message to a user the viewer blocked, which AniList leaves out of the Messages tab. */
function isHiddenRow(row: unknown): boolean {
  if (!isRecord(row) || !('recipient' in row) || row.recipient === null) return false;
  if (!isRecord(row.recipient) || (row.recipient.isBlocked !== undefined && row.recipient.isBlocked !== null
    && typeof row.recipient.isBlocked !== 'boolean')) fail();
  return row.recipient.isBlocked === true;
}

function parseTotal(value: unknown): RelationTally | null {
  if (!isRecord(value) || !isRecord(value.pageInfo)) fail();
  const total = value.pageInfo.total;
  if (total === null || total === undefined) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) fail();
  return { count: total, complete: total < PROVIDER_TOTAL_CEILING };
}

export interface RelationsResult {
  users: Partial<Record<'followers' | 'following', SocialUser[]>>;
  tallies: Partial<Record<PagedRelation, RelationTally>>;
  totals: Partial<Record<TotalRelation, RelationTally | null>>;
}

/**
 * Reads the planned pages and totals in a single request. A relation is complete
 * when one of its pages reports no next page; otherwise the cap stopped it.
 */
export async function fetchRelations(
  api: IApiClient,
  userId: number,
  plan: PagePlan,
  totals: readonly TotalRelation[],
  assertCurrent?: () => void
): Promise<RelationsResult> {
  if (!isAniListId(userId)) throw new Error('Invalid profile ID');
  if (!entries(plan).every(([, pages]) => Number.isInteger(pages)))
    throw new Error('Invalid page plan');
  const unique = [...new Set(totals)];
  const response = await api.query<unknown>(buildRelationsQuery(plan, unique), { userId }, true);
  assertCurrent?.();
  if (!isRecord(response)) fail();
  const result: RelationsResult = { users: {}, tallies: {}, totals: {} };
  for (const relation of unique) result.totals[relation] = parseTotal(response[relation]);
  for (const [relation, count] of entries(plan)) {
    const users = new Map<number, SocialUser>();
    let rows = 0;
    let complete = false;
    for (let page = 1; page <= count && !complete; page++) {
      const value = response[`${relation}${page}`];
      if (relation === 'followers' || relation === 'following') {
        const parsed = parseFollowingPage({ Page: value }, relation);
        for (const user of parsed.nodes) users.set(user.id, parseSocialUser(user));
        complete = !parsed.hasNextPage;
      } else {
        const parsed = parseIdPage(value, PAGED_FIELDS[relation].field);
        rows += parsed.count;
        complete = !parsed.hasNextPage;
      }
    }
    if (relation === 'followers' || relation === 'following') {
      result.users[relation] = [...users.values()];
      rows = users.size;
    }
    result.tallies[relation] = { count: rows, complete };
  }
  return result;
}

const byName = (a: SocialUser, b: SocialUser): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The viewer's followings that appear in `profileUsers`, sorted by name, without excluded ids. */
export function intersectUsers(
  viewerFollowing: readonly SocialUser[],
  profileUsers: readonly SocialUser[],
  excludeIds: ReadonlySet<number> = new Set()
): SocialUser[] {
  const profileIds = new Set(profileUsers.map((user) => user.id));
  const unique = new Map<number, SocialUser>();
  for (const user of viewerFollowing)
    if (profileIds.has(user.id) && !excludeIds.has(user.id)) unique.set(user.id, user);
  return [...unique.values()].sort(byName);
}

/** Connected people per custom list. A person in several lists counts in each. */
export function attributeLists(
  lists: CustomLists,
  connected: readonly SocialUser[]
): ListAttribution[] {
  const byId = new Map(connected.map((user) => [user.id, user]));
  const result: ListAttribution[] = [];
  for (const [name, members] of Object.entries(lists)) {
    const users = [...new Set(members.map((member) => member.id))]
      .map((id) => byId.get(id))
      .filter((user): user is SocialUser => user !== undefined)
      .sort(byName);
    if (users.length > 0) result.push({ name, users });
  }
  return result;
}

export interface ProfileRelationsInput {
  followers: readonly SocialUser[];
  followersComplete: boolean;
  following: readonly SocialUser[];
  followingComplete: boolean;
}

export function computeConnections(
  viewerFollowing: readonly SocialUser[],
  profile: ProfileRelationsInput,
  lists: CustomLists,
  excludeIds: ReadonlySet<number>
): ProfileConnections {
  const followers = intersectUsers(viewerFollowing, profile.followers, excludeIds);
  const following = intersectUsers(viewerFollowing, profile.following, excludeIds);
  const connected = new Map([...followers, ...following].map((user) => [user.id, user]));
  return {
    followers: { users: followers, complete: profile.followersComplete },
    following: { users: following, complete: profile.followingComplete },
    lists: attributeLists(lists, [...connected.values()]),
  };
}

/** True when there is nothing worth a line: no shared people at all. */
export function isEmptyConnections(connections: ProfileConnections): boolean {
  return connections.followers.users.length === 0 && connections.following.users.length === 0;
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);
const atLeast = (group: ConnectionGroup): string =>
  `${group.complete ? '' : 'at least '}${group.users.length}`;

/** "3 followers in common", "at least 1 follower in common". */
export function followersLabel(group: ConnectionGroup): string {
  return `${atLeast(group)} ${plural(group.users.length, 'follower', 'followers')} in common`;
}

/** "1 following": people the viewer follows whom this profile follows. */
export function followingLabel(group: ConnectionGroup): string {
  return `${atLeast(group)} following`;
}

/** "1 in Best Friends". */
export function listLabel(list: ListAttribution): string {
  return `${list.users.length} in ${list.name}`;
}

/** Plain-text summary, e.g. "3 followers in common, 1 following (1 in Best Friends)". */
export function formatConnectionsSummary(connections: ProfileConnections): string {
  const parts: string[] = [];
  if (connections.followers.users.length > 0) parts.push(followersLabel(connections.followers));
  if (connections.following.users.length > 0) parts.push(followingLabel(connections.following));
  const lists = connections.lists.map(listLabel).join(', ');
  return `${parts.join(', ')}${lists ? ` (${lists})` : ''}`;
}

/** Sidebar text for a tally: "(12)" or "(150+)". */
export function formatTally(tally: RelationTally): string {
  return `${tally.count}${tally.complete ? '' : '+'}`;
}
