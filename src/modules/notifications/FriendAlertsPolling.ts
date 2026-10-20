import type { CustomLists } from '@/modules/social/CustomListService';
import type { FriendAlertGroupScan, FriendAlertRule, FriendAlertsState } from './FriendAlerts';
import { friendAlertsBatch, type FriendAlertQueryInput } from './FriendAlertsQuery';

/** AniList's documented maximum number of IDs in an _in filter. */
const MAX_FILTER_IDS = 10000;
/**
 * Activity created just before a window closes can become visible after the
 * window was queried (clock skew, indexing lag). Completed windows therefore
 * hand the next window a checkpoint this many seconds earlier; repeats are
 * deduplicated by activity ID when collected.
 */
export const POLL_OVERLAP_SECONDS = 120;
export interface FriendAlertTask {
  rules: FriendAlertRule[];
  scan: FriendAlertGroupScan;
  variables: FriendAlertQueryInput;
}

export function prepareFriendAlertPoll(state: FriendAlertsState, lists: CustomLists, owner: number, now: number) {
  const audiences = new Map<string, { users?: number[]; rules: FriendAlertRule[] }>();
  for (const rule of state.rules) {
    const users = rule.list === null ? undefined : [...new Set(
      Object.prototype.hasOwnProperty.call(lists, rule.list) ? lists[rule.list].map(user => user.id) : []
    )].filter(id => id !== owner).sort((a, b) => a - b);
    // Old per-title pages cannot be combined safely: restart from their durable
    // checkpoint, retaining fingerprints/inbox and never skipping unread pages.
    delete rule.scan;
    if (users?.length === 0) {
      rule.since = now;
      rule.checkedAt = now;
      continue;
    }
    const audience = users ? users.join(',') : 'following';
    const group = audiences.get(audience) ?? { users, rules: [] };
    group.rules.push(rule);
    audiences.set(audience, group);
  }
  const previous = state.groups ?? [];
  const candidates: FriendAlertTask[] = [];
  for (const [audience, group] of audiences) {
    group.rules.sort((a, b) => a.mediaId - b.mediaId);
    for (let offset = 0; offset < group.rules.length; offset += MAX_FILTER_IDS) {
      const rules = group.rules.slice(offset, offset + MAX_FILTER_IDS);
      const mediaIds = rules.map(rule => rule.mediaId);
      const existing = previous.find(scan => scan.audience === audience && scan.mediaIds.length === mediaIds.length
        && scan.mediaIds.every((id, index) => id === mediaIds[index]));
      const scan: FriendAlertGroupScan = existing && !existing.complete ? existing : { mediaIds, audience,
        since: Math.max(0, Math.min(...rules.map(rule => rule.since)) - 1), until: now, page: 1,
        recentAfter: existing?.recentAfter ?? 0 };
      // Recent lookups address known IDs directly, with at most one result page.
      // Rotate IDs, not watched titles; every title stays in the fresh activity filter.
      const knownIds = [...new Set(rules.flatMap(rule => rule.recent?.map(entry => entry.id) ?? []))].sort((a, b) => a - b);
      const ids = [...knownIds.filter(id => id > scan.recentAfter), ...knownIds.filter(id => id <= scan.recentAfter)].slice(0, 50);
      candidates.push({ rules, scan, variables: { mediaIds, users: group.users,
        following: group.users ? undefined : true, owner, since: scan.since, until: scan.until, page: scan.page,
        ids: ids.length ? ids : [0], checkRecent: ids.length > 0 } });
    }
  }
  state.groups = candidates.map(task => task.scan);
  candidates.sort((a, b) => Math.min(...a.rules.map(rule => rule.checkedAt)) - Math.min(...b.rules.map(rule => rule.checkedAt)));
  const tasks: FriendAlertTask[] = [];
  let batch: ReturnType<typeof friendAlertsBatch> | undefined;
  for (const candidate of candidates) {
    try {
      const next = friendAlertsBatch([...tasks, candidate].map(task => task.variables));
      tasks.push(candidate);
      batch = next;
    } catch {
      // Extremely large audience sets share subsequent scheduled requests under
      // the common request-size budget. Never fan out into more HTTP calls.
      state.failed = true;
    }
  }
  return { tasks, batch };
}
