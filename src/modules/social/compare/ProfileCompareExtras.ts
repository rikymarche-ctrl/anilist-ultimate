/**
 * @file ProfileCompareExtras.ts
 * @description The deep end of a comparison: head-to-head figures, score habits, status conflicts,
 * rare shared titles, per-genre scores, themes, formats, decades, countries, people and full lists.
 * Pure functions; adult titles and adult or spoiler tags are never surfaced by name.
 */

import type { CompareEntry, CompareMedia, CompareStat, CompareStats } from './ProfileCompareModel';

export interface TapeRow {
  label: string;
  viewer: number;
  other: number;
  decimals: number;
  suffix: string;
}

export interface ShareRow {
  label: string;
  viewerCount: number;
  otherCount: number;
  viewerShare: number;
  otherShare: number;
}

export interface GenreScoreRow {
  genre: string;
  viewerMean: number;
  otherMean: number;
}

export interface PersonRow {
  id: number;
  name: string;
  image: string | null;
  viewerCount: number;
  otherCount: number;
}

export interface ConflictRow {
  mediaId: number;
  title: string;
  cover: string | null;
  completedBy: 'viewer' | 'other';
  viewerScore: number;
  otherScore: number;
}

export interface DeepCut {
  mediaId: number;
  title: string;
  cover: string | null;
  popularity: number;
  viewerScore: number;
  otherScore: number;
}

export interface BrowserRow {
  mediaId: number;
  title: string;
  cover: string | null;
  viewerScore: number | null;
  otherScore: number | null;
}

export interface DistributionRow {
  bucket: number;
  viewerShare: number;
  otherShare: number;
}

const MINUTES_PER_HOUR = 60;
const MIN_GENRE_SCORED = 5;
const TOP_GENRE_SCORES = 6;
const TOP_TAGS = 8;
const TOP_PEOPLE = 6;
const TOP_CONFLICTS = 8;
const TOP_DEEP_CUTS = 5;
const SCORE_BUCKETS = 10;
const MIN_NOTABLE_SHARE = 0.01;

const FORMAT_NAMES: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music video',
  MANGA: 'Manga',
  NOVEL: 'Light novel',
  ONE_SHOT: 'One shot',
};
const COUNTRY_NAMES: Record<string, string> = {
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  TW: 'Taiwan',
};

const scoredOf = (entries: readonly CompareEntry[]) => entries.filter((entry) => entry.score > 0);
const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const spread = (values: readonly number[]) => {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
};
const countStatus = (entries: readonly CompareEntry[], status: CompareEntry['status']) =>
  entries.filter((entry) => entry.status === status).length;

export function tapeRows(
  media: CompareMedia,
  viewerAll: readonly CompareEntry[],
  otherAll: readonly CompareEntry[],
  viewerStats: CompareStats,
  otherStats: CompareStats
): TapeRow[] {
  const row = (
    label: string,
    pick: (entries: readonly CompareEntry[], stats: CompareStats) => number,
    decimals = 0,
    suffix = ''
  ): TapeRow => ({
    label,
    viewer: pick(viewerAll, viewerStats),
    other: pick(otherAll, otherStats),
    decimals,
    suffix,
  });
  const seen = (entries: readonly CompareEntry[]) =>
    entries.filter((entry) => entry.status !== 'PLANNING');
  const scores = (entries: readonly CompareEntry[]) =>
    scoredOf(seen(entries)).map((entry) => entry.score);
  const anime = media === 'ANIME';
  return [
    row(anime ? 'Titles watched' : 'Titles read', (entries) => seen(entries).length),
    ...(anime
      ? [
          row('Hours watched', (_, stats) => Math.round(stats.minutes / MINUTES_PER_HOUR)),
          row('Episodes', (_, stats) => stats.units),
        ]
      : [row('Chapters', (_, stats) => stats.units), row('Volumes', (_, stats) => stats.volumes)]),
    row('Mean score', (entries) => mean(scores(entries)), 2),
    row('Score spread', (entries) => spread(scores(entries)), 2),
    row('Completed', (entries) => countStatus(entries, 'COMPLETED')),
    row(anime ? 'Watching now' : 'Reading now', (entries) => countStatus(entries, 'CURRENT')),
    row('Dropped', (entries) => countStatus(entries, 'DROPPED')),
    row(
      'Drop rate',
      (entries) =>
        seen(entries).length ? (100 * countStatus(entries, 'DROPPED')) / seen(entries).length : 0,
      1,
      '%'
    ),
    row('On Planning', (entries) => countStatus(entries, 'PLANNING')),
    row(anime ? 'Rewatches' : 'Rereads', (entries) =>
      entries.reduce((sum, entry) => sum + entry.repeat, 0)
    ),
  ];
}

