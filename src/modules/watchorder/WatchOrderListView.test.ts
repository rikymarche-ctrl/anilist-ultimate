// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildGraph, storyOrder, type WatchNode } from './WatchOrderGraph';
import { buildOrderList } from './WatchOrderListView';
import { titleKinds } from './WatchOrderTheme';

const node = (id: number, year: number, extra: Partial<WatchNode> = {}): WatchNode => ({
  id,
  title: `T${id}`,
  format: 'TV',
  episodes: 12,
  dateKey: year * 10000,
  year,
  listStatus: null,
  progress: 0,
  ...extra,
});

describe('buildOrderList', () => {
  const nodes = [
    node(1, 2000, { listStatus: 'COMPLETED', cover: 'https://s4.anilist.co/a.jpg' }),
    node(2, 2001, { listStatus: 'CURRENT', progress: 6, title: '<b>bold</b>' }),
    node(3, 2002),
    node(4, 2001),
  ];
  const graph = buildGraph(new Map(nodes.map((n) => [n.id, n])), [
    { from: 1, relation: 'SEQUEL', targetId: 2 },
    { from: 2, relation: 'SEQUEL', targetId: 3 },
    { from: 1, relation: 'SPIN_OFF', targetId: 4 },
  ]);
  const list = buildOrderList(storyOrder(graph), {
    currentId: 3,
    nextId: 2,
    estimated: true,
    kinds: titleKinds(graph),
  });
  const rows = [...list.querySelectorAll<HTMLAnchorElement>('.au-wo-row')];

  it('links every title in order and numbers the main line only', () => {
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/anime/1',
      '/anime/4',
      '/anime/2',
      '/anime/3',
    ]);
    // Watched stops show a check instead of their number; branches carry no number.
    expect(rows.map((r) => r.querySelector('.au-wo-marker')?.textContent)).toEqual([
      '',
      '',
      '2',
      '3',
    ]);
  });
  it('shows watched, in progress, next, current and branch states', () => {
    expect(rows[0].classList.contains('is-watched')).toBe(true);
    expect(rows[1].classList.contains('is-branch')).toBe(true);
    expect(rows[1].textContent).toContain('Spin-off');
    expect(rows[2].classList.contains('is-progress')).toBe(true);
    expect(rows[2].textContent).not.toContain('Up next');
    expect(rows[2].classList.contains('is-next')).toBe(true);
    expect(rows[3].getAttribute('aria-current')).toBe('page');
  });
  it('uses AniList covers when present and never parses titles as markup', () => {
    expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('https://s4.anilist.co/a.jpg');
    expect(list.querySelector('b')).toBeNull();
    expect(list.textContent).toContain('<b>bold</b>');
  });
  it('says so when the filters leave nothing', () => {
    const empty = buildOrderList([], {
      currentId: 0,
      nextId: null,
      estimated: false,
      kinds: new Map(),
    });
    expect(empty.textContent).toContain('Nothing left');
  });
});
