import { describe, expect, it } from 'vitest';
import { MAX_CURATED_BYTES, parseCuratedEntry, parseCuratedOrder } from './CuratedOrderParser';

const SAMPLE = `# Monogatari Watch Order

Also known as: Bakemonogatari, Monster Tale
Source: https://www.animechrono.com/franchise/monogatari
Last updated: 2026-10-28
Last checked against current sources: 2026-10-27
Intro line.

## Recommended first watch

Start with Bakemonogatari (15 episodes, 2009), even though this page opens with the Kizumonogatari films.

## Start here

Start with Part 1 - Iron Blood (Kizumonogatari).

Nothing in this order is marked optional.

## The chronological order

1. Kizumonogatari: Part 1 - Iron Blood (movie)
2. Nekomonogatari: Kuro: Episodes 1-4
3. Bakemonogatari: Episodes 1-15
4. Kabukimonogatari: Mayoi Jiangshi - Part 1-4
5. Owarimonogatari (First Season) – Shinobu Mail: Shinobu Mail - Part 1-6 - Episodes 8-13
6. Zoku Owarimonogatari: Part 1-6
7. Fan Recap Special (optional)
8. MONOGATARI Series: OFF & MONSTER Season (ONA)

## Release order

Sorted by air date.

1. Bakemonogatari: Episodes 1-15 — aired 2009-07-03
2. Nekomonogatari: Kuro: Episodes 1-4 — aired 2012-12-31

## FAQ

1. This numbered line is not part of any order list.
`;

describe('parseCuratedEntry', () => {
  it('reads absolute episode ranges and strips them from the title', () => {
    expect(parseCuratedEntry('3. Bakemonogatari: Episodes 1-15')).toMatchObject({
      position: 3,
      title: 'Bakemonogatari',
      episodes: { from: 1, to: 15 },
      parts: null,
      kind: null,
    });
  });
  it('keeps arc-local part ranges apart from absolute episodes', () => {
    expect(parseCuratedEntry('4. Kabukimonogatari: Mayoi Jiangshi - Part 1-4')).toMatchObject({
      title: 'Kabukimonogatari: Mayoi Jiangshi',
      episodes: null,
      parts: { from: 1, to: 4 },
    });
    expect(
      parseCuratedEntry(
        '5. Owarimonogatari (First Season) – Shinobu Mail: Shinobu Mail - Part 1-6 - Episodes 8-13'
      )
    ).toMatchObject({
      title: 'Owarimonogatari (First Season) – Shinobu Mail: Shinobu Mail',
      episodes: { from: 8, to: 13 },
      parts: { from: 1, to: 6 },
    });
  });
  it('reads kind markers, optional flags and air dates', () => {
    expect(parseCuratedEntry('1. Kizumonogatari: Part 1 - Iron Blood (movie)')).toMatchObject({
      title: 'Kizumonogatari: Part 1 - Iron Blood',
      kind: 'movie',
      episodes: null,
      parts: null,
    });
    expect(parseCuratedEntry('7. Fan Recap Special (optional)')).toMatchObject({
      title: 'Fan Recap Special',
      optional: true,
    });
    expect(parseCuratedEntry('1. Bakemonogatari: Episodes 1-15 — aired 2009-07-03')).toMatchObject({
      airDate: '2009-07-03',
      label: 'Bakemonogatari: Episodes 1-15',
    });
  });
  it('rejects non-entries and nonsense ranges', () => {
    expect(parseCuratedEntry('Not a list line')).toBeNull();
    expect(parseCuratedEntry('1. ')).toBeNull();
    expect(parseCuratedEntry('2. Show: Episodes 9-3')?.episodes).toBeNull();
    expect(parseCuratedEntry('2. Show — aired 2009-99-99x')?.airDate).toBeNull();
  });
});

describe('parseCuratedOrder', () => {
  const order = parseCuratedOrder(SAMPLE);

  it('reads the header block', () => {
    expect(order).toMatchObject({
      title: 'Monogatari',
      aliases: ['Bakemonogatari', 'Monster Tale'],
      sourceUrl: 'https://www.animechrono.com/franchise/monogatari',
      lastUpdated: '2026-10-28',
      lastChecked: '2026-10-27',
      startHere: 'Start with Part 1 - Iron Blood (Kizumonogatari).',
    });
  });
  it('reads both lists and stops each at the next section', () => {
    expect(order?.chronological).toHaveLength(8);
    expect(order?.release.map((e) => e.airDate)).toEqual(['2009-07-03', '2012-12-31']);
  });
  it.each([
    '',
    'just text',
    '# Something Else\n\n## The chronological order\n1. A',
    '# X Watch Order\n\nNo list here',
  ])('returns null for a non-order document %j', (text) => {
    expect(parseCuratedOrder(text)).toBeNull();
  });
  it('refuses oversized input and non-strings', () => {
    expect(parseCuratedOrder('x'.repeat(MAX_CURATED_BYTES + 1))).toBeNull();
    expect(parseCuratedOrder(42 as unknown as string)).toBeNull();
  });
  it('treats markup in titles as plain text', () => {
    const parsed = parseCuratedOrder(
      '# T Watch Order\n\n## The chronological order\n\n1. <img src=x onerror=alert(1)>: Episodes 1-2\n'
    );
    expect(parsed?.chronological[0].title).toBe('<img src=x onerror=alert(1)>');
  });
});
