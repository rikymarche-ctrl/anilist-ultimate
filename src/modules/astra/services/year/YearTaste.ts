/**
 * @file YearTaste.ts
 * @description Taste figures for Astra Wrapped: genres, tags, formats, eras, popularity and
 * how the user's scores compare with the AniList community.
 */

import type {
  ReviewComparison,
  ReviewMedia,
  ReviewPercentile,
  ReviewTitle,
  YearReviewReport,
} from './YearReviewTypes';

/** AniList tag relevance (0–100) below which a tag says little about the title. */
const MIN_TAG_RANK = 50;
const TOP_TAGS = 20;
/** Score gap (0–100 scale) that counts as a real disagreement with the community. */
const DISAGREEMENT = 10;
const TOP_DISAGREEMENTS = 3;
/** Histograms with fewer votes are too noisy for a percentile claim. */
const MIN_COMMUNITY_VOTES = 50;
/** A percentile claim is only worth making when the user stands apart from most voters. */
const MIN_STANDOUT_SHARE = 0.5;

export type Tally = Array<{ name: string; titles: number }>;

/** Count each name once per title, most frequent first, ties alphabetical. */
export function tally(lists: Iterable<Iterable<string | null>>): Tally {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const name of new Set(list)) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, titles]) => ({ name, titles }))
    .sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

type TasteReport = Pick<
  YearReviewReport,
  | 'genres'
  | 'genreShift'
  | 'tags'
  | 'formats'
  | 'countries'
  | 'sources'
  | 'decades'
  | 'freshShare'
  | 'oldest'
  | 'community'
  | 'popularity'
>;

export function buildTaste(
  titles: ReviewTitle[],
  media: Map<number, ReviewMedia>,
  allTimeGenres: Array<{ name: string; count: number }>,
  years: { first: number; last: number }
): TasteReport {
  const of = (title: ReviewTitle) => media.get(title.mediaId)!;
  return {
    genres: genres(titles, of),
    genreShift: genreShift(titles, of, allTimeGenres),
    tags: tally(
      titles.map((title) =>
        of(title)
          .tags.filter((tag) => tag.rank >= MIN_TAG_RANK)
          .map((tag) => tag.name)
      )
    ).slice(0, TOP_TAGS),
    formats: tally(titles.map((title) => [title.format])),
    countries: tally(titles.map((title) => [of(title).country])),
    sources: tally(titles.map((title) => [of(title).source])),
    ...eras(titles, years),
    community: community(titles, of),
    popularity: popularity(titles),
  };
}

function genres(
  titles: ReviewTitle[],
  of: (title: ReviewTitle) => ReviewMedia
): TasteReport['genres'] {
  const totals = new Map<string, { titles: number; minutes: number }>();
  for (const title of titles) {
    for (const name of new Set(of(title).genres)) {
      const total = totals.get(name) ?? { titles: 0, minutes: 0 };
      total.titles++;
      total.minutes += title.minutes;
      totals.set(name, total);
    }
  }
  return [...totals]
    .map(([name, total]) => ({ name, ...total }))
    .sort((a, b) => b.titles - a.titles || b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/** Anime genre mix this period against the all-time AniList statistics (both as mention shares). */
function genreShift(
  titles: ReviewTitle[],
  of: (title: ReviewTitle) => ReviewMedia,
  allTime: Array<{ name: string; count: number }>
): TasteReport['genreShift'] {
  const now = tally(
    titles.filter((title) => title.type === 'ANIME').map((title) => of(title).genres)
  );
  const nowTotal = now.reduce((sum, genre) => sum + genre.titles, 0);
  const beforeTotal = allTime.reduce((sum, genre) => sum + genre.count, 0);
  if (!nowTotal || !beforeTotal) return [];
  const before = new Map(allTime.map((genre) => [genre.name, genre.count / beforeTotal]));
  const names = new Set([...now.map((genre) => genre.name), ...before.keys()]);
  const current = new Map(now.map((genre) => [genre.name, genre.titles / nowTotal]));
  return [...names]
    .map((name) => ({ name, now: current.get(name) ?? 0, before: before.get(name) ?? 0 }))
    .sort((a, b) => b.now - a.now || b.before - a.before || a.name.localeCompare(b.name));
}

function eras(
  titles: ReviewTitle[],
  years: { first: number; last: number }
): Pick<TasteReport, 'decades' | 'freshShare' | 'oldest'> {
  const dated = titles.filter((title) => title.releaseYear !== null);
  const decades = tally(
    dated.map((title) => [`${Math.floor(title.releaseYear! / 10) * 10}s`])
  ).sort((a, b) => a.name.localeCompare(b.name));
  const fresh = dated.filter(
    (title) => title.releaseYear! >= years.first && title.releaseYear! <= years.last
  );
  const oldest =
    [...dated].sort((a, b) => a.releaseYear! - b.releaseYear! || b.popularity - a.popularity)[0] ??
    null;
  return { decades, freshShare: dated.length ? fresh.length / dated.length : null, oldest };
}

function community(
  titles: ReviewTitle[],
  of: (title: ReviewTitle) => ReviewMedia
): TasteReport['community'] {
  const rated = titles.filter((title) => title.score !== null && title.meanScore !== null);
  const comparisons: ReviewComparison[] = rated.map((title) => ({
    title,
    you: title.score! * 10,
    community: title.meanScore!,
    difference: title.score! * 10 - title.meanScore!,
  }));
  const byGap = (a: ReviewComparison, b: ReviewComparison) =>
    Math.abs(b.difference) - Math.abs(a.difference) || b.title.popularity - a.title.popularity;
  let generous: ReviewPercentile | null = null;
  let tough: ReviewPercentile | null = null;
  for (const title of rated) {
    const histogram = of(title).scoreDistribution;
    const total = histogram.reduce((sum, bucket) => sum + bucket.amount, 0);
    if (total < MIN_COMMUNITY_VOTES) continue;
    const bucket = Math.floor(title.score!) * 10;
    const below =
      histogram.filter((item) => item.score < bucket).reduce((sum, item) => sum + item.amount, 0) /
      total;
    const above =
      histogram.filter((item) => item.score > bucket).reduce((sum, item) => sum + item.amount, 0) /
      total;
    if (below >= MIN_STANDOUT_SHARE && (!generous || below > generous.share))
      generous = { title, share: below };
    if (above >= MIN_STANDOUT_SHARE && (!tough || above > tough.share))
      tough = { title, share: above };
  }
  return {
    rated: rated.length,
    meanDifference: comparisons.length
      ? comparisons.reduce((sum, item) => sum + item.difference, 0) / comparisons.length
      : null,
    warmer: comparisons
      .filter((item) => item.difference >= DISAGREEMENT)
      .sort(byGap)
      .slice(0, TOP_DISAGREEMENTS),
    colder: comparisons
      .filter((item) => item.difference <= -DISAGREEMENT)
      .sort(byGap)
      .slice(0, TOP_DISAGREEMENTS),
    generous,
    tough,
  };
}

function popularity(titles: ReviewTitle[]): TasteReport['popularity'] {
  const known = titles.filter((title) => title.popularity > 0);
  const byPopularity = [...known].sort(
    (a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title)
  );
  const mostPopular = byPopularity[0] ?? null;
  const hiddenGem = byPopularity.length > 1 ? byPopularity[byPopularity.length - 1] : null;
  return { mostPopular, hiddenGem, median: median(known.map((title) => title.popularity)) };
}
