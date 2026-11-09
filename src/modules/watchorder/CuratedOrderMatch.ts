/**
 * @file CuratedOrderMatch.ts
 * @description Finds the curated order that belongs to an AniList franchise and links its
 * rows back to AniList titles.
 *
 * The curated Markdown carries no AniList IDs, so a candidate is accepted only when the air
 * dates in its release list line up with the start dates AniList reports for the franchise.
 * Rows link to an AniList title only on an unambiguous date or title match; the rest are shown
 * as published, never guessed.
 */

import { MSG } from '@shared/messages';
import type { FranchiseGraph, WatchNode } from './WatchOrderGraph';
import { parseCuratedOrder, type CuratedEntry, type CuratedOrder } from './CuratedOrderParser';

export const CURATED_ORIGIN = 'https://www.animechrono.com';
const MIN_SLUG_LENGTH = 5;
const MAX_CANDIDATES = 3;
const MIN_DATE_RATIO = 0.25;
const CONFIDENT_DATE_RATIO = 0.5;

export interface CuratedRow {
  entry: CuratedEntry;
  /** AniList title this row was matched to, when the match was unambiguous. */
  node: WatchNode | null;
  airDate: string | null;
}

export interface CuratedResult {
  order: CuratedOrder;
  slug: string;
  /** Public page of the order; built from the slug, never taken from the Markdown. */
  url: string;
  rows: CuratedRow[];
}

export type CuratedRequest = (message: { type: string; slug?: string }) => Promise<unknown>;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Slugs whose words appear in the most AniList titles of the franchise, best first. */
export function rankSlugs(
  slugs: readonly string[],
  graph: FranchiseGraph,
  limit = MAX_CANDIDATES
): string[] {
  return rankSlugsByTitles(
    slugs,
    [...graph.nodes.values()].map((node) => node.title),
    limit
  );
}

/** Same ranking from bare titles (what the worker receives when it opens a capture tab). */
export function rankSlugsByTitles(
  slugs: readonly string[],
  rawTitles: readonly string[],
  limit = MAX_CANDIDATES
): string[] {
  const titles = rawTitles
    .map(normalizeTitle)
    .filter(Boolean)
    .map((title) => new Set(title.split(' ')));
  if (!titles.length) return [];
  // Long slug words also match inside a title word ("monogatari" in "bakemonogatari").
  const has = (title: Set<string>, word: string) =>
    title.has(word) || (word.length >= 4 && [...title].some((part) => part.includes(word)));
  const share = (word: string) => titles.filter((title) => has(title, word)).length / titles.length;
  return slugs
    .filter((slug) => isValidSlug(slug) && slug.replace(/-/g, '').length >= MIN_SLUG_LENGTH)
    .map((slug) => {
      const words = slug.split('-');
      // Franchises are often named after two series at once ("a-certain-magical-scientific" for
      // Index and Railgun): every word has to appear in the franchise, not all in one title.
      const shares = words.map(share);
      const whole = titles.filter((title) => words.every((word) => has(title, word))).length;
      return {
        slug,
        complete: shares.every((value) => value > 0),
        whole: whole / titles.length,
        spread: shares.reduce((sum, value) => sum + value, 0) / words.length,
      };
    })
    .filter((item) => item.complete)
    .sort((a, b) => b.whole - a.whole || b.spread - a.spread || b.slug.length - a.slug.length)
    .slice(0, limit)
    .map((item) => item.slug);
}

function dateKey(airDate: string): number {
  return Number(airDate.replace(/-/g, ''));
}

/** How many release-list air dates equal an AniList start date of the franchise. */
export function dateAgreement(
  order: CuratedOrder,
  graph: FranchiseGraph
): { matched: number; total: number } {
  const known = new Set([...graph.nodes.values()].map((node) => node.dateKey));
  const dated = order.release.filter((entry) => entry.airDate !== null);
  return {
    matched: dated.filter((entry) => known.has(dateKey(entry.airDate as string))).length,
    total: dated.length,
  };
}

export function isPlausibleOrder(order: CuratedOrder, graph: FranchiseGraph): boolean {
  const { matched, total } = dateAgreement(order, graph);
  return total > 0 && matched >= Math.min(2, total) && matched / total >= MIN_DATE_RATIO;
}

