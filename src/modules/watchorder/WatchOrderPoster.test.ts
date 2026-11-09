// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildGraph, mainStoryIds, parseWatchOrderPage, type WatchNode } from './WatchOrderGraph';
import { CARD_SIZE, POSTER_SIZE, layoutGraph } from './WatchOrderLayout';
import { buildMapView } from './WatchOrderMapView';

const node = (id: number, extra: Partial<WatchNode> = {}): WatchNode => ({
  id,
  title: `Title ${id}`,
  format: 'TV',
  episodes: 12,
  dateKey: 20000000 + id,
  year: 2000,
  listStatus: null,
  progress: 0,
  ...extra,
});

const media = (id: number, coverImage: unknown) => ({
  Page: { media: [{ id, title: { romaji: 'X' }, coverImage }] },
});

describe('cover images', () => {
  it('keeps https AniList image URLs only', () => {
    const [ok] = parseWatchOrderPage(media(1, { large: 'https://s4.anilist.co/file/a.jpg' }));
    expect(ok.node.cover).toBe('https://s4.anilist.co/file/a.jpg');
    for (const large of [
      'http://s4.anilist.co/a.jpg',
      'https://evil.example/a.jpg',
      'https://anilist.co.evil.example/a.jpg',
      'javascript:alert(1)',
      42,
    ]) {
      const [bad] = parseWatchOrderPage(media(2, { large }));
      expect(bad.node.cover).toBeUndefined();
    }
  });
});

describe('mainStoryIds', () => {
  it('lists the titles tied together by sequels, not side stories', () => {
    const graph = buildGraph(new Map([1, 2, 3].map((id) => [id, node(id)])), [
      { from: 1, relation: 'SEQUEL', targetId: 2 },
      { from: 1, relation: 'SIDE_STORY', targetId: 3 },
    ]);
    expect([...mainStoryIds(graph)].sort()).toEqual([1, 2]);
  });
});

describe('poster map', () => {
  const graph = buildGraph(
    new Map([
      [1, node(1, { cover: 'https://s4.anilist.co/a.jpg', listStatus: 'COMPLETED' })],
      [2, node(2, { title: 'A very long franchise title that needs two lines to fit' })],
    ]),
    [{ from: 1, relation: 'SEQUEL', targetId: 2 }]
  );

  it('lays out taller cells for posters than for text cards', () => {
    const card = layoutGraph(graph, undefined, CARD_SIZE);
    const poster = layoutGraph(graph, undefined, POSTER_SIZE);
    expect(poster.size.poster).toBe(true);
    expect(poster.height).toBeGreaterThan(card.height);
  });
  it('draws the cover where there is one and wraps long titles', () => {
    const view = buildMapView(layoutGraph(graph, undefined, POSTER_SIZE), 2);
    const images = [...view.querySelectorAll('image')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('href')).toBe('https://s4.anilist.co/a.jpg');
    const second = view.querySelectorAll('a')[1];
    const lines = [...second.querySelectorAll('text')].map((t) => t.textContent ?? '');
    expect(lines.filter((line) => line.length > 0).length).toBeGreaterThanOrEqual(3); // 2 title lines + meta
    expect(lines.every((line) => line.length <= 20)).toBe(true);
  });
});
