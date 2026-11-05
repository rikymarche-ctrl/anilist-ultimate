/**
 * @file Plans which notification rows of one actor fold into another row about the same activity.
 * Pure: no DOM access, so the merge rules can be checked directly.
 */

export interface MergeRow<T> {
  row: T;
  type: string;
  activityId: number | null;
  time: string;
  target: string;
  resolved: boolean;
}

export interface RowMerge<T> {
  row: T;
  into: T;
  note: string;
}

const REPLY_TYPES: ReadonlySet<string> = new Set(['activity_reply', 'activity_subscribed_reply']);

interface PlannedMerge {
  host: number;
  note: string;
}

/**
 * Returns the merges to apply to rows from one actor, in display order. A merged row is
 * absorbed by a host row that is not merged itself. Each pass only merges when the rows are
 * provably about the same thing; null activity ids never take part.
 */
export function planRowMerges<T>(rows: readonly MergeRow<T>[]): RowMerge<T>[] {
  const merges = new Map<number, PlannedMerge>();
  const mentionHosts = new Set<number>();
  const likeHosts = new Set<number>();
  const replyLikeHosts = new Set<number>();

  const isOpen = (index: number): boolean => !merges.has(index);
  const findHost = (
    from: number,
    matches: (candidate: MergeRow<T>, index: number) => boolean
  ): number => {
    for (let index = 0; index < rows.length; index++) {
      if (index === from || !isOpen(index) || rows[index].activityId === null) continue;
      if (matches(rows[index], index)) return index;
    }
    return -1;
  };

  // a. A mention joins a reply sent at the same time; a mention at another time is another reply.
  rows.forEach((row, index) => {
    if (row.type !== 'mention' || row.activityId === null) return;
    const host = findHost(
      index,
      (candidate, hostIndex) =>
        REPLY_TYPES.has(candidate.type) &&
        candidate.activityId === row.activityId &&
        candidate.time !== '' &&
        candidate.time === row.time &&
        !mentionHosts.has(hostIndex)
    );
    if (host === -1) return;
    mentionHosts.add(host);
    merges.set(index, { host, note: 'also mentioned you' });
  });

  // b. A like targets the activity itself, so time does not matter. Mentions are the fallback host.
  rows.forEach((row, index) => {
    if (row.type !== 'activity_like' || row.activityId === null) return;
    const sameActivity = (candidate: MergeRow<T>) => candidate.activityId === row.activityId;
    let host = findHost(
      index,
      (candidate, hostIndex) =>
        REPLY_TYPES.has(candidate.type) && sameActivity(candidate) && !likeHosts.has(hostIndex)
    );
    if (host === -1)
      host = findHost(
        index,
        (candidate, hostIndex) =>
          candidate.type === 'mention' && sameActivity(candidate) && !likeHosts.has(hostIndex)
      );
    if (host === -1) return;
    likeHosts.add(host);
    merges.set(index, { host, note: 'also liked your activity' });
  });

  // c. A like on a reply joins a reply only when both show the same, resolved text.
  rows.forEach((row, index) => {
    if (row.type !== 'reply_like' || row.activityId === null) return;
    if (!row.resolved || row.target === '') return;
    const host = findHost(
      index,
      (candidate, hostIndex) =>
        REPLY_TYPES.has(candidate.type) &&
        candidate.activityId === row.activityId &&
        candidate.resolved &&
        candidate.target !== '' &&
        candidate.target === row.target &&
        !replyLikeHosts.has(hostIndex)
    );
    if (host === -1) return;
    replyLikeHosts.add(host);
    merges.set(index, { host, note: 'also liked your reply' });
  });

  const plans: RowMerge<T>[] = [];
  rows.forEach((row, index) => {
    const merge = merges.get(index);
    if (!merge) return;
    plans.push({ row: row.row, into: rows[merge.host].row, note: merge.note });
  });
  return plans;
}
