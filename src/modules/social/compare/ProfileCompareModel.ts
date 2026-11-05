/**
 * @file ProfileCompareModel.ts
 * @description Pure comparison of two anime lists: overlap, score affinity, disagreements,
 * genre taste, who got to each title first and what each should watch next.
 *
 * "Seen" means anything but PLANNING. Private entries never count, so nothing the viewer
 * hid can reach a slide or the shareable card. Adult titles count in totals and genres (never the Hentai genre itself) but
 * are never named or pictured. A score of 0 means unrated, as on AniList.
 */

import {
  browserRows,
  countryLabel,
  decadeLabel,
  deepCuts,
  formatLabel,
  genreScores,
  scoreDistribution,
  shareRows,
  sharedPeople,
  statusConflicts,
  tagRows,
  tapeRows,
  type ConflictRow,
  type DeepCut,
  type DistributionRow,
  type GenreScoreRow,
  type PersonRow,
  type ShareRow,
  type TapeRow,
} from './ProfileCompareExtras';

export type CompareStatus =
  | 'CURRENT'
  | 'PLANNING'
  | 'COMPLETED'
  | 'DROPPED'
  | 'PAUSED'
  | 'REPEATING';
export type CompareSide = 'viewer' | 'other';
export type CompareMedia = 'ANIME' | 'MANGA';

/** One person, studio or tag from AniList's own per-user aggregates. */
export interface CompareStat {
  id: number;
  name: string;
  image: string | null;
  count: number;
}

export interface CompareStats {
  count: number;
  minutes: number;
  /** Episodes or chapters. */
  units: number;
  volumes: number;
  tags: Array<{ name: string; count: number }>;
  studios: CompareStat[];
  voiceActors: CompareStat[];
  staff: CompareStat[];
}

export const EMPTY_STATS: CompareStats = { count: 0, minutes: 0, units: 0, volumes: 0, tags: [], studios: [], voiceActors: [], staff: [] };

export interface CompareUser {
  id: number;
  name: string;
  avatar: string | null;
  stats: CompareStats;
}

export interface CompareEntry {
  mediaId: number;
  title: string;
  cover: string | null;
  status: CompareStatus;
  /** 0–10, 0 = unrated. */
  score: number;
  private: boolean;
  adult: boolean;
  unreleased: boolean;
  /** Day numbers; null unless AniList has the full date. */
  started: number | null;
  completed: number | null;
  genres: readonly string[];
  repeat: number;
  format: string | null;
  releaseYear: number | null;
  country: string | null;
  popularity: number;
}

export interface ScoredTitle {
  mediaId: number;
  title: string;
  cover: string | null;
  viewerScore: number;
  otherScore: number;
}

export interface Affinity {
  /** Pearson correlation of both scores × 100: 100 move together, 0 unrelated, negative opposite. */
  percent: number;
  pairs: number;
  /** Titles both scored exactly the same. */
  exact: number;
  meanGap: number;
  /** Positive when the other person scores higher on average. */
  bias: number;
}

export interface GenreRow {
  genre: string;
  /** Fraction of that person's seen titles carrying this genre. */
  viewerShare: number;
  otherShare: number;
}

export interface GenreTaste {
  rows: GenreRow[];
  /** Weighted overlap of both genre profiles, 0–100. */
  overlap: number;
  common: GenreRow | null;
  divide: GenreRow | null;
}

export interface FirstLead {
  mediaId: number;
  title: string;
  cover: string | null;
  leader: CompareSide;
  days: number;
  viewerDay: number;
  otherDay: number;
  basis: 'started' | 'completed';
}

export interface FirstWatch {
  viewer: number;
  other: number;
  sameDay: number;
  medianDays: number;
  viewerLeads: FirstLead[];
  otherLeads: FirstLead[];
}

export interface HomeworkTitle {
  mediaId: number;
  title: string;
  cover: string | null;
  score: number;
  onPlanning: boolean;
}

