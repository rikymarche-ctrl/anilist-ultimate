/**
 * @file WatchOrderLayout.ts
 * @description Pure layered layout for the relation map. Columns come from the longest path
 * over sequel and branch edges, rows from the barycentre of each node's predecessors, so a
 * franchise reads left to right like a timeline and side stories stack under the series they
 * branch from. Edges are routed orthogonally through the free gaps between columns and rows.
 */

import type { FranchiseGraph, RelationKind, WatchNode } from './WatchOrderGraph';

export const NODE_WIDTH = 244;
export const NODE_HEIGHT = 72;

export interface NodeSize {
  width: number;
  height: number;
  /** Poster cards show the cover art instead of a text card. */
  poster: boolean;
}

export const CARD_SIZE: NodeSize = { width: NODE_WIDTH, height: NODE_HEIGHT, poster: false };
export const POSTER_SIZE: NodeSize = { width: 124, height: 182, poster: true };
/** Column gap: wide enough for the vertical trunk of a fan-out and an arrow head. */
export const GAP_X = 64;
/** Row gap: also the corridor long edges travel along, and room for the status pills. */
export const GAP_Y = 26;
export const MAP_PADDING = 24;
/** Where a fan-out trunk sits inside the column gap (fraction of GAP_X from the source). */
const TRUNK = 0.42;
const CORNER = 10;

export type MapEdgeKind = 'sequel' | 'branch';

export interface MapNode {
  node: WatchNode;
  layer: number;
  row: number;
  x: number;
  y: number;
}

export interface MapEdge {
  from: number;
  to: number;
  kind: MapEdgeKind;
  relation: RelationKind | null;
  /** SVG path from the right side of `from` to the left side of `to`. */
  path: string;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
  size: NodeSize;
}

interface DirectedEdge {
  from: number;
  to: number;
  kind: MapEdgeKind;
  relation: RelationKind | null;
}

const byDate = (a: WatchNode, b: WatchNode): number => a.dateKey - b.dateKey || a.id - b.id;

/** Lay out the franchise, optionally limited to `keep` (hidden nodes drop with their edges). */
export function layoutGraph(
  graph: FranchiseGraph,
  keep?: ReadonlySet<number>,
  size: NodeSize = CARD_SIZE
): MapLayout {
  const nodes = new Map([...graph.nodes].filter(([id]) => !keep || keep.has(id)));
  const allEdges: DirectedEdge[] = [
    ...graph.sequels.map((e) => ({
      from: e.from,
      to: e.to,
      kind: 'sequel' as const,
      relation: null,
    })),
    ...graph.branches.map((e) => ({
      from: e.parent,
      to: e.child,
      kind: 'branch' as const,
      relation: e.relation,
    })),
  ].filter((e) => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to);
  const edges = withoutBackEdges(nodes, allEdges);

  const layers = assignLayers(nodes, edges);
  // Only the edges that are actually drawn steer the row placement: redundant shortcuts
  // and fan-out parents would otherwise pull nodes sideways.
  const drawn = pruneBranchEdges(reduceSequels(edges), layers);
  const rows = assignRows(nodes, drawn, layers);

  const placed: MapNode[] = [...nodes.values()].map((node) => {
    const layer = layers.get(node.id) ?? 0;
    const row = rows.get(node.id) ?? 0;
    return {
      node,
      layer,
      row,
      x: MAP_PADDING + layer * (size.width + GAP_X),
      y: MAP_PADDING + row * (size.height + GAP_Y),
    };
  });
  const position = new Map(placed.map((p) => [p.node.id, p]));
  const mapEdges: MapEdge[] = drawn.map((edge) => {
    const a = position.get(edge.from) as MapNode;
    const b = position.get(edge.to) as MapNode;
    return { ...edge, path: edgePath(a, b, size) };
  });
  const maxLayer = Math.max(-1, ...placed.map((p) => p.layer));
  const maxRow = Math.max(-1, ...placed.map((p) => p.row));
  return {
    nodes: placed,
    edges: mapEdges,
    width: MAP_PADDING * 2 + (maxLayer + 1) * size.width + Math.max(0, maxLayer) * GAP_X,
    height: MAP_PADDING * 2 + (maxRow + 1) * size.height + Math.max(0, maxRow) * GAP_Y,
    size,
  };
}

