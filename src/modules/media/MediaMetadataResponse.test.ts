import { describe, expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import { METADATA_CACHE_TTL_MS, METADATA_QUERY, createMetadataCache, isMetadataId, parseJikanMetadataScore,
  parseMediaMetadataResponse, readMetadataCache, trustedRedditUrl } from './MediaMetadataResponse';

const lookup = { id: 1, type: 'ANIME', idMal: 100, externalLinks: [{ site: 'Reddit', url: 'https://reddit.com/r/anime' }] };
const info = { idMal: 100, malScore: '8.5', externalLinks: structuredClone(lookup.externalLinks) };

describe('identified public metadata responses', () => {
  it('requests the identity and only documented metadata fields with an explicit media type', () => {
    const operation = parse(METADATA_QUERY).definitions[0];
    if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('Expected operation');
    const media = operation.selectionSet.selections[0]; if (media.kind !== Kind.FIELD) throw new Error('Expected Media');
    expect(media.selectionSet?.selections.map(field => field.kind === Kind.FIELD ? field.name.value : '')).toEqual(['id', 'type', 'idMal', 'externalLinks']);
    expect(media.arguments?.find(argument => argument.name.value === 'type')?.value).toMatchObject({ kind: Kind.VARIABLE, name: { value: 'type' } });
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, '1', null, undefined])('rejects invalid request ID %s', id => {
    expect(isMetadataId(id)).toBe(false);
  });
  it('distinguishes successful null Media from an omitted or malformed response', () => {
    expect(parseMediaMetadataResponse({ Media: null }, 1, 'ANIME')).toBeNull();
    expect(() => parseMediaMetadataResponse({}, 1, 'ANIME')).toThrow();
    expect(() => parseMediaMetadataResponse({ Media: {} }, 1, 'ANIME')).toThrow();
  });
  it('projects only public fields and copies external links while preserving explicit nullable fields', () => {
    const response = { Media: { ...structuredClone(lookup), viewerPrivate: 'secret', malScore: 'unrequested' } };
    const projected = parseMediaMetadataResponse(response, 1, 'ANIME');
    response.Media.externalLinks[0].url = 'https://evil.test/changed';
    expect(projected).toEqual({ idMal: 100, externalLinks: [{ site: 'Reddit', url: 'https://reddit.com/r/anime' }] });
    expect(parseMediaMetadataResponse({ Media: { ...lookup, idMal: null, externalLinks: null } }, 1, 'ANIME')).toEqual({ idMal: null, externalLinks: [] });
    const nullableLinks = parseMediaMetadataResponse({ Media: { ...lookup, externalLinks: [null, { site: 'Reddit', url: null }] } }, 1, 'ANIME');
    expect(nullableLinks?.externalLinks).toEqual([{ site: 'Reddit', url: null }]);
  });
  it.each([undefined, {}, [42], [{ site: 'Reddit' }], [{ url: null }], Array<unknown>(1)])('rejects malformed externalLinks %j', links => {
    expect(() => parseMediaMetadataResponse({ Media: { ...lookup, externalLinks: links } }, 1, 'ANIME')).toThrow();
  });
  it('omits unsafe provider URLs while retaining valid public metadata', () => {
    const urls = ['javascript:alert(1)//reddit.com', 'data:text/plain,reddit.com', '/relative', 'https://user:password@reddit.com/r/anime'];
    const response = { Media: { ...lookup, externalLinks: urls.map(url => ({ site: 'Reddit', url })) } };
    expect(parseMediaMetadataResponse(response, 1, 'ANIME')).toEqual({ idMal: 100, externalLinks: [] });
  });
  it('distinguishes zero and explicit null scores without accepting strings or missing score', () => {
    expect(parseJikanMetadataScore({ data: { malId: 100, score: 0 } }, 100)).toBe('0');
    expect(parseJikanMetadataScore({ data: { malId: 100, score: null } }, 100)).toBeNull();
    expect(parseJikanMetadataScore({ data: { malId: 100, score: 8.5 } }, 100)).toBe('8.5');
    expect(() => parseJikanMetadataScore({ data: { malId: 100 } }, 100)).toThrow();
    expect(() => parseJikanMetadataScore({ data: { malId: 100, score: '8.5' } }, 100)).toThrow();
  });
  it.each(['https://reddit.com.evil.test/r/anime', 'https://evil.test/path?reddit.com', 'https://reddit.com@evil.test/r/anime',
    'javascript:alert(1)//reddit.com', '//reddit.com/r/anime', 'https://user:password@reddit.com/r/anime'])('rejects an untrusted Reddit destination %s', url => {
    expect(trustedRedditUrl(url)).toBeNull();
  });
  it.each(['https://reddit.com/r/anime', 'http://www.reddit.com/r/anime', 'https://old.reddit.com/r/anime'])('accepts a trusted Reddit destination %s', url => {
    expect(trustedRedditUrl(url)).toBe(url);
  });
});

describe('identity and TTL of the public metadata cache', () => {
  const now = 100000000;
  it('isolates write/read objects and excludes unknown fields from its projection', () => {
    const source = { ...structuredClone(info), viewerPrivate: 'secret' }; const entry = createMetadataCache(1, 'ANIME', source, now);
    source.externalLinks[0].url = 'https://evil.test/changed'; expect(entry.info).toEqual(info);
    const first = readMetadataCache(entry, 1, 'ANIME', now)!; first.externalLinks[0].url = 'https://evil.test/changed';
    expect(readMetadataCache(entry, 1, 'ANIME', now)).toEqual(info);
  });
  it.each([{ mediaId: 2 }, { type: 'MANGA' }, { version: 2 }, { cachedAt: now + 1 }, { cachedAt: -1 }, { cachedAt: NaN },
    { cachedAt: now - METADATA_CACHE_TTL_MS }, { info: { ...info, malScore: {} } }, { info: { ...info, malScore: 'NaN' } },
    { info: { ...info, malScore: '11' } }, { info: { ...info, malScore: undefined } },
    { info: { ...info, externalLinks: [{ site: 'Reddit', url: 'javascript:alert(1)//reddit.com' }] } },
  ])('rejects expired, mismatched or malformed cache entries %j', patch => {
    expect(readMetadataCache({ ...createMetadataCache(1, 'ANIME', info, now), ...patch }, 1, 'ANIME', now)).toBeNull();
  });
  it('expires at exactly 24 hours and declines legacy raw metadata without identity or timestamp', () => {
    expect(readMetadataCache(info, 1, 'ANIME', now)).toBeNull();
    const entry = createMetadataCache(1, 'ANIME', info, now);
    expect(readMetadataCache(entry, 1, 'ANIME', now + METADATA_CACHE_TTL_MS - 1)).toEqual(info);
    expect(readMetadataCache(entry, 1, 'ANIME', now + METADATA_CACHE_TTL_MS)).toBeNull();
  });
});