export interface CompareReport {
  media: CompareMedia;
  viewer: CompareUser;
  other: CompareUser;
  tape: TapeRow[];
  distribution: DistributionRow[];
  points: ScoredTitle[];
  fightsViewer: ScoredTitle[];
  fightsOther: ScoredTitle[];
  bothLow: ScoredTitle[];
  conflicts: ConflictRow[];
  deepCuts: DeepCut[];
  genreScores: GenreScoreRow[];
  tags: ShareRow[];
  formats: ShareRow[];
  decades: ShareRow[];
  countries: ShareRow[];
  people: { studios: PersonRow[]; voiceActors: PersonRow[]; staff: PersonRow[] };
  browser: ReturnType<typeof browserRows>;
  viewerSeen: number;
  otherSeen: number;
  shared: number;
  viewerOnly: number;
  otherOnly: number;
  /** Shared titles out of everything either has seen, 0–100. */
  overlap: number;
  affinity: Affinity | null;
  fights: ScoredTitle[];
  agreements: ScoredTitle[];
  genres: GenreTaste | null;
  first: FirstWatch | null;
  homework: { viewer: HomeworkTitle[]; other: HomeworkTitle[] };
  verdict: string;
}

/** Below this many titles both scored, a correlation is noise. */
export const MIN_AFFINITY_PAIRS = 5;
/** Below this many comparable dates, a "who was first" score says nothing. */
export const MIN_FIRST_ROWS = 3;
const MIN_FIGHT_GAP = 1;
const MIN_AGREEMENT_SCORE = 7;
const MIN_HOMEWORK_SCORE = 7;
const MIN_NOTABLE_GENRE_SHARE = 0.05;
const TOP_TITLES = 5;
const TOP_GENRES = 8;
const TOP_LEADS = 3;
const TOP_SHAPE_ROWS = 8;
const MAX_LOW_SCORE = 6;
/** Slides and the shareable card never print it. */
const ADULT_GENRE = 'Hentai';

const seenOf = (entries: readonly CompareEntry[]) =>
  entries.filter((entry) => !entry.private && entry.status !== 'PLANNING');

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const byTitle = (left: { title: string }, right: { title: string }) =>
  left.title.localeCompare(right.title);

/** Pearson correlation; null when either side gave every title the same score. */
export function pearson(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  const count = pairs.length;
  if (count < 2) return null;
  const meanLeft = pairs.reduce((sum, pair) => sum + pair[0], 0) / count;
  const meanRight = pairs.reduce((sum, pair) => sum + pair[1], 0) / count;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (const [left, right] of pairs) {
    covariance += (left - meanLeft) * (right - meanRight);
    varianceLeft += (left - meanLeft) ** 2;
    varianceRight += (right - meanRight) ** 2;
  }
  return varianceLeft && varianceRight
    ? covariance / Math.sqrt(varianceLeft * varianceRight)
    : null;
}

export function affinityOf(scored: readonly ScoredTitle[]): Affinity | null {
  if (scored.length < MIN_AFFINITY_PAIRS) return null;
  const correlation = pearson(scored.map((title) => [title.viewerScore, title.otherScore]));
  if (correlation === null) return null;
  const gaps = scored.map((title) => title.otherScore - title.viewerScore);
  return {
    percent: Math.round(correlation * 100),
    pairs: scored.length,
    exact: gaps.filter((gap) => gap === 0).length,
    meanGap: round(gaps.reduce((sum, gap) => sum + Math.abs(gap), 0) / gaps.length),
    bias: round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
  };
}

function scoredShared(
  viewerSeen: readonly CompareEntry[],
  otherById: ReadonlyMap<number, CompareEntry>
): ScoredTitle[] {
  const scored: ScoredTitle[] = [];
  for (const mine of viewerSeen) {
    const theirs = otherById.get(mine.mediaId);
    if (!theirs || !mine.score || !theirs.score) continue;
    scored.push({
      mediaId: mine.mediaId,
      title: mine.title,
      cover: mine.cover ?? theirs.cover,
      viewerScore: mine.score,
      otherScore: theirs.score,
    });
  }
  return scored;
}