/**
 * Remove the back edges a depth-first walk finds, so layering is defined even when AniList
 * relations loop. The walk starts from nodes nothing points to, then falls back to date order.
 */
function withoutBackEdges(
  nodes: ReadonlyMap<number, WatchNode>,
  edges: readonly DirectedEdge[]
): DirectedEdge[] {
  const out = new Map<number, DirectedEdge[]>();
  const hasParent = new Set<number>();
  for (const edge of edges) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    hasParent.add(edge.to);
  }
  const starts = [...nodes.values()].sort(
    (a, b) => Number(hasParent.has(a.id)) - Number(hasParent.has(b.id)) || byDate(a, b)
  );
  const state = new Map<number, 1 | 2>();
  const back = new Set<DirectedEdge>();
  for (const start of starts) {
    if (state.has(start.id)) continue;
    state.set(start.id, 1);
    const stack = [{ id: start.id, next: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id) ?? [];
      if (top.next >= list.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const edge = list[top.next++];
      const seen = state.get(edge.to);
      if (seen === 1) back.add(edge);
      else if (seen === undefined) {
        state.set(edge.to, 1);
        stack.push({ id: edge.to, next: 0 });
      }
    }
  }
  return edges.filter((edge) => !back.has(edge));
}

/**
 * Drop sequel edges implied by a longer sequel path (A→C when A→B→C exists). AniList often
 * links a season to every later one; drawing them all crosses the whole map.
 */
