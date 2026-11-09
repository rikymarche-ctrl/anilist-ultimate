import { describe, expect, it, vi } from 'vitest';
import { MSG } from '@shared/messages';
import { buildGraph, type WatchNode } from './WatchOrderGraph';
import {
  dateAgreement,
  findCuratedOrder,
  isPlausibleOrder,
  isRowWatched,
  isValidSlug,
  matchEntries,
  normalizeTitle,
  rankSlugs,
  rankSlugsByTitles,
} from './CuratedOrderMatch';
import { parseCuratedOrder } from './CuratedOrderParser';

const node = (
  id: number,
  title: string,
  dateKey: number,
  extra: Partial<WatchNode> = {}
): WatchNode => ({
  id,
  title,
  format: 'TV',
  episodes: 12,
  dateKey,
  year: Math.floor(dateKey / 10000),
  listStatus: null,
  progress: 0,
  ...extra,
});
const graphOf = (...nodes: WatchNode[]) => buildGraph(new Map(nodes.map((n) => [n.id, n])), []);

const graph = graphOf(
  node(1, 'Bakemonogatari', 20090703, { episodes: 15 }),
  node(2, 'Nisemonogatari', 20120108, { episodes: 11 }),
  node(3, 'Nekomonogatari Black', 20121231, { episodes: 4 }),
  node(4, 'Kizumonogatari Part 1: Tekketsu', 20160108, {
    format: 'MOVIE',
    episodes: 1,
    listStatus: 'COMPLETED',
  })
);

const MD = `# Monogatari Watch Order

Last updated: 2026-10-28

## The chronological order

1. Kizumonogatari: Part 1 - Iron Blood (movie)
2. Nekomonogatari: Kuro: Episodes 1-4
3. Bakemonogatari: Episodes 1-15
4. Nisemonogatari: Episodes 1-11
5. Arc Only: Part 1-4

## Release order

1. Bakemonogatari: Episodes 1-15 — aired 2009-07-03
2. Nisemonogatari: Episodes 1-11 — aired 2012-01-08
3. Nekomonogatari: Kuro: Episodes 1-4 — aired 2012-12-31
4. Kizumonogatari: Part 1 - Iron Blood (movie) — aired 2016-01-08
5. Arc Only: Part 1-4 — aired 2013-08-17
`;

describe('slug helpers', () => {
  it('accepts only lowercase hyphenated slugs', () => {
    expect(isValidSlug('a-certain-magical-index')).toBe(true);
    for (const bad of ['', 'Has Caps', '../etc', 'a/b', 'x_y', 'a--b', 42, null])
      expect(isValidSlug(bad)).toBe(false);
  });
  it('normalises titles for comparison', () => {
    expect(normalizeTitle('Kizumonogatari: Part 1 – Tekketsu!')).toBe(
      'kizumonogatari part 1 tekketsu'
    );
  });
});

describe('rankSlugsByTitles', () => {
  it('finds a franchise named after two series that no single title carries in full', () => {
    const titles = [
      'A Certain Magical Index',
      'A Certain Magical Index II',
      'A Certain Scientific Railgun',
      'A Certain Scientific Railgun T',
      'A Certain Scientific Accelerator',
    ];
    const slugs = ['a-certain-magical-scientific', 'attack-on-titan', 'magical-girl-lyrical'];
    expect(rankSlugsByTitles(slugs, titles)).toEqual(['a-certain-magical-scientific']);
  });
  it('still matches a slug word inside a title word', () => {
    expect(rankSlugsByTitles(['monogatari'], ['Bakemonogatari', 'Nisemonogatari'])).toEqual([
      'monogatari',
    ]);
  });
});

describe('rankSlugs', () => {
  it('prefers the slug covering most franchise titles and drops weak, short or invalid ones', () => {
    const ranked = rankSlugs(
      ['kizumonogatari', 'monogatari', 'bake', 'one-piece', 'Bad Slug', 'monogatari-games'],
      graph
    );
    expect(ranked[0]).toBe('monogatari');
    expect(ranked).not.toContain('one-piece');
    expect(ranked).not.toContain('bake');
    expect(ranked).not.toContain('Bad Slug');
  });
  it('returns nothing for an empty graph', () => {
    expect(rankSlugs(['monogatari'], graphOf())).toEqual([]);
  });
});

describe('date agreement', () => {
  const order = parseCuratedOrder(MD)!;
  it('counts release dates equal to AniList start dates', () => {
    expect(dateAgreement(order, graph)).toEqual({ matched: 4, total: 5 });
    expect(isPlausibleOrder(order, graph)).toBe(true);
  });
  it('rejects an order from an unrelated franchise', () => {
    expect(isPlausibleOrder(order, graphOf(node(9, 'Other Show', 20000101)))).toBe(false);
  });
});

describe('matchEntries', () => {
  const rows = matchEntries(parseCuratedOrder(MD)!, graph);
  const byPosition = (n: number) => rows.find((row) => row.entry.position === n)!;

  it('links rows by air date even when titles differ', () => {
    expect(byPosition(2).node?.id).toBe(3); // "Nekomonogatari: Kuro" ↔ "Nekomonogatari Black"
    expect(byPosition(3).node?.id).toBe(1);
  });
  it('links movies only to movie titles and leaves unmatched arcs unlinked', () => {
    expect(byPosition(1).node?.id).toBe(4);
    expect(byPosition(5).node).toBeNull();
  });
  it('marks a row watched only through its matched AniList title', () => {
    expect(isRowWatched(byPosition(1))).toBe(true);
    expect(isRowWatched(byPosition(3))).toBe(false);
    expect(isRowWatched(byPosition(5))).toBe(false);
  });
});

describe('findCuratedOrder', () => {
  const respond = (slugs: string[], files: Record<string, string>) =>
    vi.fn(async (message: { type: string; slug?: string }) => {
      if (message.type === MSG.WATCH_ORDER_SLUGS) return { success: true, data: slugs };
      const file = files[message.slug ?? ''];
      if (file === undefined) throw new Error('unavailable');
      return { success: true, data: file };
    });

  it('picks the candidate whose dates agree and builds the public URL from the slug', async () => {
    const request = respond(['kizumonogatari', 'monogatari', 'unrelated-show'], {
      monogatari: MD,
      kizumonogatari: '# X Watch Order\n\n## The chronological order\n\n1. A: Episodes 1-2\n',
    });
    const result = await findCuratedOrder(graph, request);
    expect(result?.slug).toBe('monogatari');
    expect(result?.url).toBe('https://www.animechrono.com/franchise/monogatari');
    expect(result?.rows).toHaveLength(5);
  });
  it('skips unavailable candidates and returns null when none fits', async () => {
    expect(await findCuratedOrder(graph, respond(['monogatari'], {}))).toBeNull();
    expect(
      await findCuratedOrder(graph, respond(['monogatari'], { monogatari: 'not markdown' }))
    ).toBeNull();
  });
  it('propagates a failed slug list and stops once the page changed', async () => {
    await expect(
      findCuratedOrder(
        graph,
        vi.fn(async () => ({ success: false }))
      )
    ).rejects.toThrow('Curated order request failed');
    await expect(
      findCuratedOrder(
        graph,
        vi.fn(async () => ({ success: true, data: 'nope' }))
      )
    ).rejects.toThrow('Invalid curated slug list');
    expect(
      await findCuratedOrder(graph, respond(['monogatari'], { monogatari: MD }), () => false)
    ).toBeNull();
  });
});
