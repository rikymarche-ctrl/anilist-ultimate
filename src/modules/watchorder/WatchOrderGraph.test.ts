import { describe, expect, it, vi } from 'vitest';
import { parse } from 'graphql';
import {
  CRAWL_BATCH_SIZE,
  MAX_FRANCHISE_NODES,
  WATCH_ORDER_QUERY,
  buildGraph,
  crawlFranchise,
  isEntryComplete,
  parseWatchOrderPage,
  describeEpisodes,
  describeProgress,
  formatRuntime,
  franchiseTotals,
  entryMeta,
  releaseOrder,
  storyOrder,
  type ParsedMedia,
  type RawEdge,
  type WatchNode,
} from './WatchOrderGraph';

function node(id: number, year: number | null, extra: Partial<WatchNode> = {}): WatchNode {
  return {
    id,
    title: `T${id}`,
    format: 'TV',
    episodes: 12,
    dateKey: year === null ? Number.MAX_SAFE_INTEGER : year * 10000,
    year,
    listStatus: null,
    progress: 0,
    ...extra,
  };
}
const nodesOf = (...list: WatchNode[]) => new Map(list.map((n) => [n.id, n]));
const ids = (entries: { node: WatchNode }[]) => entries.map((e) => e.node.id);

describe('WATCH_ORDER_QUERY', () => {
  it('is valid GraphQL', () => {
    expect(() => parse(WATCH_ORDER_QUERY)).not.toThrow();
  });
});

describe('parseWatchOrderPage', () => {
  it('also returns related anime that came in full one level down', () => {
    const parsed = parseWatchOrderPage({
      Page: {
        media: [
          {
            id: 1,
            type: 'ANIME',
            title: { romaji: 'One', english: null },
            relations: {
              edges: [
                {
                  relationType: 'SEQUEL',
                  node: {
                    id: 2,
                    type: 'ANIME',
                    title: { romaji: 'Two', english: null },
                    relations: {
                      edges: [{ relationType: 'SEQUEL', node: { id: 3, type: 'ANIME' } }],
                    },
                  },
                },
                {
                  relationType: 'ADAPTATION',
                  node: { id: 9, type: 'MANGA', title: { romaji: 'M' }, relations: { edges: [] } },
                },
              ],
            },
          },
        ],
      },
    });
    expect(parsed.map((media) => media.node.id)).toEqual([1, 2]);
    expect(parsed[1].edges).toEqual([{ relation: 'SEQUEL', targetId: 3 }]);
  });

  const media = (over: Record<string, unknown> = {}) => ({
    id: 1,
    format: 'TV',
    episodes: 12,
    title: { romaji: 'Romaji', english: null },
    startDate: { year: 2009, month: 7, day: 3 },
    mediaListEntry: { status: 'COMPLETED', progress: 15 },
    relations: {
      edges: [
        { relationType: 'SEQUEL', node: { id: 2, type: 'ANIME' } },
        { relationType: 'ADAPTATION', node: { id: 9, type: 'MANGA' } },
        { relationType: 'CHARACTER', node: { id: 10, type: 'ANIME' } },
        { relationType: 'SIDE_STORY', node: { id: 11, type: 'MANGA' } },
      ],
    },
    ...over,
  });

  it('keeps only traversed anime relations and builds a sortable date key', () => {
    const [parsed] = parseWatchOrderPage({ Page: { media: [media()] } });
    expect(parsed.edges).toEqual([{ relation: 'SEQUEL', targetId: 2 }]);
    expect(parsed.node).toMatchObject({
      id: 1,
      title: 'Romaji',
      dateKey: 20090703,
      year: 2009,
      listStatus: 'COMPLETED',
      progress: 15,
    });
  });
  it('prefers the English title and skips malformed entries', () => {
    const result = parseWatchOrderPage({
      Page: { media: [media({ title: { romaji: 'R', english: 'E' } }), { id: 'x' }, null] },
    });
    expect(result).toHaveLength(1);
    expect(result[0].node.title).toBe('E');
  });
  it('sorts undated media last and tolerates missing list entry', () => {
    const [parsed] = parseWatchOrderPage({
      Page: { media: [media({ startDate: { year: null }, mediaListEntry: null })] },
    });
    expect(parsed.node.dateKey).toBe(Number.MAX_SAFE_INTEGER);
    expect(parsed.node.listStatus).toBeNull();
  });
  it.each([null, {}, { Page: {} }, { Page: { media: 'no' } }])(
    'rejects malformed envelope %j',
    (response) => {
      expect(() => parseWatchOrderPage(response)).toThrow('Invalid watch order response');
    }
  );
});