export function scoreDistribution(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[]
): DistributionRow[] {
  const shares = (entries: readonly CompareEntry[]) => {
    const scored = scoredOf(entries);
    const counts = new Array<number>(SCORE_BUCKETS).fill(0);
    for (const entry of scored)
      counts[Math.min(SCORE_BUCKETS, Math.max(1, Math.ceil(entry.score))) - 1]++;
    return counts.map((count) => (scored.length ? count / scored.length : 0));
  };
  const mine = shares(viewerSeen);
  const theirs = shares(otherSeen);
  return mine.map((viewerShare, index) => ({
    bucket: index + 1,
    viewerShare,
    otherShare: theirs[index],
  }));
}

/** Rows by a single label per title, in the given order (default: most common first). */
export function shareRows(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[],
  labelOf: (entry: CompareEntry) => string | null,
  compare?: (left: ShareRow, right: ShareRow) => number
): ShareRow[] {
  const counts = new Map<string, [number, number]>();
  const tally = (entries: readonly CompareEntry[], side: 0 | 1) => {
    for (const entry of entries) {
      const label = labelOf(entry);
      if (!label) continue;
      const row = counts.get(label) ?? [0, 0];
      counts.set(label, side === 0 ? [row[0] + 1, row[1]] : [row[0], row[1] + 1]);
    }
  };
  tally(viewerSeen, 0);
  tally(otherSeen, 1);
  const rows = [...counts].map(([label, [viewerCount, otherCount]]) => ({
    label,
    viewerCount,
    otherCount,
    viewerShare: viewerSeen.length ? viewerCount / viewerSeen.length : 0,
    otherShare: otherSeen.length ? otherCount / otherSeen.length : 0,
  }));
  return rows
    .filter((row) => Math.max(row.viewerShare, row.otherShare) >= MIN_NOTABLE_SHARE)
    .sort(
      compare ??
        ((left, right) => right.viewerCount + right.otherCount - left.viewerCount - left.otherCount)
    );
}

export const formatLabel = (entry: CompareEntry): string | null =>
  entry.format ? (FORMAT_NAMES[entry.format] ?? entry.format) : null;
export const decadeLabel = (entry: CompareEntry): string | null =>
  entry.releaseYear ? `${Math.floor(entry.releaseYear / 10) * 10}s` : null;
export const countryLabel = (entry: CompareEntry): string | null =>
  entry.country ? (COUNTRY_NAMES[entry.country] ?? entry.country) : null;

export function genreScores(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[]
): GenreScoreRow[] {
  const means = (entries: readonly CompareEntry[]) => {
    const scores = new Map<string, number[]>();
    for (const entry of scoredOf(entries))
      for (const genre of new Set(entry.genres))
        scores.set(genre, [...(scores.get(genre) ?? []), entry.score]);
    return new Map(
      [...scores]
        .filter(([, values]) => values.length >= MIN_GENRE_SCORED)
        .map(([genre, values]) => [genre, mean(values)])
    );
  };
  const mine = means(viewerSeen);
  const theirs = means(otherSeen);
  return [...mine]
    .filter(([genre]) => theirs.has(genre) && genre !== 'Hentai')
    .map(([genre, viewerMean]) => ({ genre, viewerMean, otherMean: theirs.get(genre)! }))
    .sort(
      (left, right) =>
        Math.abs(right.viewerMean - right.otherMean) - Math.abs(left.viewerMean - left.otherMean)
    )
    .slice(0, TOP_GENRE_SCORES);
}