function genreRows(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[]
): GenreRow[] {
  const counts = new Map<string, [number, number]>();
  const tally = (entries: readonly CompareEntry[], side: 0 | 1) => {
    for (const entry of entries)
      for (const genre of new Set(entry.genres)) {
        if (genre === ADULT_GENRE) continue;
        const row = counts.get(genre) ?? [0, 0];
        counts.set(genre, side === 0 ? [row[0] + 1, row[1]] : [row[0], row[1] + 1]);
      }
  };
  tally(viewerSeen, 0);
  tally(otherSeen, 1);
  return [...counts].map(([genre, [mine, theirs]]) => ({
    genre,
    viewerShare: mine / viewerSeen.length,
    otherShare: theirs / otherSeen.length,
  }));
}

export function genreTaste(
  viewerSeen: readonly CompareEntry[],
  otherSeen: readonly CompareEntry[]
): GenreTaste | null {
  if (!viewerSeen.length || !otherSeen.length) return null;
  const all = genreRows(viewerSeen, otherSeen);
  if (!all.length) return null;
  const lower = all.reduce((sum, row) => sum + Math.min(row.viewerShare, row.otherShare), 0);
  const upper = all.reduce((sum, row) => sum + Math.max(row.viewerShare, row.otherShare), 0);
  const notable = all.filter(
    (row) => Math.max(row.viewerShare, row.otherShare) >= MIN_NOTABLE_GENRE_SHARE
  );
  const best = (rank: (row: GenreRow) => number) =>
    notable.reduce<GenreRow | null>(
      (top, row) => (!top || rank(row) > rank(top) ? row : top),
      null
    );
  return {
    rows: [...all]
      .sort(
        (left, right) => right.viewerShare + right.otherShare - left.viewerShare - left.otherShare
      )
      .slice(0, TOP_GENRES),
    overlap: upper ? Math.round((100 * lower) / upper) : 0,
    common: best((row) => Math.min(row.viewerShare, row.otherShare)),
    divide: best((row) => Math.abs(row.viewerShare - row.otherShare)),
  };
}

/** Compares like with like: both start dates when both exist, otherwise both finish dates. */
function comparableDays(mine: CompareEntry, theirs: CompareEntry): [number, number, FirstLead['basis']] | null {
  if (mine.started !== null && theirs.started !== null) return [mine.started, theirs.started, 'started'];
  if (mine.completed !== null && theirs.completed !== null) return [mine.completed, theirs.completed, 'completed'];
  return null;
}

export function firstWatch(
  viewerSeen: readonly CompareEntry[],
  otherById: ReadonlyMap<number, CompareEntry>
): FirstWatch | null {
  let sameDay = 0;
  const leads: FirstLead[] = [];
  const gaps: number[] = [];
  let hiddenViewer = 0;
  let hiddenOther = 0;
  for (const mine of viewerSeen) {
    const theirs = otherById.get(mine.mediaId);
    const days = theirs ? comparableDays(mine, theirs) : null;
    if (!days) continue;
    const lead = days[1] - days[0];
    if (lead === 0) {
      sameDay++;
      continue;
    }
    gaps.push(Math.abs(lead));
    if (mine.adult) {
      if (lead > 0) hiddenViewer++;
      else hiddenOther++;
      continue;
    }
    leads.push({
      mediaId: mine.mediaId,
      title: mine.title,
      cover: mine.cover,
      leader: lead > 0 ? 'viewer' : 'other',
      days: Math.abs(lead),
      viewerDay: days[0],
      otherDay: days[1],
      basis: days[2],
    });
  }
  const side = (leader: CompareSide) => leads.filter((lead) => lead.leader === leader);
  const viewer = side('viewer').length + hiddenViewer;
  const other = side('other').length + hiddenOther;
  if (viewer + other + sameDay < MIN_FIRST_ROWS) return null;
  const top = (leader: CompareSide) =>
    side(leader)
      .sort((left, right) => right.days - left.days || byTitle(left, right))
      .slice(0, TOP_LEADS);
  const sorted = [...gaps].sort((left, right) => left - right);
  return {
    viewer,
    other,
    sameDay,
    medianDays: sorted[Math.floor(sorted.length / 2)] ?? 0,
    viewerLeads: top('viewer'),
    otherLeads: top('other'),
  };
}