function kindCompatible(entry: CuratedEntry, node: WatchNode): boolean {
  if (entry.kind === 'movie') return node.format === 'MOVIE';
  if (node.format === 'MOVIE') return entry.kind === null;
  return true;
}

/** Link every row to an AniList title only when exactly one candidate fits. */
export function matchEntries(order: CuratedOrder, graph: FranchiseGraph): CuratedRow[] {
  const dates = new Map(order.release.map((entry) => [entry.label, entry.airDate]));
  const nodes = [...graph.nodes.values()];
  return order.chronological.map((entry) => {
    const airDate = entry.airDate ?? dates.get(entry.label) ?? null;
    const fits = nodes.filter((node) => kindCompatible(entry, node));
    const byDate = airDate ? fits.filter((node) => node.dateKey === dateKey(airDate)) : [];
    const wanted = normalizeTitle(entry.title);
    const byTitle = fits.filter((node) => normalizeTitle(node.title) === wanted);
    let node: WatchNode | null = null;
    if (byDate.length === 1) node = byDate[0];
    else if (byDate.length > 1)
      node = byDate.find((candidate) => byTitle.includes(candidate)) ?? null;
    else if (byTitle.length === 1) node = byTitle[0];
    return { entry, node, airDate };
  });
}

/** A matched row counts as watched once the viewer completed the AniList title behind it. */
export function isRowWatched(row: CuratedRow): boolean {
  return row.node?.listStatus === 'COMPLETED' || row.node?.listStatus === 'REPEATING';
}

function payload(response: unknown): unknown {
  if (
    response &&
    typeof response === 'object' &&
    'success' in response &&
    response.success === true &&
    'data' in response
  ) {
    return response.data;
  }
  const reason =
    response &&
    typeof response === 'object' &&
    'reason' in response &&
    typeof response.reason === 'string'
      ? `: ${response.reason.slice(0, 80)}`
      : '';
  throw new Error(`Curated order request failed${reason}`);
}

/**
 * Resolve the curated order of a franchise: rank sitemap slugs by title overlap, fetch the best
 * few and keep the one whose air dates agree most with AniList. Returns null when none does.
 */
export async function findCuratedOrder(
  graph: FranchiseGraph,
  request: CuratedRequest,
  isCurrent: () => boolean = () => true,
  trace: (note: string) => void = () => undefined
): Promise<CuratedResult | null> {
  const slugs = payload(await request({ type: MSG.WATCH_ORDER_SLUGS }));
  if (!Array.isArray(slugs)) throw new Error('Invalid curated slug list');
  trace(`${slugs.length} franchises in the sitemap`);
  let best: { slug: string; order: CuratedOrder; score: number } | null = null;
  const candidates = rankSlugs(slugs.filter(isValidSlug), graph);
  if (!candidates.length) trace('no franchise name resembles these titles');
  for (const slug of candidates) {
    if (!isCurrent()) return null;
    let order: CuratedOrder | null;
    try {
      const markdown = payload(await request({ type: MSG.WATCH_ORDER_CURATED, slug }));
      order = typeof markdown === 'string' ? parseCuratedOrder(markdown) : null;
    } catch (error) {
      trace(
        `${slug}: ${error instanceof Error ? error.message.replace('Curated order request failed: ', '') : 'unavailable'}`
      );
      continue; // One unavailable candidate must not hide the others.
    }
    if (!order) {
      trace(`${slug}: not a watch order`);
      continue;
    }
    const { matched, total } = dateAgreement(order, graph);
    trace(`${slug}: dates agree ${matched}/${total}`);
    if (!isPlausibleOrder(order, graph)) continue;
    const score = matched / total;
    if (!best || score > best.score) best = { slug, order, score };
    if (score >= CONFIDENT_DATE_RATIO) break;
  }
  if (!best || !isCurrent()) return null;
  return {
    order: best.order,
    slug: best.slug,
    url: `${CURATED_ORIGIN}/franchise/${best.slug}`,
    rows: matchEntries(best.order, graph),
  };
}
