import { describe, expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import { MAX_THEME_SONGS, MAX_THEME_TEXT, MUSIC_CACHE_TTL_MS, MUSIC_EMPTY_CACHE_TTL_MS, MUSIC_MAL_ID_QUERY, createMusicThemeCache, isMusicMediaId,
  parseJikanAnimeSearchId, parseJikanThemeResponse, parseMusicMalId, parseMusicMediaLookup, readMusicThemeCache } from './MediaMusicResponse';

describe('identified public media music responses', () => {
  it('reads Edge theme objects including nullable artist/episodes without changing the public cache shape', () => {
    const response = { data: { openings: [{ title: 'Tank!', artist: 'The Seatbelts', episodes: 'eps 1-25' }],
      endings: [{ title: 'Blue', artist: null, episodes: null }] }, meta: { stale: true } };
    expect(parseJikanThemeResponse(response)).toEqual({ openings: ['"Tank!" by The Seatbelts (eps 1-25)'], endings: ['"Blue"'] });
  });
  it.each([{ title: '', artist: null, episodes: null }, { title: 'Song', artist: 42, episodes: null },
    { title: 'Song', artist: null, episodes: {} }, { title: 'Song' }])('rejects malformed Edge theme objects %j', song => {
    expect(() => parseJikanThemeResponse({ data: { openings: [song], endings: [] } })).toThrow();
  });
  it('queries the identity fields that its parser checks and restricts the media type to anime', () => {
    const operation = parse(MUSIC_MAL_ID_QUERY).definitions[0];
    expect(operation.kind).toBe(Kind.OPERATION_DEFINITION);
    if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('Expected operation');
    const media = operation.selectionSet.selections[0];
    if (media.kind !== Kind.FIELD) throw new Error('Expected Media field');
    expect(media.selectionSet?.selections.map(field => field.kind === Kind.FIELD ? field.name.value : '')).toEqual(['id', 'type', 'idMal', 'title']);
    expect(media.arguments?.find(argument => argument.name.value === 'type')?.value).toMatchObject({ kind: Kind.ENUM, value: 'ANIME' });
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, '1', null, undefined])('rejects invalid request ID %s', id => {
    expect(isMusicMediaId(id)).toBe(false);
  });
  it('accepts a valid MAL ID or an explicitly MAL-less identified anime', () => {
    expect(parseMusicMalId({ Media: { id: 1, type: 'ANIME', idMal: 100 } }, 1)).toBe(100);
    expect(parseMusicMalId({ Media: { id: 1, type: 'ANIME', idMal: null } }, 1)).toBeNull();
  });
  it('retains AniList title variants when a media entry has no MAL cross-reference', () => {
    expect(parseMusicMediaLookup({ Media: { id: 1, type: 'ANIME', idMal: null,
      title: { english: 'Romelia War Chronicle', romaji: 'Romeria Senki', native: 'ロメリア戦記' } } }, 1))
      .toEqual({ idMal: null, titles: ['Romelia War Chronicle', 'Romeria Senki', 'ロメリア戦記'] });
  });
  it('resolves only one exact Jikan title match', () => {
    const results = { data: [
      { malId: 100, title: 'Other', titleEnglish: 'Romelia War Chronicle', titleJapanese: 'ロメリア戦記' },
      { malId: 200, title: 'Romelia War Chronicle', titleEnglish: 'Different title' },
    ] };
    expect(parseJikanAnimeSearchId(results, ['Romelia War Chronicle'])).toBeNull();
    expect(parseJikanAnimeSearchId({ data: [results.data[0]] }, ['Romelia War Chronicle'])).toBe(100);
    expect(parseJikanAnimeSearchId({ data: [{ malId: 100, title: 'Romelia War Chronicle' }] }, ['Romelia Chronicle'])).toBeNull();
  });
  it('rejects malformed Jikan search envelopes', () => {
    expect(() => parseJikanAnimeSearchId({}, ['Anime'])).toThrow('Jikan');
  });
  it.each([{}, { data: null }, { data: {} }, { data: { openings: ['Song'] } }, { data: { openings: [null], endings: [] } },
    { data: { openings: [42], endings: [] } }, { data: { openings: Array<string>(1), endings: [] } }, { data: { openings: [], endings: {} } }])('rejects malformed Jikan envelope %j', response => {
    expect(() => parseJikanThemeResponse(response)).toThrow('Jikan');
  });
  it('normalizes explicit null arrays and copies arrays from the external response', () => {
    const data = { openings: ['Song'], endings: null };
    const themes = parseJikanThemeResponse({ data }); data.openings[0] = 'Mutated';
    expect(themes).toEqual({ openings: ['Song'], endings: [] });
  });
});

describe('validated public music cache', () => {
  const now = 100000000;
  const themes = { openings: ['Song'], endings: ['Ending'] };
  it('isolates both cache writes and reads from their callers', () => {
    const input = structuredClone(themes); const entry = createMusicThemeCache(1, input, now);
    input.openings[0] = 'Changed before write'; expect(entry.themes).toEqual(themes);
    const first = readMusicThemeCache(entry, 1, now)!; first.endings[0] = 'Changed after read';
    expect(readMusicThemeCache(entry, 1, now)).toEqual(themes);
  });
  it('expires empty theme results on the shorter TTL', () => {
    const empty = createMusicThemeCache(1, { openings: [], endings: [] }, now, 100);
    expect(readMusicThemeCache(empty, 1, now + MUSIC_EMPTY_CACHE_TTL_MS - 1)).toEqual({ openings: [], endings: [] });
    expect(readMusicThemeCache(empty, 1, now + MUSIC_EMPTY_CACHE_TTL_MS)).toBeNull();
  });
  it('caps third-party theme lists and truncates every text field', () => {
    const long = 'x'.repeat(MAX_THEME_TEXT + 50);
    const songs = Array.from({ length: MAX_THEME_SONGS + 10 }, (_, index) => ({ title: `T${index}`, artist: long, episodes: long }));
    const parsed = parseJikanThemeResponse({ data: { openings: songs, endings: [long] } });
    expect(parsed.openings).toHaveLength(MAX_THEME_SONGS);
    expect(parsed.openings[0]).toBe(`"T0" by ${'x'.repeat(MAX_THEME_TEXT)} (${'x'.repeat(MAX_THEME_TEXT)})`);
    expect(parsed.endings).toEqual(['x'.repeat(MAX_THEME_TEXT)]);
    expect(parseJikanThemeResponse({ data: { openings: [{ title: long, artist: null, episodes: null }], endings: [] } }).openings[0]).toBe(`"${'x'.repeat(MAX_THEME_TEXT)}"`);
  });
  it.each([
    { mediaId: 2 }, { type: 'MANGA' }, { version: 1 }, { version: 2 }, { version: 4 }, { cachedAt: now + 1 }, { cachedAt: -1 }, { cachedAt: NaN },
    { cachedAt: now - MUSIC_CACHE_TTL_MS }, { themes: { openings: [42], endings: [] } }, { themes: { endings: [] } },
  ])('refuses stale, malformed or mismatched cache entries %j', patch => {
    expect(readMusicThemeCache({ ...createMusicThemeCache(1, themes, now), ...patch }, 1, now)).toBeNull();
  });
  it('does not trust legacy data without identity or a timestamp, while retaining a fresh entry until its TTL expires', () => {
    expect(readMusicThemeCache(themes, 1, now)).toBeNull();
    const entry = createMusicThemeCache(1, themes, now);
    expect(readMusicThemeCache(entry, 1, now + MUSIC_CACHE_TTL_MS - 1)).toEqual(themes);
    expect(readMusicThemeCache(entry, 1, now + MUSIC_CACHE_TTL_MS)).toBeNull();
  });
});