function reduceSequels(edges: readonly DirectedEdge[]): DirectedEdge[] {
  const next = new Map<number, number[]>();
  for (const e of edges)
    if (e.kind === 'sequel') next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const reachableWithout = (from: number, to: number): boolean => {
    const seen = new Set<number>();
    const stack = (next.get(from) ?? []).filter((id) => id !== to);
    while (stack.length) {
      const id = stack.pop() as number;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return false;
  };
  return edges.filter((e) => e.kind !== 'sequel' || !reachableWithout(e.from, e.to));
}

/**
 * One drawn branch edge per node, from its nearest parent (deepest layer), and none where a
 * sequel already links the same pair. A side story listed under every part of a series would
 * otherwise draw a fan of overlapping dashes; layout itself still uses every relation.
 */
function pruneBranchEdges(
  edges: readonly DirectedEdge[],
  layers: ReadonlyMap<number, number>
): DirectedEdge[] {
  const sequelPairs = new Set(
    edges
      .filter((e) => e.kind === 'sequel')
      .flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`])
  );
  const best = new Map<number, DirectedEdge>();
  for (const edge of edges) {
    if (edge.kind !== 'branch' || sequelPairs.has(`${edge.from}>${edge.to}`)) continue;
    const current = best.get(edge.to);
    const depth = layers.get(edge.from) ?? 0;
    const currentDepth = current ? (layers.get(current.from) ?? 0) : -1;
    if (!current || depth > currentDepth || (depth === currentDepth && edge.from < current.from))
      best.set(edge.to, edge);
  }
  return [...edges.filter((e) => e.kind === 'sequel'), ...best.values()];
}

/** Orthogonal polyline with rounded corners (points must alternate horizontal/vertical runs). */
export function roundedPath(
  points: ReadonlyArray<readonly [number, number]>,
  radius = CORNER
): string {
  const unique = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]
  );
  // A "corner" between two runs on the same line is no corner at all.
  const pts = unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true;
    const [a, b] = [unique[i - 1], unique[i + 1]];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : 'M 0 0';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

function edgePath(a: MapNode, b: MapNode, size: NodeSize): string {
  const x1 = a.x + size.width;
  const y1 = a.y + size.height / 2;
  const y2 = b.y + size.height / 2;
  if (b.x >= x1) {
    const x2 = b.x;
    const trunk = x1 + GAP_X * TRUNK;
    if (b.layer === a.layer + 1) {
      // Adjacent columns: one vertical trunk per source, so siblings share it like a bracket.
      return roundedPath([
        [x1, y1],
        [trunk, y1],
        [trunk, y2],
        [x2, y2],
      ]);
    }
    // Longer spans travel along the empty corridor between rows, never across a card.
    const corridor = y2 > y1 ? b.y - GAP_Y / 2 : b.y + size.height + GAP_Y / 2;
    const entry = x2 - GAP_X * (1 - TRUNK);
    return roundedPath([
      [x1, y1],
      [trunk, y1],
      [trunk, corridor],
      [entry, corridor],
      [entry, y2],
      [x2, y2],
    ]);
  }
  // Same-column or back edge (cycle leftovers): loop around the right side.
  const x2 = b.x + size.width;
  const bend = Math.max(x1, x2) + GAP_X / 2;
  return `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
}

/** Longest-path layering via Kahn; cycle leftovers are placed after their placed predecessors. */
function assignLayers(
  nodes: ReadonlyMap<number, WatchNode>,
  edges: readonly DirectedEdge[]
): Map<number, number> {
  const indegree = new Map([...nodes.keys()].map((id) => [id, 0]));
  const out = new Map<number, number[]>();
  const preds = new Map<number, number[]>();
  for (const { from, to } of edges) {
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    out.set(from, [...(out.get(from) ?? []), to]);
    preds.set(to, [...(preds.get(to) ?? []), from]);
  }
  const layers = new Map<number, number>();
  const queue = [...nodes.values()].filter((n) => indegree.get(n.id) === 0).sort(byDate);
  for (const n of queue) layers.set(n.id, 0);
  while (queue.length) {
    const current = queue.shift() as WatchNode;
    for (const id of out.get(current.id) ?? []) {
      layers.set(id, Math.max(layers.get(id) ?? 0, (layers.get(current.id) ?? 0) + 1));
      const left = (indegree.get(id) ?? 0) - 1;
      indegree.set(id, left);
      if (left === 0) queue.push(nodes.get(id) as WatchNode);
    }
  }
  for (const node of [...nodes.values()].filter((n) => !layers.has(n.id)).sort(byDate)) {
    const placedPreds = (preds.get(node.id) ?? []).filter((id) => layers.has(id));
    layers.set(
      node.id,
      placedPreds.length ? Math.max(...placedPreds.map((id) => layers.get(id) as number)) + 1 : 0
    );
  }
  return layers;
}

/**
 * Place each node beside the mean row of its parents so chains stay straight, then push down
 * only where two nodes collide. Within a tie the sequel successor keeps the straight line and
 * a side story moves below it.
 */
function assignRows(
  nodes: ReadonlyMap<number, WatchNode>,
  edges: readonly DirectedEdge[],
  layers: ReadonlyMap<number, number>
): Map<number, number> {
  const preds = new Map<number, DirectedEdge[]>();
  for (const edge of edges) preds.set(edge.to, [...(preds.get(edge.to) ?? []), edge]);
  const columns = new Map<number, WatchNode[]>();
  for (const node of nodes.values()) {
    const layer = layers.get(node.id) ?? 0;
    columns.set(layer, [...(columns.get(layer) ?? []), node]);
  }
  const rows = new Map<number, number>();
  for (const layer of [...columns.keys()].sort((a, b) => a - b)) {
    const items = (columns.get(layer) ?? []).map((node) => {
      const incoming = (preds.get(node.id) ?? []).filter((e) => rows.has(e.from));
      const desired = incoming.length
        ? incoming.reduce((sum, e) => sum + (rows.get(e.from) as number), 0) / incoming.length
        : null;
      return { node, desired, sequel: incoming.some((e) => e.kind === 'sequel') };
    });
    const withParents = items
      .filter((item) => item.desired !== null)
      .sort(
        (a, b) =>
          (a.desired as number) - (b.desired as number) ||
          Number(b.sequel) - Number(a.sequel) ||
          byDate(a.node, b.node)
      );
    const roots = items
      .filter((item) => item.desired === null)
      .sort((a, b) => byDate(a.node, b.node));
    let last = -1;
    for (const item of [...withParents, ...roots]) {
      const want = item.desired === null ? last + 1 : Math.round(item.desired);
      last = Math.max(want, last + 1);
      rows.set(item.node.id, last);
    }
  }
  return rows;
}
