/**
 * @file WatchOrderGraph.ts
 * @description Pure franchise-graph logic for the Watch Order feature: query, response
 * parsing, breadth-first crawl over AniList relations and order derivation.
 *
 * The order produced here is DERIVED from AniList relations and start dates. It is not a
 * verified narrative chronology: sequel chains are reliable, branch entries (side stories,
 * spin-offs, ...) are placed after their parent and flagged as `estimated`.
 */

import { isRecord } from '@/api/GraphQLResponse';

/** Relation kinds that define the franchise. Others (CHARACTER, OTHER, ADAPTATION...) are ignored. */
export type RelationKind =
  | 'PREQUEL'
  | 'SEQUEL'
  | 'SIDE_STORY'
  | 'SPIN_OFF'
  | 'PARENT'
  | 'ALTERNATIVE'
  | 'SUMMARY';

const TRAVERSED_RELATIONS: ReadonlySet<string> = new Set<RelationKind>([
  'PREQUEL',
  'SEQUEL',
  'SIDE_STORY',
  'SPIN_OFF',
  'PARENT',
  'ALTERNATIVE',
  'SUMMARY',
]);

/** Hard limits protecting the shared 30 req/min AniList budget. */
export const MAX_FRANCHISE_NODES = 80;
export const MAX_CRAWL_DEPTH = 8;
export const CRAWL_BATCH_SIZE = 50;
const NO_DATE = Number.MAX_SAFE_INTEGER;

/**
 * Two relation levels per request: each title comes with its related titles in full (and their
 * relation ids). AniList answers a third level with empty relations and no error, which would
 * silently cut the franchise short, so two is the limit.
 */
export const WATCH_ORDER_QUERY = `fragment WatchOrderMedia on Media {
  id
  type
  format
  episodes
  duration
  coverImage { large }
  title { romaji english }
  startDate { year month day }
  mediaListEntry { status progress }
}
query ($ids: [Int]) {
  Page(perPage: ${CRAWL_BATCH_SIZE}) {
    media(id_in: $ids, type: ANIME) {
      ...WatchOrderMedia
      relations {
        edges {
          relationType(version: 2)
          node {
            ...WatchOrderMedia
            relations { edges { relationType(version: 2) node { id type } } }
          }
        }
      }
    }
  }
}`;

export interface WatchNode {
  id: number;
  title: string;
  format: string | null;
  episodes: number | null;
  /** Minutes per episode (the whole film for a movie), when AniList knows it. */
  duration?: number;
  /** Sortable yyyymmdd key; NO_DATE when AniList has no start year. */
  dateKey: number;
  year: number | null;
  listStatus: string | null;
  progress: number;
  /** Poster URL on AniList's own image host, when AniList has one. */
  cover?: string;
}

export interface RawEdge {
  relation: RelationKind;
  targetId: number;
}

export interface ParsedMedia {
  node: WatchNode;
  edges: RawEdge[];
}

export interface FranchiseGraph {
  nodes: ReadonlyMap<number, WatchNode>;
  /** Normalised sequel edges: `from` precedes `to`. */
  sequels: ReadonlyArray<{ from: number; to: number }>;
  /** Normalised branch edges: `child` is a side story / spin-off / ... of `parent`. */
  branches: ReadonlyArray<{ parent: number; child: number; relation: RelationKind }>;
}

export type Placement = 'chain' | 'estimated';

