/**
 * @file FilteredFeed.ts
 * @description Server-backed activity feed for a filter or a custom list.
 *
 * Filtering the rows already on screen leaves the feed empty when nobody recently,
 * say, dropped something. This feed asks AniList for the right activities instead:
 * the activity type is narrowed by the API (`type_in`), while status and search,
 * which the API cannot filter, are matched here while paging until enough rows match.
 */

import { MediaListStatus } from '@/api/AnilistTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { getActivityType, type ActivityFilterType, type AniListActivity } from './ActivityUtils';
import { parseActivityPage } from './ActivityResponse';

export type FeedActivityType = AniListActivity['type'];

/** Whose activities: the members of a custom list, or everyone the viewer follows. */
export type FeedSource = { kind: 'users'; userIds: readonly number[] } | { kind: 'following' };

export interface FeedFilter {
  filters: ReadonlySet<ActivityFilterType>;
  /** Lowercase, trimmed search text; empty means no search. */
  search: string;
}

/** Rows wanted per load before stopping; a load may return fewer when the source runs out. */
export const FEED_TARGET_ROWS = 20;
/** Pages read per load at most, so a rare filter cannot spend the 30 requests/minute budget. */
export const FEED_MAX_PAGES_PER_LOAD = 4;
const PER_PAGE = 50;
/**
 * The user is staring at a spinner: take the client's priority lane instead of queueing behind
 * the home page's background requests (sidebar, scores, forum), each spaced 700ms apart.
 */
const USER_REQUEST = { priority: true } as const;

const ALL_TYPES: readonly FeedActivityType[] = ['ANIME_LIST', 'MANGA_LIST', 'TEXT'];
const TYPES_BY_FILTER: Partial<Record<ActivityFilterType, readonly FeedActivityType[]>> = {
  [MediaListStatus.WATCHING]: ['ANIME_LIST'],
  REWATCHED: ['ANIME_LIST'],
  [MediaListStatus.READING]: ['MANGA_LIST'],
  REREAD: ['MANGA_LIST'],
  [MediaListStatus.COMPLETED]: ['ANIME_LIST', 'MANGA_LIST'],
  [MediaListStatus.PLANNING]: ['ANIME_LIST', 'MANGA_LIST'],
  [MediaListStatus.DROPPED]: ['ANIME_LIST', 'MANGA_LIST'],
  [MediaListStatus.PAUSED]: ['ANIME_LIST', 'MANGA_LIST'],
  TEXT: ['TEXT'],
};

const ACTIVITY_FIELDS = `
  ... on ListActivity {
    id type userId status progress createdAt isLiked
    user { id name avatar { medium } }
    media { id title { romaji userPreferred } coverImage { medium } type }
    replyCount likeCount
  }
  ... on TextActivity {
    id type userId text(asHtml: true) createdAt isLiked
    user { id name avatar { medium } }
    replyCount likeCount
  }`;

export const USERS_FEED_QUERY = `query ($userIds: [Int], $types: [ActivityType], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    activities(userId_in: $userIds, type_in: $types, sort: ID_DESC) {${ACTIVITY_FIELDS}
    }
  }
}`;

export const FOLLOWING_FEED_QUERY = `query ($types: [ActivityType], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    activities(isFollowing: true, type_in: $types, sort: ID_DESC) {${ACTIVITY_FIELDS}
    }
  }
}`;

/** True when the filter narrows the feed; "All" with no search is the plain feed. */
export function isNarrowing(filter: FeedFilter): boolean {
  return filter.search !== '' || !filter.filters.has('ALL');
}

/** The activity types the API must return for these filters, in a stable order. */
export function activityTypesFor(filters: ReadonlySet<ActivityFilterType>): FeedActivityType[] {
  if (filters.has('ALL') || filters.size === 0) return [...ALL_TYPES];
  const wanted = new Set<FeedActivityType>();
  for (const filter of filters)
    for (const type of TYPES_BY_FILTER[filter] ?? ALL_TYPES) wanted.add(type);
  return ALL_TYPES.filter((type) => wanted.has(type));
}

/** Classifies a fetched activity with the same rules the on-page filter uses on row text. */
export function activityFilterType(activity: AniListActivity): ActivityFilterType {
  if (activity.type === 'TEXT') return 'TEXT';
  return getActivityType(`${activity.status ?? ''} ${activity.progress ?? ''}`.trim());
}

function searchableText(activity: AniListActivity): string {
  const title = activity.media?.title;
  return [
    activity.user?.name,
    activity.status,
    activity.progress,
    title?.userPreferred,
    title?.romaji,
    // Tags only matter for display; matching reads the words.
    activity.html?.replace(/<[^>]*>/g, ' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesFeedFilter(activity: AniListActivity, filter: FeedFilter): boolean {
  const typeMatch = filter.filters.has('ALL') || filter.filters.has(activityFilterType(activity));
  return typeMatch && (filter.search === '' || searchableText(activity).includes(filter.search));
}

export interface FeedBatch {
  activities: AniListActivity[];
  /** False once AniList has no older activities for this source and types. */
  hasMore: boolean;
}

/**
 * Pages through one source with one filter. Each `next()` continues where the
 * previous load stopped, so Load More never repeats or skips a row.
 */
export class FilteredFeedCursor {
  private page = 1;
  private exhausted = false;
  private readonly seen = new Set<number>();
  private readonly types: FeedActivityType[];

  constructor(
    private readonly api: IApiClient,
    private readonly source: FeedSource,
    private readonly filter: FeedFilter
  ) {
    this.types = activityTypesFor(filter.filters);
  }

  get hasMore(): boolean {
    return !this.exhausted;
  }

  async next(): Promise<FeedBatch> {
    const activities: AniListActivity[] = [];
    for (let read = 0; read < FEED_MAX_PAGES_PER_LOAD && !this.exhausted; read++) {
      const { activities: rows, hasNextPage } = await this.fetchPage(this.page);
      this.page++;
      this.exhausted = !hasNextPage;
      for (const row of rows) {
        if (this.seen.has(row.id)) continue;
        this.seen.add(row.id);
        if (matchesFeedFilter(row, this.filter)) activities.push(row);
      }
      if (activities.length >= FEED_TARGET_ROWS) break;
    }
    return { activities, hasMore: !this.exhausted };
  }

  private async fetchPage(
    page: number
  ): Promise<{ activities: AniListActivity[]; hasNextPage: boolean }> {
    const variables = { types: this.types, page, perPage: PER_PAGE };
    if (this.source.kind === 'users') {
      const userIds = this.source.userIds;
      const response = await this.api.query<unknown>(
        USERS_FEED_QUERY,
        { ...variables, userIds },
        false,
        USER_REQUEST
      );
      return parseActivityPage(response, { userIds, pageInfo: true });
    }
    const response = await this.api.query<unknown>(FOLLOWING_FEED_QUERY, variables, false, USER_REQUEST);
    return parseActivityPage(response, { pageInfo: true });
  }
}
