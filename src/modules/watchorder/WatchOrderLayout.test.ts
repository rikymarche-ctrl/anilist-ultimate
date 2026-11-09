import { describe, expect, it } from 'vitest';
import { buildGraph, type RawEdge, type WatchNode } from './WatchOrderGraph';
import {
  GAP_X,
  GAP_Y,
  MAP_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutGraph,
  roundedPath,
} from './WatchOrderLayout';

const node = (id: number, year: number): WatchNode => ({
  id,
  title: `T${id}`,
  format: 'TV',
  episodes: 12,
  dateKey: year * 10000,
  year,
  listStatus: null,
  progress: 0,
});
const graphOf = (nodes: WatchNode[], raw: Array<{ from: number } & RawEdge>) =>
  buildGraph(new Map(nodes.map((n) => [n.id, n])), raw);
const at = (layout: ReturnType<typeof layoutGraph>, id: number) =>
  layout.nodes.find((n) => n.node.id === id)!;

describe('layoutGraph', () => {
  const graph = graphOf(
    [node(1, 2000), node(2, 2001), node(3, 2002), node(4, 2001), node(5, 2003)],
    [
      { from: 1, relation: 'SEQUEL', targetId: 2 },
      { from: 2, relation: 'SEQUEL', targetId: 3 },
      { from: 1, relation: 'SIDE_STORY', targetId: 4 },
      { from: 4, relation: 'SIDE_STORY', targetId: 5 },
    ]
  );

  it('places chains left to right using longest paths', () => {
    const layout = layoutGraph(graph);
    expect([1, 2, 3, 4, 5].map((id) => at(layout, id).layer)).toEqual([0, 1, 2, 1, 2]);
    expect(at(layout, 2).x).toBe(MAP_PADDING + (NODE_WIDTH + GAP_X));
  });
  it('never puts two nodes of a column on the same row', () => {
    const layout = layoutGraph(graph);
    const seen = new Set(layout.nodes.map((n) => `${n.layer}:${n.row}`));
    expect(seen.size).toBe(layout.nodes.length);
    expect(at(layout, 4).y).toBe(MAP_PADDING + (NODE_HEIGHT + GAP_Y) * at(layout, 4).row);
  });
  it('tags edges by kind and sizes the canvas to its content', () => {
    const layout = layoutGraph(graph);
    expect(layout.edges.filter((e) => e.kind === 'sequel')).toHaveLength(2);
    expect(layout.edges.filter((e) => e.kind === 'branch').map((e) => e.relation)).toEqual([
      'SIDE_STORY',
      'SIDE_STORY',
    ]);
    expect(layout.width).toBe(MAP_PADDING * 2 + 3 * NODE_WIDTH + 2 * GAP_X);
    expect(layout.height).toBe(MAP_PADDING * 2 + 2 * NODE_HEIGHT + GAP_Y);
    expect(layout.edges.every((e) => e.path.startsWith('M '))).toBe(true);
  });
  it('drops hidden nodes together with their edges', () => {
    const layout = layoutGraph(graph, new Set([1, 2, 3]));
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
  });
  it('draws a single branch edge per node, from its deepest parent, and none beside a sequel', () => {
    const fan = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2002), node(4, 2024)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 3 },
          { from: 1, relation: 'SIDE_STORY', targetId: 4 },
          { from: 2, relation: 'SIDE_STORY', targetId: 4 },
          { from: 3, relation: 'SIDE_STORY', targetId: 4 },
          { from: 1, relation: 'SIDE_STORY', targetId: 2 },
        ]
      )
    );
    expect(fan.edges.filter((e) => e.kind === 'branch').map((e) => `${e.from}>${e.to}`)).toEqual([
      '3>4',
    ]);
    expect(fan.edges.filter((e) => e.kind === 'sequel')).toHaveLength(2);
  });
  it('drops sequel shortcuts implied by a longer path', () => {
    const layout = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2002)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 3 },
          { from: 1, relation: 'SEQUEL', targetId: 3 },
        ]
      )
    );
    expect(layout.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['1>2', '2>3']);
  });
  it('keeps a sequel chain on one horizontal line and stacks side stories below it', () => {
    const layout = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2002), node(4, 2001)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 3 },
          { from: 1, relation: 'SIDE_STORY', targetId: 4 },
        ]
      )
    );
    expect([1, 2, 3].map((id) => at(layout, id).y)).toEqual([
      MAP_PADDING,
      MAP_PADDING,
      MAP_PADDING,
    ]);
    expect(at(layout, 4).y).toBeGreaterThan(at(layout, 2).y);
    expect(at(layout, 4).x).toBe(at(layout, 2).x);
  });
  it('is not derailed by a symmetric ALTERNATIVE pair (reported from both ends)', () => {
    const layout = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2022), node(4, 2005)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 4 },
          { from: 2, relation: 'ALTERNATIVE', targetId: 3 },
          { from: 3, relation: 'ALTERNATIVE', targetId: 2 },
        ]
      )
    );
    expect([1, 2, 4].map((id) => at(layout, id).layer)).toEqual([0, 1, 2]);
    expect(layout.edges.filter((e) => e.kind === 'branch')).toHaveLength(1);
  });
  it('lays out a longer relation loop as a chain instead of collapsing it', () => {
    const layout = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2002)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 3 },
          { from: 3, relation: 'SEQUEL', targetId: 1 },
        ]
      )
    );
    expect([1, 2, 3].map((id) => at(layout, id).layer)).toEqual([0, 1, 2]);
  });
  it('handles an empty graph and survives sequel cycles', () => {
    expect(layoutGraph(graphOf([], []))).toMatchObject({ nodes: [], edges: [] });
    const cyclic = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 2, relation: 'SEQUEL', targetId: 1 },
        ]
      )
    );
    expect(cyclic.nodes).toHaveLength(2);
    expect(cyclic.edges.every((e) => !e.path.includes('NaN'))).toBe(true);
  });
});

describe('edge routing', () => {
  it('rounds the corners of an orthogonal route and keeps straight runs straight', () => {
    expect(
      roundedPath([
        [0, 0],
        [50, 0],
      ])
    ).toBe('M 0 0 L 50 0');
    const bracket = roundedPath(
      [
        [0, 0],
        [20, 0],
        [20, 60],
        [50, 60],
      ],
      10
    );
    expect(bracket).toBe('M 0 0 L 10 0 Q 20 0 20 10 L 20 50 Q 20 60 30 60 L 50 60');
  });
  it('never makes a corner wider than half of the shorter run', () => {
    expect(
      roundedPath(
        [
          [0, 0],
          [20, 0],
          [20, 4],
          [50, 4],
        ],
        10
      )
    ).toContain('Q 20 0 20 2');
  });
  it('routes sibling branches through one shared trunk in the column gap', () => {
    const fan = layoutGraph(
      graphOf(
        [node(1, 2000), node(2, 2001), node(3, 2002), node(4, 2003)],
        [
          { from: 1, relation: 'SEQUEL', targetId: 2 },
          { from: 1, relation: 'SIDE_STORY', targetId: 3 },
          { from: 1, relation: 'SPIN_OFF', targetId: 4 },
        ]
      )
    );
    const trunks = fan.edges.map((e) => /Q (\S+) /.exec(e.path)?.[1] ?? null);
    const bent = trunks.filter((x): x is string => x !== null);
    expect(bent.length).toBe(2); // the sequel runs straight, both branches bend
    expect(new Set(bent).size).toBe(1);
    expect(fan.edges.every((e) => !e.path.includes('NaN'))).toBe(true);
  });
});
