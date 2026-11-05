import { describe, expect, it } from 'vitest';
import { planRowMerges, type MergeRow } from './NotificationRowMerge';

const row = (id: string, overrides: Partial<MergeRow<string>> = {}): MergeRow<string> => ({
  row: id,
  type: 'other',
  activityId: 1,
  time: '1 day ago',
  target: '',
  resolved: false,
  ...overrides,
});

const summarize = (rows: MergeRow<string>[]) =>
  planRowMerges(rows).map((merge) => [merge.row, merge.into, merge.note]);

describe('planRowMerges', () => {
  it('merges a mention into a reply sent at the same time', () => {
    // Arrange
    const rows = [row('m', { type: 'mention' }), row('r', { type: 'activity_reply' })];

    // Act
    const plan = summarize(rows);

    // Assert
    expect(plan).toEqual([['m', 'r', 'also mentioned you']]);
  });

  it('keeps a mention separate from a reply sent at another time', () => {
    const rows = [
      row('m', { type: 'mention', time: '1 day ago' }),
      row('r', { type: 'activity_reply', time: '2 days ago' }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('merges a like into a reply at a different time, targeting the activity', () => {
    const rows = [
      row('l', { type: 'activity_like', time: '1 hour ago' }),
      row('r', { type: 'activity_reply', time: '3 days ago' }),
    ];

    expect(summarize(rows)).toEqual([['l', 'r', 'also liked your activity']]);
  });

  it('lets a like and a mention both land on the same reply', () => {
    const rows = [
      row('r', { type: 'activity_reply', time: 'a' }),
      row('m', { type: 'mention', time: 'a' }),
      row('l', { type: 'activity_like', time: 'b' }),
    ];

    expect(summarize(rows)).toEqual([
      ['m', 'r', 'also mentioned you'],
      ['l', 'r', 'also liked your activity'],
    ]);
  });

  it('merges a like into a mention when there is no reply', () => {
    const rows = [row('m', { type: 'mention' }), row('l', { type: 'activity_like' })];

    expect(summarize(rows)).toEqual([['l', 'm', 'also liked your activity']]);
  });

  it('gives each host at most one like', () => {
    const rows = [
      row('r', { type: 'activity_reply' }),
      row('l1', { type: 'activity_like' }),
      row('l2', { type: 'activity_like' }),
    ];

    expect(summarize(rows)).toEqual([['l1', 'r', 'also liked your activity']]);
  });

  it('merges a reply_like into a reply with identical resolved target', () => {
    const rows = [
      row('r', { type: 'activity_reply', resolved: true, target: 'Thanks!' }),
      row('rl', { type: 'reply_like', resolved: true, target: 'Thanks!' }),
    ];

    expect(summarize(rows)).toEqual([['rl', 'r', 'also liked your reply']]);
  });

  it('keeps a reply_like separate when the reply text differs', () => {
    const rows = [
      row('r', { type: 'activity_reply', resolved: true, target: 'Thanks!' }),
      row('rl', { type: 'reply_like', resolved: true, target: 'Something else' }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('keeps a reply_like separate when either row is unresolved', () => {
    const rows = [
      row('r', { type: 'activity_reply', resolved: true, target: 'Thanks!' }),
      row('rl', { type: 'reply_like', resolved: false, target: 'Thanks!' }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('never merges rows about different activities', () => {
    const rows = [
      row('m', { type: 'mention', activityId: 1 }),
      row('r', { type: 'activity_reply', activityId: 2 }),
      row('l', { type: 'activity_like', activityId: 3 }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('never merges rows without an activity id', () => {
    const rows = [
      row('m', { type: 'mention', activityId: null }),
      row('r', { type: 'activity_reply', activityId: null }),
      row('l', { type: 'activity_like', activityId: null }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('never merges two replies together', () => {
    const rows = [
      row('r1', { type: 'activity_reply' }),
      row('r2', { type: 'activity_subscribed_reply' }),
    ];

    expect(summarize(rows)).toEqual([]);
  });

  it('merges only one of two reply_likes into a single reply', () => {
    const rows = [
      row('r', { type: 'activity_reply', resolved: true, target: 'Thanks!' }),
      row('rl1', { type: 'reply_like', resolved: true, target: 'Thanks!' }),
      row('rl2', { type: 'reply_like', resolved: true, target: 'Thanks!' }),
    ];

    expect(summarize(rows)).toEqual([['rl1', 'r', 'also liked your reply']]);
  });
});