/** The recommender's highest scores among titles the reader has not seen; a Planning entry counts as not seen. */
function homeworkFor(
  reader: readonly CompareEntry[],
  recommender: readonly CompareEntry[]
): HomeworkTitle[] {
  const mine = new Map(reader.map((entry) => [entry.mediaId, entry]));
  return seenOf(recommender)
    .filter((entry) => {
      const own = mine.get(entry.mediaId);
      return (
        entry.score >= MIN_HOMEWORK_SCORE &&
        !entry.adult &&
        !entry.unreleased &&
        (!own || own.status === 'PLANNING')
      );
    })
    .sort((left, right) => right.score - left.score || byTitle(left, right))
    .slice(0, TOP_TITLES)
    .map((entry) => ({
      mediaId: entry.mediaId,
      title: entry.title,
      cover: entry.cover,
      score: entry.score,
      onPlanning: mine.has(entry.mediaId),
    }));
}

function verdictOf(shared: number, overlap: number, affinity: Affinity | null): string {
  if (shared === 0) return 'Different worlds';
  if (affinity) {
    if (affinity.percent >= 60) return 'Taste twins';
    if (affinity.percent >= 30) return 'Same wavelength';
    return affinity.percent >= 0 ? 'Friendly rivals' : 'Sworn rivals';
  }
  return overlap >= 30 ? 'Same shelves' : 'Just getting started';
}

