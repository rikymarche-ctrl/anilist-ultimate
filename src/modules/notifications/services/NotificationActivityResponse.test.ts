import { describe, expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import {
  NOTIFICATION_ACTIVITY_QUERY,
  parseNotificationActivity,
  parseNotificationDetails,
} from './NotificationActivityResponse';

const text = (content: unknown = 'Text') => ({
  __typename: 'TextActivity',
  id: 7,
  type: 'TEXT',
  text: content,
});
const list = () => ({
  __typename: 'ListActivity',
  id: 7,
  type: 'ANIME_LIST',
  status: 'watched episode',
  media: {
    id: 9,
    type: 'ANIME',
    title: { userPreferred: null, romaji: 'Romaji', english: 'English' },
  },
});
describe('notification activity projection', () => {
  it('requests identity and type in each union fragment and one variable root field', () => {
    const document = parse(NOTIFICATION_ACTIVITY_QUERY);
    const operation = document.definitions[0];
    expect(operation.kind).toBe(Kind.OPERATION_DEFINITION);
    if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('operation');
    expect(operation.selectionSet.selections).toHaveLength(1);
    const root = operation.selectionSet.selections[0];
    if (root.kind !== Kind.FIELD) throw new Error('root');
    expect(root.name.value).toBe('Activity');
    expect(root.arguments?.[0].value.kind).toBe(Kind.VARIABLE);
    const fragments = root.selectionSet!.selections.filter(
      (selection) => selection.kind === Kind.INLINE_FRAGMENT
    );
    expect(fragments.map((fragment) => fragment.typeCondition!.name.value)).toEqual([
      'ListActivity',
      'TextActivity',
      'MessageActivity',
    ]);
    for (const fragment of fragments)
      expect(
        fragment.selectionSet.selections
          .slice(0, 2)
          .map((field) => field.kind === Kind.FIELD && field.name.value)
      ).toEqual(['id', 'type']);
  });
  it('projects only the selected member, normalizes nullable strings, and preserves empty content', () => {
    expect(parseNotificationActivity({ ...text(null), type: null, message: 42 }, 7)).toEqual({
      text: '',
    });
    expect(parseNotificationActivity(text(''), 7)).toEqual({ text: '' });
    expect(
      parseNotificationActivity(
        {
          __typename: 'MessageActivity',
          id: 7,
          type: null,
          isPrivate: null,
          message: null,
          text: 42,
        },
        7
      )
    ).toEqual({ text: '', isPrivate: null });
    expect(
      parseNotificationActivity(
        { __typename: 'MessageActivity', id: 7, type: 'MESSAGE', isPrivate: false, message: 'Hi' },
        7
      )
    ).toEqual({ text: 'Hi', isPrivate: false });
    expect(parseNotificationActivity(null, 7)).toBeUndefined();
  });
  it('prefers the viewer-preferred title, then romaji, then English, while detaching all transport data', () => {
    const raw = list();
    const result = parseNotificationActivity(raw, 7);
    expect(result).toEqual({
      text: 'watched episode Romaji',
      status: 'watched episode',
      mediaId: 9,
      mediaType: 'ANIME',
      mediaTitle: 'Romaji',
    });
    raw.media.title.romaji = 'changed';
    raw.status = 'changed';
    expect(result?.mediaTitle).toBe('Romaji');
    expect(
      parseNotificationActivity(
        {
          ...list(),
          type: 'MANGA_LIST',
          media: {
            ...list().media,
            type: 'MANGA',
            title: { userPreferred: null, romaji: 'Romaji', english: null },
          },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'Romaji', mediaType: 'MANGA' });
  });
  it('uses userPreferred when present, even over romaji and English', () => {
    expect(
      parseNotificationActivity(
        {
          ...list(),
          media: {
            ...list().media,
            title: {
              userPreferred: 'Seitokai ni mo Ana wa Aru!',
              romaji: 'Seitokai ni mo Ana wa Aru!',
              english: 'Even the Student Council Has Its Holes!',
            },
          },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'Seitokai ni mo Ana wa Aru!' });
    expect(
      parseNotificationActivity(
        {
          ...list(),
          media: {
            ...list().media,
            title: { userPreferred: 'Native Pick', romaji: 'Romaji', english: 'English' },
          },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'Native Pick' });
  });
  it('falls back to romaji before English when userPreferred is null', () => {
    expect(
      parseNotificationActivity(
        {
          ...list(),
          media: {
            ...list().media,
            title: { userPreferred: null, romaji: 'Romaji', english: 'English' },
          },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'Romaji' });
    expect(
      parseNotificationActivity(
        {
          ...list(),
          media: {
            ...list().media,
            title: { userPreferred: null, romaji: null, english: 'English' },
          },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'English' });
  });
  it('accepts nullable list/media/title/type fields without manufacturing a wrong media link', () => {
    expect(parseNotificationActivity({ ...list(), status: null, media: null }, 7)).toEqual({
      text: '',
      status: '',
    });
    expect(
      parseNotificationActivity(
        { ...list(), status: null, media: { ...list().media, type: null, title: null } },
        7
      )
    ).toEqual({
      text: 'Unknown',
      status: '',
      mediaId: 9,
      mediaType: 'ANIME',
      mediaTitle: 'Unknown',
    });
    expect(
      parseNotificationActivity(
        { ...list(), type: null, media: { ...list().media, type: 'MANGA' } },
        7
      )
    ).toMatchObject({ mediaType: 'MANGA' });
    expect(
      parseNotificationActivity(
        { ...list(), type: null, media: { ...list().media, type: null } },
        7
      )
    ).toEqual({ text: '', status: 'watched episode' });
    expect(
      parseNotificationActivity(
        {
          ...list(),
          media: { ...list().media, title: { userPreferred: null, romaji: null, english: null } },
        },
        7
      )
    ).toMatchObject({ mediaTitle: 'Unknown' });
  });
  it.each([
    undefined,
    {},
    { ...text(), id: 8 },
    { ...text(), id: '7' },
    { ...text(), __typename: undefined },
    { ...text(), type: undefined },
    { ...text(), type: 'MESSAGE' },
    text(42),
    { ...text(), text: undefined },
    { ...list(), status: 42 },
    { ...list(), media: undefined },
    { ...list(), media: { ...list().media, id: 0 } },
    { ...list(), media: { ...list().media, type: 'MANGA' } },
    { ...list(), media: { ...list().media, title: {} } },
    { __typename: 'MessageActivity', id: 7, type: 'MESSAGE', message: false },
  ])('rejects malformed requested union data: %j', (raw) => {
    expect(() => parseNotificationActivity(raw, 7)).toThrow(
      'Invalid notification activity response'
    );
  });
  it.each([0, -1, NaN, 1.5, 2147483648])(
    'rejects a request outside GraphQL positive Int identity: %j',
    (id) => {
      expect(() => parseNotificationActivity(null, id)).toThrow();
    }
  );
  it('validates canonical cached details, strips extras, and returns a detached snapshot', () => {
    const details = { text: 'Text', extra: { secret: true } };
    const copy = parseNotificationDetails(details);
    copy.text = 'changed';
    expect(details.text).toBe('Text');
    expect(copy).toEqual({ text: 'changed' });
    expect(parseNotificationDetails(parseNotificationActivity(list(), 7))).toEqual(
      parseNotificationActivity(list(), 7)
    );
  });
  it.each([true, false, null])(
    'preserves explicit message privacy %j through the response and cache',
    (isPrivate) => {
      expect(NOTIFICATION_ACTIVITY_QUERY).toContain('isPrivate');
      const projected = parseNotificationActivity(
        { __typename: 'MessageActivity', id: 7, type: 'MESSAGE', isPrivate, message: '' },
        7
      );
      expect(projected).toEqual({ text: '', isPrivate });
      expect(parseNotificationDetails(projected)).toEqual({ text: '', isPrivate });
    }
  );
  it.each([undefined, 'true', 1, {}])(
    'rejects malformed privacy rather than treating it as public: %j',
    (isPrivate) => {
      expect(() =>
        parseNotificationActivity(
          { __typename: 'MessageActivity', id: 7, type: 'MESSAGE', isPrivate, message: 'Hi' },
          7
        )
      ).toThrow();
    }
  );
  it.each([
    { text: 42 },
    { text: 'Text', status: 42 },
    { text: 'Text', status: 'watched' },
    { text: 'Text', mediaType: 'ANIME' },
    {
      text: 'watched Title',
      mediaId: 0,
      mediaTitle: 'Title',
      status: 'watched',
      mediaType: 'ANIME',
    },
    { text: 'wrong', mediaId: 9, mediaTitle: 'Title', status: 'watched', mediaType: 'MANGA' },
    {
      text: 'watched Title',
      mediaId: 9,
      mediaTitle: 'Title',
      status: 'watched',
      mediaType: 'OTHER',
    },
    { text: '', isPrivate: 'true' },
    { text: '', isPrivate: 1 },
    { text: '', isPrivate: true, status: '' },
    {
      text: 'watched Title',
      mediaId: 9,
      mediaTitle: 'Title',
      status: 'watched',
      mediaType: 'ANIME',
      isPrivate: true,
    },
  ])('rejects unsafe or inconsistent cached fields: %j', (value) => {
    expect(() => parseNotificationDetails(value)).toThrow();
  });
});