export function tagRows(viewer: CompareStats, other: CompareStats): ShareRow[] {
  const mine = new Map(viewer.tags.map((tag) => [tag.name, tag.count]));
  const theirs = new Map(other.tags.map((tag) => [tag.name, tag.count]));
  return [...new Set([...mine.keys(), ...theirs.keys()])]
    .map((label) => {
      const viewerCount = mine.get(label) ?? 0;
      const otherCount = theirs.get(label) ?? 0;
      return {
        label,
        viewerCount,
        otherCount,
        viewerShare: viewer.count ? viewerCount / viewer.count : 0,
        otherShare: other.count ? otherCount / other.count : 0,
      };
    })
    .sort(
      (left, right) => right.viewerShare + right.otherShare - left.viewerShare - left.otherShare
    )
    .slice(0, TOP_TAGS);
}

/** People or studios on both top lists, strongest shared presence first. */
export function sharedPeople(
  mine: readonly CompareStat[],
  theirs: readonly CompareStat[]
): PersonRow[] {
  const byId = new Map(theirs.map((person) => [person.id, person]));
  return mine
    .filter((person) => byId.has(person.id))
    .map((person) => ({
      id: person.id,
      name: person.name,
      image: person.image,
      viewerCount: person.count,
      otherCount: byId.get(person.id)!.count,
    }))
    .sort(
      (left, right) =>
        Math.min(right.viewerCount, right.otherCount) - Math.min(left.viewerCount, left.otherCount)
    )
    .slice(0, TOP_PEOPLE);
}

export function statusConflicts(
  viewerSeen: readonly CompareEntry[],
  otherById: ReadonlyMap<number, CompareEntry>
): ConflictRow[] {
  const rows: ConflictRow[] = [];
  for (const mine of viewerSeen) {
    const theirs = otherById.get(mine.mediaId);
    if (!theirs || mine.adult) continue;
    const pair = [mine.status, theirs.status];
    if (!pair.includes('COMPLETED') || !pair.includes('DROPPED')) continue;
    rows.push({
      mediaId: mine.mediaId,
      title: mine.title,
      cover: mine.cover,
      completedBy: mine.status === 'COMPLETED' ? 'viewer' : 'other',
      viewerScore: mine.score,
      otherScore: theirs.score,
    });
  }
  return rows.sort((left, right) => left.title.localeCompare(right.title)).slice(0, TOP_CONFLICTS);
}

export function deepCuts(
  viewerSeen: readonly CompareEntry[],
  otherById: ReadonlyMap<number, CompareEntry>
): DeepCut[] {
  const cuts: DeepCut[] = [];
  for (const mine of viewerSeen) {
    const theirs = otherById.get(mine.mediaId);
    if (!theirs || mine.adult || mine.popularity <= 0) continue;
    cuts.push({
      mediaId: mine.mediaId,
      title: mine.title,
      cover: mine.cover,
      popularity: mine.popularity,
      viewerScore: mine.score,
      otherScore: theirs.score,
    });
  }
  return cuts.sort((left, right) => left.popularity - right.popularity).slice(0, TOP_DEEP_CUTS);
}

export function browserRows(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[]
): { shared: BrowserRow[]; viewerOnly: BrowserRow[]; otherOnly: BrowserRow[] } {
  const otherById = new Map(otherSeen.map((entry) => [entry.mediaId, entry]));
  const viewerIds = new Set(viewerSeen.map((entry) => entry.mediaId));
  const named = (entries: readonly CompareEntry[]) => entries.filter((entry) => !entry.adult);
  const base = (entry: CompareEntry) => ({
    mediaId: entry.mediaId,
    title: entry.title,
    cover: entry.cover,
  });
  return {
    shared: named(viewerSeen)
      .filter((entry) => otherById.has(entry.mediaId))
      .map((entry) => ({
        ...base(entry),
        viewerScore: entry.score,
        otherScore: otherById.get(entry.mediaId)!.score,
      })),
    viewerOnly: named(viewerSeen)
      .filter((entry) => !otherById.has(entry.mediaId))
      .map((entry) => ({ ...base(entry), viewerScore: entry.score, otherScore: null })),
    otherOnly: named(otherSeen)
      .filter((entry) => !viewerIds.has(entry.mediaId))
      .map((entry) => ({ ...base(entry), viewerScore: null, otherScore: entry.score })),
  };
}