export function buildComparison(
  media: CompareMedia,
  viewer: CompareUser,
  other: CompareUser,
  viewerEntries: readonly CompareEntry[],
  otherEntries: readonly CompareEntry[]
): CompareReport {
  const visibleViewer = viewerEntries.filter((entry) => !entry.private);
  const visibleOther = otherEntries.filter((entry) => !entry.private);
  const viewerSeen = seenOf(visibleViewer);
  const otherSeen = seenOf(visibleOther);
  const otherById = new Map(otherSeen.map((entry) => [entry.mediaId, entry]));
  const shared = viewerSeen.filter((entry) => otherById.has(entry.mediaId)).length;
  const union = viewerSeen.length + otherSeen.length - shared;
  const overlap = union ? Math.round((100 * shared) / union) : 0;
  const scored = scoredShared(viewerSeen, otherById);
  const adult = new Set(viewerSeen.filter((entry) => entry.adult).map((entry) => entry.mediaId));
  const nameable = scored.filter((title) => !adult.has(title.mediaId));
  const gap = (title: ScoredTitle) => Math.abs(title.viewerScore - title.otherScore);
  const lowest = (title: ScoredTitle) => Math.min(title.viewerScore, title.otherScore);
  const affinity = affinityOf(scored);
  const shape = (labelOf: Parameters<typeof shareRows>[2], compare?: Parameters<typeof shareRows>[3]) =>
    shareRows(viewerSeen, otherSeen, labelOf, compare).slice(0, TOP_SHAPE_ROWS);
  const byGap = (left: ScoredTitle, right: ScoredTitle) => gap(right) - gap(left) || byTitle(left, right);
  const wide = nameable.filter((title) => gap(title) >= MIN_FIGHT_GAP).sort(byGap);
  return {
    media,
    viewer,
    other,
    tape: tapeRows(media, visibleViewer, visibleOther, viewer.stats, other.stats),
    distribution: scoreDistribution(viewerSeen, otherSeen),
    points: scored,
    fightsViewer: wide.filter((title) => title.viewerScore > title.otherScore).slice(0, TOP_TITLES),
    fightsOther: wide.filter((title) => title.otherScore > title.viewerScore).slice(0, TOP_TITLES),
    bothLow: nameable
      .filter((title) => Math.max(title.viewerScore, title.otherScore) <= MAX_LOW_SCORE)
      .sort((left, right) => left.viewerScore + left.otherScore - right.viewerScore - right.otherScore)
      .slice(0, TOP_TITLES),
    conflicts: statusConflicts(viewerSeen, otherById),
    deepCuts: deepCuts(viewerSeen, otherById),
    genreScores: genreScores(viewerSeen, otherSeen),
    tags: tagRows(viewer.stats, other.stats),
    formats: shape(formatLabel),
    decades: shape(decadeLabel, (left, right) => left.label.localeCompare(right.label)),
    countries: shape(countryLabel),
    people: {
      studios: sharedPeople(viewer.stats.studios, other.stats.studios),
      voiceActors: sharedPeople(viewer.stats.voiceActors, other.stats.voiceActors),
      staff: sharedPeople(viewer.stats.staff, other.stats.staff),
    },
    browser: browserRows(viewerSeen, otherSeen),
    viewerSeen: viewerSeen.length,
    otherSeen: otherSeen.length,
    shared,
    viewerOnly: viewerSeen.length - shared,
    otherOnly: otherSeen.length - shared,
    overlap,
    affinity,
    fights: nameable
      .filter((title) => gap(title) >= MIN_FIGHT_GAP)
      .sort((left, right) => gap(right) - gap(left) || byTitle(left, right))
      .slice(0, TOP_TITLES),
    agreements: nameable
      .filter((title) => lowest(title) >= MIN_AGREEMENT_SCORE)
      .sort(
        (left, right) =>
          lowest(right) - lowest(left) || gap(left) - gap(right) || byTitle(left, right)
      )
      .slice(0, TOP_TITLES),
    genres: genreTaste(viewerSeen, otherSeen),
    first: firstWatch(viewerSeen, otherById),
    homework: {
      // A title the viewer hid is still a title they have seen, so it is never recommended back to them.
      viewer: homeworkFor(viewerEntries, visibleOther),
      other: homeworkFor(visibleOther, visibleViewer),
    },
    verdict: verdictOf(shared, overlap, affinity),
  };
}

/** Circle layout of the overlap poster: areas follow the counts, the lens follows the shared titles. */
export interface VennLayout {
  viewerRadius: number;
  otherRadius: number;
  distance: number;
}

function lensArea(left: number, right: number, distance: number): number {
  if (distance >= left + right) return 0;
  if (distance <= Math.abs(left - right)) return Math.PI * Math.min(left, right) ** 2;
  const a = Math.acos((distance ** 2 + left ** 2 - right ** 2) / (2 * distance * left));
  const b = Math.acos((distance ** 2 + right ** 2 - left ** 2) / (2 * distance * right));
  const kite = Math.sqrt(
    (left + right - distance) *
      (left - right + distance) *
      (right - left + distance) *
      (left + right + distance)
  );
  return left ** 2 * a + right ** 2 * b - 0.5 * kite;
}

export function vennLayout(
  viewerCount: number,
  otherCount: number,
  shared: number,
  maxRadius = 1
): VennLayout {
  const largest = Math.max(viewerCount, otherCount, 1);
  const unit = maxRadius / Math.sqrt(largest / Math.PI);
  const viewerRadius = Math.sqrt(Math.max(viewerCount, 0) / Math.PI) * unit;
  const otherRadius = Math.sqrt(Math.max(otherCount, 0) / Math.PI) * unit;
  const target = shared * unit * unit;
  let low = Math.abs(viewerRadius - otherRadius);
  let high = viewerRadius + otherRadius;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (lensArea(viewerRadius, otherRadius, middle) > target) low = middle;
    else high = middle;
  }
  return { viewerRadius, otherRadius, distance: (low + high) / 2 };
}
