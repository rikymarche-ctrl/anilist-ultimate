import { describe, expect, it } from 'vitest';
import { astraSyncCollection } from './AstraSyncResponse';
import { ASTRA_SYNC_COLLECTION } from '@/api/queries/astra-sync';
import { validateApiRequest } from '@/api/ApiBoundary';

function row(): Record<string, unknown> {
  return {
    id: 110,
    userId: 1,
    mediaId: 10,
    status: 'COMPLETED',
    score: 8.5,
    progress: 12,
    notes: 'My notes',
    startedAt: null,
    completedAt: null,
    customLists: { Favorites: true, Watching: false },
    private: true,
    hiddenFromStatusLists: false,
    media: {
      id: 10,
      type: 'ANIME',
      format: 'TV',
      countryOfOrigin: 'JP',
      title: { romaji: 'Frieren', english: null, native: 'フリーレン' },
      coverImage: { extraLarge: 'https://example.org/cover.jpg', large: null, medium: null },
      genres: ['Fantasy'],
      episodes: 28,
      chapters: null,
      duration: 24,
    },
  };
}
function response(entries: unknown[] = [row()]) {
  return { MediaListCollection: { user: { id: 1 }, hasNextChunk: false, lists: [{ entries }] } };
}

describe('Astra full collection response boundary', () => {
  it('accepts a complete selected response without retaining remote references', () => {
    const original = row();
    const remote = response([original]);
    const page = astraSyncCollection(remote, 1, 'ANIME');
    expect(page.hasNextChunk).toBe(false);
    expect(page.entries[0]).toMatchObject({
      id: 110,
      userId: 1,
      mediaId: 10,
      score: 8.5,
      progress: 12,
    });
    (original.media as Record<string, unknown>).title = {
      romaji: 'Changed',
      english: 'Changed',
      native: 'Changed',
    };
    (original.customLists as Record<string, unknown>).Favorites = false;
    expect(page.entries[0].media.title.romaji).toBe('Frieren');
    expect(page.entries[0].customLists.Favorites).toBe(true);
  });

  it('normalizes explicitly selected schema nulls and nullable genre elements', () => {
    const item = row();
    Object.assign(item, {
      status: null,
      score: null,
      progress: null,
      notes: null,
      customLists: null,
      private: null,
      hiddenFromStatusLists: null,
    });
    Object.assign(item.media as Record<string, unknown>, {
      format: null,
      countryOfOrigin: null,
      title: null,
      coverImage: null,
      genres: [null, 'Fantasy'],
      episodes: null,
      chapters: null,
      duration: null,
    });
    const remote = response([item]);
    const result = astraSyncCollection(remote, 1, 'ANIME');
    expect(result.entries[0]).toMatchObject({
      status: 'PLANNING',
      score: 0,
      progress: 0,
      notes: '',
      customLists: {},
      private: false,
      hiddenFromStatusLists: false,
      media: {
        title: { english: null, romaji: null, native: null },
        coverImage: { extraLarge: null, large: null, medium: null },
        genres: ['Fantasy'],
        episodes: null,
        chapters: null,
        duration: null,
      },
    });
    expect(
      astraSyncCollection(
        { MediaListCollection: { user: { id: 1 }, hasNextChunk: null, lists: null } },
        1,
        'ANIME'
      )
    ).toEqual({ entries: [], hasNextChunk: false });
  });

  it.each([
    'id',
    'userId',
    'mediaId',
    'status',
    'score',
    'progress',
    'notes',
    'customLists',
    'private',
    'hiddenFromStatusLists',
    'startedAt',
    'completedAt',
    'media',
  ])('rejects an omitted selected entry field %s', (field) => {
    const item = row();
    delete item[field];
    expect(() => astraSyncCollection(response([item]), 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });
  it.each([
    'id',
    'type',
    'format',
    'countryOfOrigin',
    'title',
    'coverImage',
    'genres',
    'episodes',
    'chapters',
    'duration',
  ])('rejects an omitted selected media field %s', (field) => {
    const item = row();
    delete (item.media as Record<string, unknown>)[field];
    expect(() => astraSyncCollection(response([item]), 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });

  it.each([
    { field: 'id', value: 0 },
    { field: 'mediaId', value: 2147483648 },
    { field: 'userId', value: 2 },
    { field: 'status', value: 'WATCHING' },
    { field: 'score', value: 11 },
    { field: 'score', value: NaN },
    { field: 'progress', value: -1 },
    { field: 'progress', value: 1.5 },
    { field: 'progress', value: 2147483648 },
    { field: 'notes', value: ['wrong'] },
    { field: 'private', value: 'false' },
    { field: 'hiddenFromStatusLists', value: 0 },
    { field: 'customLists', value: ['Favorites'] },
    { field: 'customLists', value: { Favorites: 'false' } },
    { field: 'media', value: null },
  ])('rejects an invalid entry $field value $value', ({ field, value }) => {
    const item = row();
    item[field] = value;
    expect(() => astraSyncCollection(response([item]), 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });

  it.each([
    { field: 'id', value: 20 },
    { field: 'type', value: 'MANGA' },
    { field: 'type', value: null },
    { field: 'format', value: 'UNKNOWN' },
    { field: 'episodes', value: -1 },
    { field: 'duration', value: 2147483648 },
    { field: 'genres', value: [42] },
    { field: 'title', value: { english: 'Missing other titles' } },
    { field: 'coverImage', value: { extraLarge: 'Missing other sizes' } },
    { field: 'countryOfOrigin', value: 42 },
  ])('rejects invalid selected media $field', ({ field, value }) => {
    const item = row();
    (item.media as Record<string, unknown>)[field] = value;
    expect(() => astraSyncCollection(response([item]), 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });

  it.each([
    null,
    {},
    { MediaListCollection: null },
    { MediaListCollection: [] },
    { MediaListCollection: { user: null, hasNextChunk: false, lists: [] } },
    { MediaListCollection: { user: { id: 2 }, hasNextChunk: false, lists: [] } },
    { MediaListCollection: { user: { id: 1 }, lists: [] } },
    { MediaListCollection: { user: { id: 1 }, hasNextChunk: false } },
    { MediaListCollection: { user: { id: 1 }, hasNextChunk: 'false', lists: [] } },
    { MediaListCollection: { user: { id: 1 }, hasNextChunk: false, lists: [null] } },
    { MediaListCollection: { user: { id: 1 }, hasNextChunk: false, lists: [{}] } },
    response([null]),
  ])('rejects missing, unrelated or malformed collection data %#', (remote) => {
    expect(() => astraSyncCollection(remote, 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });

  it('deduplicates coherent list groups regardless of custom-list property order', () => {
    const first = row();
    const second = row();
    second.customLists = { Watching: false, Favorites: true };
    const remote = response([first]);
    remote.MediaListCollection.lists.push({ entries: [second] });
    expect(astraSyncCollection(remote, 1, 'ANIME').entries).toHaveLength(1);
  });
  it.each(['conflicting data', 'different entry id', 'reused entry id'])(
    'rejects duplicate rows with %s',
    (failure) => {
      const first = row();
      const second = row();
      if (failure === 'conflicting data') second.notes = 'Conflicting notes';
      else if (failure === 'different entry id') second.id = 111;
      else {
        second.mediaId = 20;
        (second.media as Record<string, unknown>).id = 20;
      }
      expect(() => astraSyncCollection(response([first, second]), 1, 'ANIME')).toThrow(
        'Invalid AniList Astra collection response'
      );
    }
  );

  it('preserves special JSON list names as own properties', () => {
    const item = row();
    item.customLists = JSON.parse('{"__proto__":true,"constructor":false}');
    const lists = astraSyncCollection(response([item]), 1, 'ANIME').entries[0].customLists;
    expect(Object.prototype.hasOwnProperty.call(lists, '__proto__')).toBe(true);
    expect(lists.__proto__).toBe(true);
    expect(Object.getPrototypeOf(lists)).toBe(Object.prototype);
  });
  it('rejects oversized unique chunks before importing', () => {
    const rows = Array.from({ length: 501 }, (_, index) => {
      const item = row();
      item.id = index + 1;
      item.mediaId = index + 1;
      (item.media as Record<string, unknown>).id = index + 1;
      return item;
    });
    expect(() => astraSyncCollection(response(rows), 1, 'ANIME')).toThrow(
      'Invalid AniList Astra collection response'
    );
  });
  it('uses a permitted query with required identities and explicit chunk arguments', () => {
    expect(() =>
      validateApiRequest({
        method: 'query',
        query: ASTRA_SYNC_COLLECTION,
        variables: { userId: 1, type: 'ANIME', chunk: 1, perChunk: 500 },
      })
    ).not.toThrow();
    expect(ASTRA_SYNC_COLLECTION).toContain('user { id }');
    expect(ASTRA_SYNC_COLLECTION).toContain('id userId mediaId');
    expect(ASTRA_SYNC_COLLECTION).toContain('score(format: POINT_10_DECIMAL)');
  });
  it('projects detached fuzzy dates without deriving them from notes or status', () => {
    const item = row();
    item.startedAt = { year: 2020, month: null, day: 5 };
    item.completedAt = null;
    const result = astraSyncCollection(response([item]), 1, 'ANIME').entries[0];
    expect(result).toMatchObject({
      startedAt: { year: 2020, month: null, day: 5 },
      completedAt: null,
    });
    (item.startedAt as { year: number }).year = 2000;
    expect((result as unknown as { startedAt: { year: number } }).startedAt.year).toBe(2020);
  });
  it.each([
    undefined,
    '2026-01-01',
    {},
    { year: undefined, month: null, day: null },
    { year: 0, month: 1, day: 1 },
    { year: 2026, month: 13, day: null },
    { year: 2026, month: 2, day: 30 },
  ])('rejects invalid selected date %j', (value) => {
    const item = row();
    item.startedAt = value;
    expect(() => astraSyncCollection(response([item]), 1, 'ANIME')).toThrow();
  });
});
