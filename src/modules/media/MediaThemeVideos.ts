import { isRecord } from '@/api/GraphQLResponse';
import { isMusicMediaId } from './MediaMusicResponse';

export interface ThemeVideoLink { type: 'OP' | 'ED'; titles: string[]; url: string; }
export interface ThemeVideoResponse { idMal: number; links: ThemeVideoLink[]; }

export function trustedThemeVideoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'v.animethemes.moe' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /^\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.webm$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/** The public snapshot's URL field is never followed. IDs select a fixed JSON path. */
export function parseThemeVideoIndex(value: unknown): Record<string, number> {
  if (!Array.isArray(value) || value.length > 20000) throw new Error('Invalid theme video index');
  const ids: Record<string, number> = {};
  const ambiguous = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !isMusicMediaId(entry.id) || !isMusicMediaId(entry.malID)) continue;
    const key = String(entry.malID);
    if (ids[key] && ids[key] !== entry.id) ambiguous.add(key);
    ids[key] = entry.id;
  }
  for (const key of ambiguous) delete ids[key];
  if (!Object.keys(ids).length) throw new Error('Empty theme video index');
  return ids;
}

/** Keep only identified MAL matches, OP/ED songs and a selected public video per theme. */
export function parseThemeVideoSnapshot(value: unknown, snapshotId: number, idMal: number): ThemeVideoResponse {
  if (!isMusicMediaId(snapshotId) || !isMusicMediaId(idMal) || !isRecord(value) || value.id !== snapshotId || !isRecord(value.resources) || !Array.isArray(value.resources.nodes)
    || !value.resources.nodes.some(resource => isRecord(resource) && resource.site === 'MAL' && resource.externalId === idMal)
    || !Array.isArray(value.animethemes)) throw new Error('Theme video identity mismatch');
  const links: ThemeVideoLink[] = [];
  for (const theme of value.animethemes) {
    if (!isRecord(theme) || (theme.type !== 'OP' && theme.type !== 'ED') || !isRecord(theme.song) || !isRecord(theme.song.title)
      || !Array.isArray(theme.animethemeentries)) continue;
    const titles = [theme.song.title.romaji, theme.song.title.english, theme.song.title.native]
      .filter((title): title is string => typeof title === 'string' && !!title.trim() && title.length <= 1000);
    if (!titles.length) continue;
    const candidates: { url: string; quality: number }[] = [];
    for (const entry of theme.animethemeentries) {
      if (!isRecord(entry) || !isRecord(entry.videos) || !Array.isArray(entry.videos.nodes)) continue;
      for (const video of entry.videos.nodes) {
        if (!isRecord(video)) continue;
        const url = trustedThemeVideoUrl(video.link);
        if (!url) continue;
        const resolution = typeof video.resolution === 'number' && Number.isFinite(video.resolution)
          ? Math.min(Math.max(video.resolution, 0), 4320) : 0;
        candidates.push({ url, quality: (video.nc === true ? 10000 : 0) + resolution });
      }
    }
    candidates.sort((a, b) => b.quality - a.quality || a.url.localeCompare(b.url));
    if (candidates.length) links.push({ type: theme.type, titles: [...new Set(titles)], url: candidates[0].url });
  }
  return { idMal, links };
}

export function parseThemeVideoResponse(value: unknown, idMal: number): ThemeVideoLink[] {
  if (!isRecord(value) || value.idMal !== idMal || !Array.isArray(value.links) || value.links.length > 300) throw new Error('Invalid theme video response');
  return value.links.map(link => {
    if (!isRecord(link) || (link.type !== 'OP' && link.type !== 'ED') || !Array.isArray(link.titles) || !link.titles.length
      || !link.titles.every(title => typeof title === 'string' && !!title.trim() && title.length <= 1000)) throw new Error('Invalid theme video response');
    const url = trustedThemeVideoUrl(link.url); if (!url) throw new Error('Invalid theme video URL');
    return { type: link.type, titles: [...link.titles] as string[], url };
  });
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]/gu, '');
}

export function findThemeVideo(song: string, type: 'OP' | 'ED', links: ThemeVideoLink[]): string | null {
  const title = song.match(/"([^"]+)"/)?.[1] ?? song.replace(/^\d+:\s*/, '').split(/\s+by\s+/i)[0];
  const variants = [title, title.replace(/\s*\([^)]*\)/g, ''), ...Array.from(title.matchAll(/\(([^)]+)\)/g), match => match[1])];
  const expected = new Set(variants.map(normalize).filter(Boolean));
  const matches = new Set(links.filter(link => link.type === type && link.titles.some(candidate => expected.has(normalize(candidate))))
    .map(link => trustedThemeVideoUrl(link.url)).filter((url): url is string => url !== null));
  return matches.size === 1 ? [...matches][0] : null;
}

export function musicSearchUrl(song: string): string {
  const clean = song.replace(/^\d+:\s*/, '').replace(/https?:\/\/[^\s)]+/g, '').replace(/\s*\(eps?\s*[^)]*\)/gi, '')
    .replace(/\s+by\s+/gi, ' ').replace(/"/g, '').trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(clean + ' official')}`;
}
