import { isRecord } from '@/api/GraphQLResponse';

export type MetadataMediaType = 'ANIME' | 'MANGA';
export interface MediaMetadataLookup {
  idMal: number | null;
  externalLinks: { url: string | null; site: string }[];
}
export interface MediaMetadataInfo extends MediaMetadataLookup { malScore: string | null; }

export const METADATA_QUERY = `query ($id: Int!, $type: MediaType!) {
  Media(id: $id, type: $type) { id type idMal externalLinks { url site } }
}`;
export const METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function isMetadataId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}
export function isMetadataType(value: unknown): value is MetadataMediaType { return value === 'ANIME' || value === 'MANGA'; }
function fail(): never { throw new Error('Invalid media metadata response'); }

/** Only absolute HTTP(S) links without credentials enter the public projection. */
function publicHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function parseExternalLinks(value: unknown, strictUrls = false): MediaMetadataLookup['externalLinks'] {
  if (value === null) return [];
  if (!Array.isArray(value)) fail();
  const links: MediaMetadataLookup['externalLinks'] = [];
  for (const item of value as unknown[]) {
    if (item === null) continue; // AniList's list items are nullable.
    if (!isRecord(item) || typeof item.site !== 'string' || (item.url !== null && typeof item.url !== 'string')) fail();
    const url = item.url === null ? null : publicHttpUrl(item.url);
    if (item.url !== null && url === null) {
      if (strictUrls) fail();
      continue; // Keep valid metadata while omitting unsafe provider links.
    }
    links.push({ url, site: item.site });
  }
  return links;
}

/** A null Media is a successful not-found result; omitted identities are failures. */
export function parseMediaMetadataResponse(response: unknown, mediaId: number, type: MetadataMediaType): MediaMetadataLookup | null {
  if (!isMetadataId(mediaId) || !isMetadataType(type) || !isRecord(response)) fail();
  if (response.Media === null) return null;
  const media = response.Media;
  if (!isRecord(media) || media.id !== mediaId || media.type !== type || (media.idMal !== null && !isMetadataId(media.idMal))) fail();
  return { idMal: media.idMal, externalLinks: parseExternalLinks(media.externalLinks) };
}

export function parseJikanMetadataScore(response: unknown, idMal: number): string | null {
  if (!isMetadataId(idMal) || !isRecord(response) || !isRecord(response.data) || response.data.malId !== idMal) fail();
  const score = response.data.score;
  if (score === null) return null;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10) fail();
  return String(score);
}

export function trustedRedditUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const safe = publicHttpUrl(value); if (!safe) return null;
  const url = new URL(safe);
  return url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com') ? safe : null;
}

function parseCacheInfo(value: unknown): MediaMetadataInfo {
  if (!isRecord(value) || (value.idMal !== null && !isMetadataId(value.idMal))) fail();
  const score = value.malScore;
  if (score !== null && (typeof score !== 'string' || String(Number(score)) !== score
    || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10)) fail();
  if (value.idMal === null && score !== null) fail();
  return { idMal: value.idMal, malScore: score as string | null, externalLinks: parseExternalLinks(value.externalLinks, true) };
}

interface MetadataCacheEntry {
  version: 1;
  mediaId: number;
  type: MetadataMediaType;
  cachedAt: number;
  info: MediaMetadataInfo;
}

/** This cache contains only public links and a public MAL aggregate, never viewer data. */
export function createMetadataCache(mediaId: number, type: MetadataMediaType, info: MediaMetadataInfo, now = Date.now()): MetadataCacheEntry {
  if (!isMetadataId(mediaId) || !isMetadataType(type) || !Number.isSafeInteger(now) || now < 0) fail();
  return { version: 1, mediaId, type, cachedAt: now, info: parseCacheInfo(info) };
}

export function readMetadataCache(value: unknown, mediaId: number, type: MetadataMediaType, now = Date.now()): MediaMetadataInfo | null {
  if (!isMetadataId(mediaId) || !isMetadataType(type) || !Number.isSafeInteger(now) || now < 0
    || !isRecord(value) || value.version !== 1 || value.mediaId !== mediaId || value.type !== type
    || typeof value.cachedAt !== 'number' || !Number.isSafeInteger(value.cachedAt) || value.cachedAt < 0
    || value.cachedAt > now || now - value.cachedAt >= METADATA_CACHE_TTL_MS) return null;
  try { return parseCacheInfo(value.info); } catch { return null; }
}
