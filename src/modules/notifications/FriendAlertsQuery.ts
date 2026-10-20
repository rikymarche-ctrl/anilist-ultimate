import { Kind, parse, print, visit, type OperationDefinitionNode } from 'graphql';
import { isRecord } from '@/api/GraphQLResponse';
import { validateApiRequest } from '@/api/ApiBoundary';
import { isActivityId } from '@/modules/activity/ActivityResponse';

/** Only fields used by the local inbox; titles already exist in the subscription. */
const ACTIVITY_FRAGMENT = `fragment FriendAlertActivity on ListActivity {
  id type userId status progress createdAt
  user { id name }
  media { id type }
}`;
export const FRIEND_ALERTS_QUERY = `query FriendAlerts($mediaIds: [Int!]!, $users: [Int], $following: Boolean, $owner: Int!, $since: Int!, $until: Int!, $page: Int!, $ids: [Int!]!, $checkRecent: Boolean!) {
  recent: Page(page: 1, perPage: 50) @include(if: $checkRecent) {
    activities(id_in: $ids, mediaId_in: $mediaIds, userId_in: $users, userId_not: $owner, isFollowing: $following, type: MEDIA_LIST) {
      ...FriendAlertActivity
    }
  }
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    activities(mediaId_in: $mediaIds, userId_in: $users, userId_not: $owner, isFollowing: $following, type: MEDIA_LIST,
      createdAt_greater: $since, createdAt_lesser: $until, sort: ID) {
      ...FriendAlertActivity
    }
  }
}
${ACTIVITY_FRAGMENT}`;

export interface FriendAlertQueryInput {
  mediaIds: number[];
  users?: number[];
  following?: boolean;
  owner: number;
  since: number;
  until: number;
  page: number;
  ids: number[];
  checkRecent: boolean;
}

/** Audience groups share one transport, bounded by request size rather than a title count. */
export function friendAlertsBatch(inputs: FriendAlertQueryInput[]) {
  if (!inputs.length) throw new Error('Invalid alert batch size');
  if (inputs.some(input => !input.mediaIds.length || input.mediaIds.length > 10000
    || !input.mediaIds.every(isActivityId) || !isActivityId(input.owner)
    || (input.users === undefined ? input.following !== true
      : !input.users.length || input.users.length > 10000 || !input.users.every(isActivityId) || input.following !== undefined)
    || !Number.isSafeInteger(input.since) || input.since < 0 || !Number.isSafeInteger(input.until) || input.until < input.since
    || !isActivityId(input.page) || typeof input.checkRecent !== 'boolean'
    || (input.checkRecent && (!input.ids.length || input.ids.length > 50 || !input.ids.every(isActivityId))))) {
    throw new Error('Invalid alert query filters');
  }
  const variables: Record<string, unknown> = {};
  let query = FRIEND_ALERTS_QUERY;
  if (inputs.length === 1) Object.assign(variables, inputs[0]);
  else {
    const document = parse(FRIEND_ALERTS_QUERY);
    const source = document.definitions[0] as OperationDefinitionNode;
    const operations = inputs.map((input, index) => {
      for (const [name, value] of Object.entries(input)) variables[`v${index}_${name}`] = value;
      const operation = visit(source, {
        Variable(node) {
          return { ...node, name: { ...node.name, value: `v${index}_${node.name.value}` } };
        },
      });
      return {
        ...operation,
        selectionSet: {
          ...operation.selectionSet,
          selections: operation.selectionSet.selections.map(field => {
            if (field.kind !== Kind.FIELD) throw new Error('Invalid alert query');
            return { ...field, alias: { kind: Kind.NAME as const,
              value: `${field.alias?.value === 'recent' ? 'r' : 'p'}${index}` } };
          }),
        },
      };
    });
    query = print({ kind: Kind.DOCUMENT, definitions: [{ ...source,
      name: { kind: Kind.NAME, value: 'FriendAlertsBatch' },
      variableDefinitions: operations.flatMap(operation => operation.variableDefinitions ?? []),
      selectionSet: { kind: Kind.SELECTION_SET,
        selections: operations.flatMap(operation => operation.selectionSet.selections) },
    }, ...document.definitions.slice(1)] });
  }
  // Reuse the shared byte/selection budgets; no fixed number of titles or audiences.
  validateApiRequest({ query, variables, method: 'query' });
  return {
    query,
    variables,
    decode(response: unknown, index: number): { Page: unknown; recent: unknown } {
      if (!isRecord(response)) throw new Error('Invalid alert batch response');
      return inputs.length === 1 ? { Page: response.Page, recent: response.recent }
        : { Page: response[`p${index}`], recent: response[`r${index}`] };
    },
  };
}

export interface FriendAlertActivity {
  id: number; mediaId: number; mediaType: 'ANIME' | 'MANGA';
  userId: number; userName: string; status: string; progress: string; createdAt: number;
}

/** Validate the compact response against the exact audience and media set sent. */
export function parseFriendAlertPage(value: unknown, input: FriendAlertQueryInput, recent = false) {
  if (!isRecord(value) || !Array.isArray(value.activities) || value.activities.length > 50
    || (!recent && (!isRecord(value.pageInfo) || typeof value.pageInfo.hasNextPage !== 'boolean'))) {
    throw new Error('Invalid alert activities');
  }
  const media = new Set(input.mediaIds);
  const users = input.users && new Set(input.users);
  const requestedIds = new Set(input.ids);
  const seen = new Set<number>();
  const activities: FriendAlertActivity[] = [];
  for (const row of value.activities) {
    if (row === null) continue;
    if (!isRecord(row) || !isActivityId(row.id) || seen.has(row.id)
      || !['ANIME_LIST', 'MANGA_LIST'].includes(row.type as string)
      || !isActivityId(row.userId) || (users && !users.has(row.userId))
      || !Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0
      || (row.status !== null && typeof row.status !== 'string')
      || (row.progress !== null && typeof row.progress !== 'string')
      || (typeof row.status === 'string' && row.status.length > 500)
      || (typeof row.progress === 'string' && row.progress.length > 500)
      || !isRecord(row.media) || !isActivityId(row.media.id) || !media.has(row.media.id)
      || row.media.type !== (row.type === 'ANIME_LIST' ? 'ANIME' : 'MANGA')
      || (recent ? !requestedIds.has(row.id)
        : (row.createdAt as number) <= input.since || (row.createdAt as number) >= input.until)) {
      throw new Error('Unrelated alert activity');
    }
    seen.add(row.id);
    // A deleted/private user is not a notification target.
    if (row.user === null || row.userId === input.owner) continue;
    if (!isRecord(row.user) || row.user.id !== row.userId || typeof row.user.name !== 'string'
      || !row.user.name.trim() || row.user.name.length > 200) throw new Error('Invalid alert user');
    try { encodeURIComponent(row.user.name); } catch { throw new Error('Invalid alert user'); }
    activities.push({ id: row.id, mediaId: row.media.id,
      mediaType: row.media.type as 'ANIME' | 'MANGA', userId: row.userId, userName: row.user.name,
      status: row.status as string || '', progress: row.progress as string || '', createdAt: row.createdAt as number });
  }
  return { activities, hasNextPage: !recent && (value.pageInfo as { hasNextPage: boolean }).hasNextPage };
}