describe('buildGraph', () => {
  it('normalises PREQUEL to a sequel edge and deduplicates mirrored edges', () => {
    const graph = buildGraph(nodesOf(node(1, 2000), node(2, 2001)), [
      { from: 1, relation: 'SEQUEL', targetId: 2 },
      { from: 2, relation: 'PREQUEL', targetId: 1 },
    ]);
    expect(graph.sequels).toEqual([{ from: 1, to: 2 }]);
  });
  it('treats PARENT as the inverse of a branch and drops edges to unknown nodes', () => {
    const graph = buildGraph(nodesOf(node(1, 2000), node(2, 2001)), [
      { from: 2, relation: 'PARENT', targetId: 1 },
      { from: 1, relation: 'SIDE_STORY', targetId: 2 },
      { from: 1, relation: 'SEQUEL', targetId: 99 },
    ]);
    expect(graph.branches).toEqual([{ parent: 1, child: 2, relation: 'SIDE_STORY' }]);
    expect(graph.sequels).toEqual([]);
  });
});

describe('storyOrder / releaseOrder', () => {
  // Monogatari-like: release order differs from story order because 3 is a prequel of 2 but aired later.
  const raw: Array<{ from: number } & RawEdge> = [
    { from: 1, relation: 'SEQUEL', targetId: 2 },
    { from: 2, relation: 'SEQUEL', targetId: 3 },
    { from: 2, relation: 'SIDE_STORY', targetId: 4 },
    { from: 4, relation: 'SIDE_STORY', targetId: 5 },
  ];
  const graph = buildGraph(
    nodesOf(node(3, 2012), node(1, 2016), node(2, 2010), node(4, 2011), node(5, 2013)),
    raw
  );

  it('orders the sequel chain topologically even when release dates disagree', () => {
    const order = storyOrder(graph);
    expect(ids(order).filter((id) => [1, 2, 3].includes(id))).toEqual([1, 2, 3]);
  });
  it('places branches (and branches of branches) right after their mainline ancestor, flagged estimated', () => {
    const order = storyOrder(graph);
    expect(ids(order)).toEqual([1, 2, 4, 5, 3]);
    expect(order.find((e) => e.node.id === 4)).toMatchObject({
      placement: 'estimated',
      relation: 'SIDE_STORY',
    });
    expect(order.find((e) => e.node.id === 1)).toMatchObject({
      placement: 'chain',
      relation: null,
    });
  });
  it('release order sorts strictly by date, undated last', () => {
    const undated = buildGraph(nodesOf(node(1, null), node(2, 2001), node(3, 1999)), []);
    expect(ids(releaseOrder(undated))).toEqual([3, 2, 1]);
  });
  it('falls back to date position for orphan branches and survives cycles', () => {
    const cyclic = buildGraph(nodesOf(node(1, 2000), node(2, 2001)), [
      { from: 1, relation: 'SEQUEL', targetId: 2 },
      { from: 2, relation: 'SEQUEL', targetId: 1 },
    ]);
    expect(ids(storyOrder(cyclic)).sort()).toEqual([1, 2]);
    const orphan = buildGraph(nodesOf(node(1, 2000), node(2, 2005), node(3, 2002), node(4, 2003)), [
      { from: 1, relation: 'SEQUEL', targetId: 2 },
      { from: 3, relation: 'SIDE_STORY', targetId: 4 },
    ]);
    expect(ids(storyOrder(orphan)).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('crawlFranchise', () => {
  const media = (id: number, targets: number[]): ParsedMedia => ({
    node: node(id, 2000 + id),
    edges: targets.map((targetId) => ({ relation: 'SEQUEL' as const, targetId })),
  });

  it('walks one batch per depth level and stops when nothing new is found', async () => {
    const fetchBatch = vi.fn(async (batch: number[]) =>
      batch.map((id) => media(id, id < 3 ? [id + 1] : []))
    );
    const graph = await crawlFranchise(1, fetchBatch);
    expect([...graph.nodes.keys()].sort()).toEqual([1, 2, 3]);
    expect(fetchBatch.mock.calls.map((call) => call[0])).toEqual([[1], [2], [3]]);
  });
  it('caps the franchise size and request batch size', async () => {
    const all = Array.from({ length: 200 }, (_, i) => i + 2);
    const fetchBatch = vi.fn(async (batch: number[]) =>
      batch.map((id) => media(id, id === 1 ? all : []))
    );
    const graph = await crawlFranchise(1, fetchBatch);
    expect(graph.nodes.size).toBeLessThanOrEqual(MAX_FRANCHISE_NODES);
    for (const [batch] of fetchBatch.mock.calls)
      expect(batch.length).toBeLessThanOrEqual(CRAWL_BATCH_SIZE);
  });
  it('stops fetching once cancelled', async () => {
    let cancelled = false;
    const fetchBatch = vi.fn(async (batch: number[]) => {
      cancelled = true;
      return batch.map((id) => media(id, [id + 1]));
    });
    await crawlFranchise(1, fetchBatch, () => cancelled);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });
});

describe('isEntryComplete', () => {
  it('counts COMPLETED and REPEATING only', () => {
    expect(isEntryComplete(node(1, 2000, { listStatus: 'COMPLETED' }))).toBe(true);
    expect(isEntryComplete(node(1, 2000, { listStatus: 'REPEATING' }))).toBe(true);
    expect(isEntryComplete(node(1, 2000, { listStatus: 'CURRENT' }))).toBe(false);
    expect(isEntryComplete(node(1, 2000))).toBe(false);
  });
});

describe('episode descriptions', () => {
  const base = node(1, 2009);
  it('states which episodes an entry covers and omits ranges for movies and unknown counts', () => {
    expect(describeEpisodes({ ...base, episodes: 15 })).toBe('Episodes 1–15');
    expect(describeEpisodes({ ...base, episodes: 1 })).toBe('Episode 1');
    expect(describeEpisodes({ ...base, format: 'MOVIE', episodes: 1 })).toBeNull();
    expect(describeEpisodes({ ...base, episodes: null })).toBeNull();
  });
  it('reports progress only for started, unfinished titles', () => {
    expect(describeProgress({ ...base, listStatus: 'CURRENT', progress: 7, episodes: 15 })).toBe(
      'watched 7/15'
    );
    expect(
      describeProgress({ ...base, listStatus: 'CURRENT', progress: 15, episodes: 15 })
    ).toBeNull();
    expect(
      describeProgress({ ...base, listStatus: 'PLANNING', progress: 0, episodes: 15 })
    ).toBeNull();
    expect(
      describeProgress({ ...base, listStatus: 'COMPLETED', progress: 15, episodes: 15 })
    ).toBeNull();
  });
  it('joins format, episodes, year and optional progress', () => {
    const watching = { ...base, episodes: 15, listStatus: 'CURRENT', progress: 7 };
    expect(entryMeta(watching)).toBe('TV · Episodes 1–15 · 2009');
    expect(entryMeta(watching, true)).toBe('TV · Episodes 1–15 · 2009 · watched 7/15');
  });
});

describe('franchiseTotals', () => {
  it('adds up episodes, movies and runtime, and what is left to watch', () => {
    const totals = franchiseTotals([
      node(1, 2010, { episodes: 12, duration: 24, listStatus: 'COMPLETED', progress: 12 }),
      node(2, 2012, { episodes: 12, duration: 24, listStatus: 'CURRENT', progress: 2 }),
      node(3, 2014, { format: 'MOVIE', episodes: 1, duration: 110 }),
      node(4, 2016, { episodes: null }),
    ]);
    expect(totals).toEqual({
      episodes: 24,
      movies: 1,
      minutes: 12 * 24 * 2 + 110,
      minutesLeft: 10 * 24 + 110,
      unknown: 1,
    });
  });
  it('formats a runtime in days, hours and minutes', () => {
    expect(formatRuntime(45)).toBe('45 min');
    expect(formatRuntime(320)).toBe('5 h 20 min');
    expect(formatRuntime(1440 + 240)).toBe('1 d 4 h');
  });
});

describe('alternative versions', () => {
  it('keeps the TV series as the main title over an earlier PV', () => {
    const pv = node(1, 2024, { format: 'ONA', episodes: 1 });
    const tv = node(2, 2026);
    const edges = [
      { from: 1, targetId: 2, relation: 'ALTERNATIVE' as const },
      { from: 2, targetId: 1, relation: 'ALTERNATIVE' as const },
    ];
    expect(buildGraph(nodesOf(pv, tv), edges).branches).toEqual([
      { parent: 2, child: 1, relation: 'ALTERNATIVE' },
    ]);
  });

  it('picks the earlier one between two series', () => {
    const edges = [{ from: 2, targetId: 1, relation: 'ALTERNATIVE' as const }];
    expect(buildGraph(nodesOf(node(1, 2006), node(2, 2014)), edges).branches).toEqual([
      { parent: 1, child: 2, relation: 'ALTERNATIVE' },
    ]);
  });
});

describe('retelling chains', () => {
  // Attack on Titan as AniList links it: two recap films in a sequel chain of their own,
  // each an alternative version of season 1, plus a prequel OVA.
  const tv = node(16498, 2013);
  const s2 = node(20958, 2017);
  const noRegrets = node(20811, 2014, { format: 'OVA', episodes: 2 });
  const part1 = node(20691, 2014, { format: 'MOVIE', episodes: 1 });
  const part2 = node(20692, 2015, { format: 'MOVIE', episodes: 1 });
  const edges = [
    { from: 16498, targetId: 20958, relation: 'SEQUEL' as const },
    { from: 20811, targetId: 16498, relation: 'SEQUEL' as const },
    { from: 16498, targetId: 20691, relation: 'ALTERNATIVE' as const },
    { from: 16498, targetId: 20692, relation: 'ALTERNATIVE' as const },
    { from: 20691, targetId: 20692, relation: 'SEQUEL' as const },
  ];
  const graph = buildGraph(nodesOf(tv, s2, noRegrets, part1, part2), edges);

  it('places recap films after what they retell, keeping AniList prequels first', () => {
    const order = storyOrder(graph);
    expect(ids(order)).toEqual([20811, 16498, 20691, 20692, 20958]);
    expect(order.filter((e) => e.placement === 'chain').map((e) => e.node.id)).toEqual([
      20811, 16498, 20958,
    ]);
    expect(order.find((e) => e.node.id === 20691)?.relation).toBe('ALTERNATIVE');
  });

  it('lets a specific relation win over PARENT, whichever comes first', () => {
    const recap = node(100465, 2018, { format: 'MOVIE', episodes: 1 });
    const g = buildGraph(nodesOf(s2, recap), [
      { from: 100465, targetId: 20958, relation: 'PARENT' as const },
      { from: 20958, targetId: 100465, relation: 'SUMMARY' as const },
    ]);
    expect(g.branches).toEqual([{ parent: 20958, child: 100465, relation: 'SUMMARY' }]);
  });

  it('keeps a sequel chain on the main line when one of its titles is not a retelling', () => {
    const film = node(30, 2016, { format: 'MOVIE', episodes: 1 });
    const g = buildGraph(nodesOf(tv, part1, film), [
      { from: 16498, targetId: 20691, relation: 'ALTERNATIVE' as const },
      { from: 20691, targetId: 30, relation: 'SEQUEL' as const },
    ]);
    expect(storyOrder(g).filter((e) => e.placement === 'chain').map((e) => e.node.id)).toEqual([
      16498, 20691, 30,
    ]);
  });
});

describe('parallel lines', () => {
  const seq = (from: number, to: number) => ({ from, targetId: to, relation: 'SEQUEL' as const });

  it('runs a started series line to its end instead of interleaving by date', () => {
    const g = buildGraph(nodesOf(node(1, 2010), node(2, 2016), node(3, 2012), node(4, 2014)), [
      seq(1, 2),
      seq(3, 4),
    ]);
    expect(ids(storyOrder(g))).toEqual([1, 2, 3, 4]);
  });

  it('still slots films and specials in by date inside a series line', () => {
    const film = (id: number, year: number) => node(id, year, { format: 'MOVIE', episodes: 1 });
    const g = buildGraph(nodesOf(node(1, 2010), node(2, 2016), film(5, 2012), film(6, 2013)), [
      seq(1, 2),
      seq(5, 6),
    ]);
    expect(ids(storyOrder(g))).toEqual([1, 5, 6, 2]);
  });

  it('never puts specials before the season they belong to', () => {
    const special = (id: number, year: number) => node(id, year, { format: 'SPECIAL', episodes: 1 });
    const g = buildGraph(
      nodesOf(node(1, 2008), node(2, 2018), node(3, 2009), node(4, 2013), special(7, 2010), special(8, 2013)),
      [seq(1, 2), seq(3, 4), seq(7, 8), { from: 8, targetId: 4, relation: 'PARENT' as const }]
    );
    const order = ids(storyOrder(g));
    expect(order.indexOf(8)).toBeGreaterThan(order.indexOf(4));
  });
});