export interface WatchEntry {
  node: WatchNode;
  placement: Placement;
  relation: RelationKind | null;
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Poster URLs are only trusted when they are https on AniList's image hosts. */
function coverUrl(value: unknown): string | null {
  if (!isRecord(value) || typeof value.large !== 'string') return null;
  try {
    const url = new URL(value.large);
    return url.protocol === 'https:' &&
      (url.hostname === 'anilist.co' || url.hostname.endsWith('.anilist.co'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function parseDate(value: unknown): { key: number; year: number | null } {
  if (!isRecord(value) || !isId(value.year)) return { key: NO_DATE, year: null };
  const month = isId(value.month) ? value.month : 0;
  const day = isId(value.day) ? value.day : 0;
  return { key: value.year * 10000 + month * 100 + day, year: value.year };
}

/** Validate one `Page.media` response. Malformed media entries are skipped, a malformed envelope throws. */
export function parseWatchOrderPage(response: unknown): ParsedMedia[] {
  if (!isRecord(response) || !isRecord(response.Page) || !Array.isArray(response.Page.media)) {
    throw new Error('Invalid watch order response');
  }
  const result = new Map<number, ParsedMedia>();
  const add = (media: unknown) => {
    const parsed = parseMedia(media);
    if (parsed && !result.has(parsed.node.id)) result.set(parsed.node.id, parsed);
  };
  // Related titles come in full a few levels down; only those the crawl would follow count.
  const walk = (media: unknown) => {
    add(media);
    const edges = isRecord(media) && isRecord(media.relations) ? media.relations.edges : null;
    for (const edge of Array.isArray(edges) ? edges : []) {
      if (
        isRecord(edge) &&
        isRecord(edge.node) &&
        edge.node.type === 'ANIME' &&
        typeof edge.relationType === 'string' &&
        TRAVERSED_RELATIONS.has(edge.relationType) &&
        isRecord(edge.node.title) &&
        isRecord(edge.node.relations)
      )
        walk(edge.node);
    }
  };
  for (const media of response.Page.media) walk(media);
  return [...result.values()];
}

function parseMedia(media: unknown): ParsedMedia | null {
  if (!isRecord(media) || !isId(media.id) || !isRecord(media.title)) return null;
  const title =
    nullableString(media.title.english) ?? nullableString(media.title.romaji) ?? `#${media.id}`;
  const date = parseDate(media.startDate);
  const cover = coverUrl(media.coverImage);
  const entry = isRecord(media.mediaListEntry) ? media.mediaListEntry : null;
  const edges: RawEdge[] = [];
  const rawEdges =
    isRecord(media.relations) && Array.isArray(media.relations.edges) ? media.relations.edges : [];
  for (const edge of rawEdges) {
    if (
      !isRecord(edge) ||
      !isRecord(edge.node) ||
      !isId(edge.node.id) ||
      edge.node.type !== 'ANIME'
    )
      continue;
    if (typeof edge.relationType !== 'string' || !TRAVERSED_RELATIONS.has(edge.relationType))
      continue;
    edges.push({ relation: edge.relationType as RelationKind, targetId: edge.node.id });
  }
  return {
    node: {
      id: media.id,
      title,
      format: nullableString(media.format),
      episodes: isId(media.episodes) ? media.episodes : null,
      ...(isId(media.duration) ? { duration: media.duration } : {}),
      dateKey: date.key,
      year: date.year,
      listStatus: entry ? nullableString(entry.status) : null,
      progress:
        entry && typeof entry.progress === 'number' && entry.progress >= 0 ? entry.progress : 0,
      ...(cover ? { cover } : {}),
    },
    edges,
  };
}

/**
 * Breadth-first crawl of the franchise around `rootId`. One request per depth level
 * (up to CRAWL_BATCH_SIZE ids each), bounded by MAX_FRANCHISE_NODES / MAX_CRAWL_DEPTH.
 * `isCancelled` lets the caller abort between levels (e.g. after SPA navigation).
 */
export async function crawlFranchise(
  rootId: number,
  fetchBatch: (ids: number[]) => Promise<ParsedMedia[]>,
  isCancelled: () => boolean = () => false
): Promise<FranchiseGraph> {
  const nodes = new Map<number, WatchNode>();
  const rawEdges: Array<{ from: number } & RawEdge> = [];
  const requested = new Set<number>([rootId]);
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_CRAWL_DEPTH && frontier.length && !isCancelled(); depth++) {
    const next: number[] = [];
    for (let i = 0; i < frontier.length; i += CRAWL_BATCH_SIZE) {
      const batch = await fetchBatch(frontier.slice(i, i + CRAWL_BATCH_SIZE));
      if (isCancelled()) break;
      // A batch also carries titles one level further down: know them all before queueing.
      const kept = batch.filter(
        ({ node }) => requested.has(node.id) || nodes.size < MAX_FRANCHISE_NODES
      );
      for (const { node } of kept) {
        nodes.set(node.id, node);
        requested.add(node.id);
      }
      for (const { node, edges } of kept) {
        for (const edge of edges) {
          rawEdges.push({ from: node.id, ...edge });
          if (!requested.has(edge.targetId) && requested.size < MAX_FRANCHISE_NODES) {
            requested.add(edge.targetId);
            next.push(edge.targetId);
          }
        }
      }
    }
    frontier = next;
  }
  return buildGraph(nodes, rawEdges);
}

/** Normalise raw directional edges into deduplicated sequel / branch edges between known nodes. */
export function buildGraph(
  nodes: ReadonlyMap<number, WatchNode>,
  rawEdges: ReadonlyArray<{ from: number } & RawEdge>
): FranchiseGraph {
  const sequels = new Map<string, { from: number; to: number }>();
  const branches = new Map<string, { parent: number; child: number; relation: RelationKind }>();
  const fromParent = new Set<string>();
  for (const { from, targetId, relation } of rawEdges) {
    if (!nodes.has(from) || !nodes.has(targetId) || from === targetId) continue;
    if (relation === 'SEQUEL' || relation === 'PREQUEL') {
      const edge = relation === 'SEQUEL' ? { from, to: targetId } : { from: targetId, to: from };
      sequels.set(`${edge.from}>${edge.to}`, edge);
    } else if (relation === 'PARENT') {
      // PARENT only says "belongs to": a specific relation of the same pair (SUMMARY, ...) wins.
      const key = `${targetId}>${from}`;
      if (!branches.has(key)) {
        branches.set(key, { parent: targetId, child: from, relation: 'SIDE_STORY' });
        fromParent.add(key);
      }
    } else {
      // ALTERNATIVE is reported from both ends. Keep one edge, from the main title (a TV
      // series over a PV or OVA; the earlier one between equals) to the other, so a
      // symmetric pair can never form a two-node cycle.
      const swap =
        relation === 'ALTERNATIVE' &&
        byWeight(nodes.get(targetId) as WatchNode, nodes.get(from) as WatchNode) < 0;
      const [parent, child] = swap ? [targetId, from] : [from, targetId];
      const key = `${parent}>${child}`;
      if (!branches.has(key) || fromParent.delete(key)) branches.set(key, { parent, child, relation });
    }
  }
  return { nodes, sequels: [...sequels.values()], branches: [...branches.values()] };
}

const byDate = (a: WatchNode, b: WatchNode): number => a.dateKey - b.dateKey || a.id - b.id;

/** Lower is more "main": series and films, then OVA/ONA, then specials, PVs and music. */
const FORMAT_RANK: Readonly<Record<string, number>> = {
  TV: 0,
  TV_SHORT: 0,
  MOVIE: 0,
  OVA: 1,
  ONA: 1,
  SPECIAL: 2,
  MUSIC: 2,
};
const formatRank = (node: WatchNode): number => FORMAT_RANK[node.format ?? ''] ?? 1;

/** Which of two alternative versions is the main one: format first, then release date. */
const byWeight = (a: WatchNode, b: WatchNode): number =>
  formatRank(a) - formatRank(b) || byDate(a, b);

/** Release order: strictly by start date (undated entries last). */
export function releaseOrder(graph: FranchiseGraph): WatchEntry[] {
  return [...graph.nodes.values()]
    .sort(byDate)
    .map((node) => ({ node, placement: 'chain' as const, relation: null }));
}

/**
 * Derived story order: mainline entries (those linked by PREQUEL/SEQUEL, or not a branch of
 * anything) in topological sequel order; every branch entry follows its nearest mainline
 * ancestor, sorted by date. Branches with no resolvable ancestor fall back to date position.
 */
export function storyOrder(graph: FranchiseGraph): WatchEntry[] {
  const parentOf = new Map<number, { parent: number; relation: RelationKind }>();
  for (const { parent, child, relation } of graph.branches) {
    if (!parentOf.has(child)) parentOf.set(child, { parent, relation });
  }
  const inSequel = mainSequelNodes(graph, parentOf);
  const isBranch = (id: number): boolean => parentOf.has(id) && !inSequel.has(id);
  const mainline = [...graph.nodes.values()].filter((node) => !isBranch(node.id));

  const ordered = topologicalByDate(mainline, graph.sequels, parentOf);
  const entries: WatchEntry[] = ordered.map((node) => ({
    node,
    placement: 'chain',
    relation: null,
  }));

  const anchored = new Map<number, WatchNode[]>();
  const orphans: WatchNode[] = [];
  const mainlineIds = new Set(mainline.map((node) => node.id));
  for (const node of graph.nodes.values()) {
    if (!isBranch(node.id)) continue;
    const anchor = findAnchor(node.id, parentOf, mainlineIds);
    if (anchor === null) {
      orphans.push(node);
      continue;
    }
    anchored.set(anchor, [...(anchored.get(anchor) ?? []), node]);
  }

  const result: WatchEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    for (const child of (anchored.get(entry.node.id) ?? []).sort(byDate)) {
      result.push({
        node: child,
        placement: 'estimated',
        relation: parentOf.get(child.id)?.relation ?? null,
      });
    }
  }
  for (const node of orphans.sort(byDate)) {
    const entry: WatchEntry = {
      node,
      placement: 'estimated',
      relation: parentOf.get(node.id)?.relation ?? null,
    };
    const index = result.findIndex((other) => other.node.dateKey > node.dateKey);
    result.splice(index === -1 ? result.length : index, 0, entry);
  }
  return result;
}

/** Relations that make a whole sequel chain a retelling of another title, not a story line. */
const RETELLING: ReadonlySet<RelationKind> = new Set(['ALTERNATIVE', 'SUMMARY']);

/**
 * Titles that are mainline because of their sequel links. A sequel chain whose every title is
 * an alternative or summary of a title outside it (recap films such as "Part I" → "Part II")
 * is a retelling: its titles become branches of what they retell instead of a line of their own.
 */
function mainSequelNodes(
  graph: FranchiseGraph,
  parentOf: ReadonlyMap<number, { parent: number; relation: RelationKind }>
): Set<number> {
  const linked = new Map<number, number[]>();
  for (const { from, to } of graph.sequels) {
    linked.set(from, [...(linked.get(from) ?? []), to]);
    linked.set(to, [...(linked.get(to) ?? []), from]);
  }
  const main = new Set<number>();
  const seen = new Set<number>();
  for (const start of linked.keys()) {
    if (seen.has(start)) continue;
    const chain: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop() as number;
      chain.push(id);
      for (const other of linked.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    const members = new Set(chain);
    const retelling = chain.every((id) => {
      const link = parentOf.get(id);
      return !!link && RETELLING.has(link.relation) && !members.has(link.parent);
    });
    if (!retelling) chain.forEach((id) => main.add(id));
  }
  return main;
}

function findAnchor(
  start: number,
  parentOf: ReadonlyMap<number, { parent: number }>,
  mainlineIds: ReadonlySet<number>
): number | null {
  const seen = new Set<number>([start]);
  let current = parentOf.get(start)?.parent;
  while (current !== undefined && !seen.has(current)) {
    if (mainlineIds.has(current)) return current;
    seen.add(current);
    current = parentOf.get(current)?.parent;
  }
  return null;
}

/**
 * Kahn topological sort over sequel edges; ties and cycle leftovers fall back to date order.
 * A sequel chain once started runs to its end before another chain starts (parallel lines,
 * such as two adaptations, are not interleaved by date); titles with no sequel link still
 * slot in by date.
 */
function topologicalByDate(
  nodes: readonly WatchNode[],
  sequels: ReadonlyArray<{ from: number; to: number }>,
  parentOf: ReadonlyMap<number, { parent: number }> = new Map()
): WatchNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map<number, number[]>();
  for (const { from, to } of sequels) {
    if (!byId.has(from) || !byId.has(to)) continue;
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const chainOf = sequelChains(nodes, sequels);
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort(byDate);
  const out: WatchNode[] = [];
  let current: number | undefined;
  const placed = new Set<number>();
  // A title outside a series chain never comes before the title it belongs to (specials of a
  // later season). Sequel links of a series chain are stronger and are not held back.
  const belongsLater = (node: WatchNode): boolean => {
    if (chainOf.has(node.id)) return false;
    const parent = parentOf.get(node.id)?.parent;
    return parent !== undefined && byId.has(parent) && !placed.has(parent);
  };
  while (ready.length) {
    const open = ready.filter((node) => !belongsLater(node));
    const pool = open.length ? open : ready;
    // Within a started chain only its own next title or an unlinked title may come next.
    const continues =
      current !== undefined && pool.some((node) => chainOf.get(node.id) === current);
    const pick = continues
      ? pool.find((node) => {
          const chain = chainOf.get(node.id);
          return chain === current || chain === undefined;
        })
      : pool[0];
    const index = ready.indexOf(pick as WatchNode);
    const node = ready.splice(index, 1)[0];
    current = chainOf.get(node.id) ?? current;
    out.push(node);
    placed.add(node.id);
    for (const id of next.get(node.id) ?? []) {
      const left = (indegree.get(id) ?? 0) - 1;
      indegree.set(id, left);
      if (left === 0) {
        ready.push(byId.get(id) as WatchNode);
        ready.sort(byDate);
      }
    }
  }
  if (out.length < nodes.length) {
    const placed = new Set(out.map((node) => node.id));
    out.push(...nodes.filter((node) => !placed.has(node.id)).sort(byDate));
  }
  return out;
}

/** Formats that make a sequel chain a series line (films, OVAs and specials alone do not). */
const SERIES_FORMATS: ReadonlySet<string> = new Set(['TV', 'TV_SHORT', 'ONA']);

/**
 * Chain id (its first id met) of every title in a sequel chain that contains a series. Titles
 * outside such chains have none: unlinked titles and chains of only films, OVAs or specials
 * (a run of recap films, bonus specials) still slot in by date.
 */
function sequelChains(
  nodes: readonly WatchNode[],
  sequels: ReadonlyArray<{ from: number; to: number }>
): Map<number, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const linked = new Map<number, number[]>();
  for (const { from, to } of sequels) {
    if (!ids.has(from) || !ids.has(to)) continue;
    linked.set(from, [...(linked.get(from) ?? []), to]);
    linked.set(to, [...(linked.get(to) ?? []), from]);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<number>();
  const chainOf = new Map<number, number>();
  for (const start of linked.keys()) {
    if (seen.has(start)) continue;
    const chain = [start];
    seen.add(start);
    for (let i = 0; i < chain.length; i++) {
      for (const other of linked.get(chain[i]) ?? []) {
        if (seen.has(other)) continue;
        seen.add(other);
        chain.push(other);
      }
    }
    if (chain.some((id) => SERIES_FORMATS.has(byId.get(id)?.format ?? '')))
      chain.forEach((id) => chainOf.set(id, start));
  }
  return chainOf;
}

/** An entry counts as done when AniList marks it COMPLETED (or REPEATING). */
export function isEntryComplete(node: WatchNode): boolean {
  return node.listStatus === 'COMPLETED' || node.listStatus === 'REPEATING';
}

/** "Episodes 1–15": which episodes the entry covers. Movies need no range; unknown counts give null. */
export function describeEpisodes(node: WatchNode): string | null {
  if (node.format === 'MOVIE' || !node.episodes) return null;
  return node.episodes === 1 ? 'Episode 1' : `Episodes 1–${node.episodes}`;
}

/** "watched 7/15" for a title the viewer has started but not finished. */
export function describeProgress(node: WatchNode): string | null {
  const started =
    node.listStatus === 'CURRENT' ||
    node.listStatus === 'PAUSED' ||
    node.listStatus === 'DROPPED' ||
    node.listStatus === 'REPEATING';
  if (!started || !node.episodes || node.progress <= 0 || node.progress >= node.episodes)
    return null;
  return `watched ${node.progress}/${node.episodes}`;
}

/** One-line summary shared by the list and the map: format · episodes · year [· progress]. */
export function entryMeta(node: WatchNode, withProgress = false): string {
  return [
    node.format?.replace(/_/g, ' '),
    describeEpisodes(node),
    node.year,
    withProgress ? describeProgress(node) : null,
  ]
    .filter((part): part is string | number => part !== null && part !== undefined && part !== '')
    .join(' · ');
}

/** Titles linked by sequel/prequel relations: the main story line, without side stories. */
export function mainStoryIds(graph: FranchiseGraph): Set<number> {
  const ids = new Set<number>();
  for (const edge of graph.sequels) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return ids;
}

export interface FranchiseTotals {
  /** Episodes of everything that is not a movie. */
  episodes: number;
  movies: number;
  /** Runtime in minutes of the titles whose length is known (openings and endings included). */
  minutes: number;
  /** Runtime still to watch, from the viewer's progress. */
  minutesLeft: number;
  /** Titles whose length AniList does not know, so `minutes` is a lower bound. */
  unknown: number;
}

export function franchiseTotals(nodes: readonly WatchNode[]): FranchiseTotals {
  const totals: FranchiseTotals = {
    episodes: 0,
    movies: 0,
    minutes: 0,
    minutesLeft: 0,
    unknown: 0,
  };
  for (const node of nodes) {
    const isMovie = node.format === 'MOVIE';
    const count = isMovie ? 1 : node.episodes;
    if (isMovie) totals.movies++;
    else totals.episodes += node.episodes ?? 0;
    if (!count || !node.duration) {
      totals.unknown++;
      continue;
    }
    totals.minutes += count * node.duration;
    const seen = isEntryComplete(node) ? count : Math.min(node.progress, count);
    totals.minutesLeft += (count - seen) * node.duration;
  }
  return totals;
}

/** "1 d 4 h", "5 h 20 min", "45 min". */
export function formatRuntime(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${rest} min`;
}
