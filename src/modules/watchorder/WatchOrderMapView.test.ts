// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildGraph, type WatchNode } from './WatchOrderGraph';
import { layoutGraph } from './WatchOrderLayout';
import { buildMapView, wrapTitle } from './WatchOrderMapView';

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

describe('buildMapView', () => {
  const nodes = [
    node(1, 2000, { listStatus: 'COMPLETED' }),
    node(2, 2001, { title: '<img src=x onerror=alert(1)>' }),
    node(3, 2002),
  ];
  const graph = buildGraph(new Map(nodes.map((n) => [n.id, n])), [
    { from: 1, relation: 'SEQUEL', targetId: 2 },
    { from: 1, relation: 'SIDE_STORY', targetId: 3 },
  ]);
  const view = buildMapView(layoutGraph(graph), 2);

  it('renders one link per title, pointing at its AniList page, and marks the current one', () => {
    const links = [...view.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/anime/1', '/anime/2', '/anime/3']);
    expect(view.querySelectorAll('[data-au-current]')).toHaveLength(1);
  });
  it('draws a checkmark only for completed titles and an edge per relation', () => {
    expect(view.querySelectorAll('circle')).toHaveLength(1);
    expect(view.querySelectorAll('path[data-au-edge]')).toHaveLength(2);
    expect(view.querySelectorAll('path[data-au-edge][stroke-dasharray]')).toHaveLength(1);
    expect(view.querySelector('[data-au-kind="SIDE_STORY"]')).not.toBeNull();
  });
  it('never parses AniList titles as markup', () => {
    expect(view.querySelector('img')).toBeNull();
    expect(view.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('map chrome', () => {
  const nodes = [node(1, 2000, { listStatus: 'COMPLETED' }), node(2, 2001), node(3, 2002)];
  const graph = buildGraph(new Map(nodes.map((n) => [n.id, n])), [
    { from: 1, relation: 'SEQUEL', targetId: 2 },
    { from: 2, relation: 'SEQUEL', targetId: 3 },
  ]);
  const view = buildMapView(layoutGraph(graph), 2, { nextId: 3 });

  it('marks the current title by its frame only, without pills', () => {
    expect(view.querySelectorAll('.au-wo-pill')).toHaveLength(0);
    expect(view.querySelector('.au-wo-node.is-current')).not.toBeNull();
  });
  it('offers labelled zoom, fit and full screen controls', () => {
    const labels = [...view.querySelectorAll('.au-wo-controls button')].map((b) =>
      b.getAttribute('aria-label')
    );
    expect(labels).toEqual([
      'Zoom out (−)',
      'Actual size',
      'Zoom in (+)',
      'Show minimap',
      'Fit whole map (0)',
      'Full screen',
    ]);
  });
  it('draws one minimap block per title, without links', () => {
    expect(view.querySelectorAll('.au-wo-mini-node')).toHaveLength(3);
    expect(view.querySelectorAll('.au-wo-minimap a')).toHaveLength(0);
  });
  it('is keyboard focusable', () => {
    expect(view.querySelector<HTMLElement>('.au-wo-map')?.tabIndex).toBe(0);
  });
});

describe('wrapTitle', () => {
  it('keeps short titles on one line', () => {
    expect(wrapTitle('Bakemonogatari', 24, 2)).toEqual(['Bakemonogatari']);
  });
  it('splits two-line titles evenly instead of leaving a lone word', () => {
    expect(wrapTitle('Attack on Titan Season 2 Part 1', 24, 2)).toEqual([
      'Attack on Titan',
      'Season 2 Part 1',
    ]);
  });
  it('ends overflowing titles with an ellipsis within the limit', () => {
    const lines = wrapTitle(
      'A very long franchise title that needs far more than two lines to fit',
      18,
      2
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(lines.every((line) => line.length <= 18)).toBe(true);
  });
});
