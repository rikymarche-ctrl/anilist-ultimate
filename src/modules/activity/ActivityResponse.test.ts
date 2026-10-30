import { describe, expect, it } from 'vitest';
import { activityUserIds, parseActivityPage, parseFeedActivity } from './ActivityResponse';
import { feedActivity } from '@/test/activity-fixtures';

const page = (rows: unknown[], hasNextPage: unknown = false) => ({
  Page: { activities: rows, pageInfo: { hasNextPage } },
});
describe('activity domain boundary', () => {
  it('normalizes nullable provider fields and copies rows instead of exposing transport references', () => {
    const raw = {
      ...feedActivity(),
      status: null,
      progress: null,
      user: { ...feedActivity().user, avatar: null },
      media: { ...feedActivity().media, title: { romaji: null }, coverImage: null },
    };
    const result = parseFeedActivity(raw);
    expect(result.status).toBe('');
    expect(result.progress).toBe('');
    expect(result.user?.avatar.medium).toBe('');
    expect(result.media).toMatchObject({
      title: { romaji: 'Unknown' },
      coverImage: { medium: '' },
    });
    raw.media.title.romaji = 'new' as never;
    expect(result.media?.title.romaji).toBe('Unknown');
    expect(
      parseFeedActivity({ ...feedActivity(), user: null, userId: null, media: null }).user
    ).toBeNull();
    expect(
      parseFeedActivity({ ...feedActivity(), type: 'TEXT', text: null, userId: null }).html
    ).toBe('');
  });
  it('carries TEXT activities as html and accepts an already-parsed activity back through the boundary', () => {
    const provider = {
      ...feedActivity(),
      type: 'TEXT',
      text: '<p><strong>x</strong></p>',
      media: undefined,
    };
    const parsed = parseFeedActivity(provider);
    expect(parsed.html).toBe('<p><strong>x</strong></p>');
    expect(parseFeedActivity(parsed).html).toBe('<p><strong>x</strong></p>');
  });
  it('preserves manga identity and zero counters', () => {
    expect(
      parseFeedActivity({
        ...feedActivity(),
        type: 'MANGA_LIST',
        media: { ...feedActivity().media, type: 'MANGA' },
        replyCount: 0,
        likeCount: 0,
      })
    ).toMatchObject({ type: 'MANGA_LIST', media: { type: 'MANGA' }, replyCount: 0, likeCount: 0 });
  });
  it('skips nullable union tombstones without losing pagination', () => {
    expect(parseActivityPage(page([null, feedActivity()], true), { pageInfo: true })).toEqual({
      activities: [{ ...feedActivity(), isLiked: false }],
      hasNextPage: true,
    });
  });
  it.each([
    null,
    {},
    page([], 'false'),
    page(Array.from({ length: 26 }, (_, index) => feedActivity(index + 1))),
  ])('rejects invalid envelopes/page size: %j', (value) => {
    expect(() => parseActivityPage(value, { maxSize: 25, pageInfo: true })).toThrow(
      'Invalid activity response'
    );
  });
  it.each([
    { ...feedActivity(), id: 2147483648 },
    { ...feedActivity(), createdAt: Infinity },
    { ...feedActivity(), replyCount: -1 },
    { ...feedActivity(), likeCount: 1.5 },
    { ...feedActivity(), userId: 9 },
    { ...feedActivity(), user: { ...feedActivity().user, name: '' } },
    { ...feedActivity(), type: 'MESSAGE' },
    { ...feedActivity(), progress: {} },
    { ...feedActivity(), media: { ...feedActivity().media, type: 'MANGA' } },
  ])('rejects invalid domain fields: %j', (row) => {
    expect(() => parseFeedActivity(row)).toThrow('Invalid activity response');
  });
  it('requires the requested media and user membership, and rejects duplicate activity IDs', () => {
    expect(() => parseActivityPage(page([feedActivity()]), { mediaId: 11 })).toThrow();
    expect(() => parseActivityPage(page([feedActivity()]), { userIds: [8] })).toThrow();
    expect(() => parseActivityPage(page([feedActivity(), feedActivity()]))).toThrow();
    expect(
      parseActivityPage(page([{ ...feedActivity(), user: null }]), { userIds: [7] }).activities[0]
        .user
    ).toBeNull();
  });
  it('captures only valid unique numeric list members, including the upper GraphQL Int boundary', () => {
    expect(activityUserIds([{ id: 7 }, { id: 7 }, { id: 2147483647 }])).toEqual([7, 2147483647]);
    expect(() => activityUserIds([{ id: '7' }])).toThrow();
    expect(() => activityUserIds([{ id: 2147483648 }])).toThrow();
    expect(() =>
      activityUserIds(Array.from({ length: 10001 }, (_, index) => ({ id: index + 1 })))
    ).toThrow('filter limit');
  });
});
