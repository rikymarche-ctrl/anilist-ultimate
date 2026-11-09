import { describe, expect, it } from 'vitest';
import {
  findThemeValue,
  normalizeThemeTitle,
  parseEpisodeRanges,
  parseThemeSong,
  parseThemeSongs,
  themeSongId,
  themesNewAt,
  type ThemeSong,
} from './MediaThemeSongs';

const never = () => false;

describe('theme song ids', () => {
  it('builds media + kind + sequence + normalised title', () => {
    const song = parseThemeSong(
      '1: "Guren no Yumiya" by Linked Horizon (eps 1-13)',
      'OP',
      0,
      16498
    );
    expect(song).toMatchObject({
      id: '16498:OP:1:guren-no-yumiya',
      sequence: 1,
      title: 'Guren no Yumiya',
      artist: 'Linked Horizon',
    });
  });

  it('keeps the Jikan sequence number, not the list position', () => {
    expect(parseThemeSong('3: "Song" by X', 'ED', 0, 1).id).toBe('1:ED:3:song');
    expect(parseThemeSong('"Song" by X', 'ED', 4, 1).id).toBe('1:ED:5:song');
  });

  it('drops diacritics, bracketed translations and punctuation', () => {
    expect(normalizeThemeTitle('Shinzou wo Sasageyo! (心臓を捧げよ!)')).toBe('shinzou-wo-sasageyo');
    expect(normalizeThemeTitle('Pokémon: Mezase')).toBe('pokemon-mezase');
    expect(themeSongId(1, 'OP', 1, '!!!')).toBe('1:OP:1:untitled');
  });

  it('ignores links in the theme text', () => {
    expect(parseThemeSong('1: "A" by B (eps 1-2) https://x.test/a', 'OP', 0, 1).episodes).toEqual([
      { from: 1, to: 2 },
    ]);
  });

  it('finds a vote after Jikan renumbers the list', () => {
    const song = parseThemeSong('2: "Guren no Yumiya" by Linked Horizon', 'OP', 1, 7);
    expect(findThemeValue({ '7:OP:1:guren-no-yumiya': 8.5 }, song)).toBe(8.5);
    expect(findThemeValue({ '7:ED:1:guren-no-yumiya': 8.5 }, song)).toBeUndefined();
  });

  it('parses both lists in order', () => {
    const songs = parseThemeSongs(
      { openings: ['1: "A" by X'], endings: ['1: "B" by Y', '2: "C" by Z'] },
      9
    );
    expect(songs.map((song) => song.id)).toEqual(['9:OP:1:a', '9:ED:1:b', '9:ED:2:c']);
  });
});

describe('episode ranges', () => {
  it.each([
    ['(eps 14-25)', [{ from: 14, to: 25 }]],
    ['(ep 13)', [{ from: 13, to: 13 }]],
    [
      '(eps 1-12, 14)',
      [
        { from: 1, to: 12 },
        { from: 14, to: 14 },
      ],
    ],
    ['(eps 26-)', [{ from: 26, to: null }]],
    ['(eps 2–5)', [{ from: 2, to: 5 }]],
    ['no range', []],
    ['(eps 0-3)', []],
    ['(eps 9-3)', []],
  ])('%s', (input, expected) => expect(parseEpisodeRanges(`"A" by B ${input}`)).toEqual(expected));
});

describe('themes new at an episode', () => {
  const songs: ThemeSong[] = parseThemeSongs(
    {
      openings: ['1: "First" by A (eps 1-13)', '2: "Second" by A (eps 14-25)'],
      endings: ['1: "Loose" by B'],
    },
    1
  );
  const ids = (list: ThemeSong[]) => list.map((song) => song.title);

  it('shows the OP starting at 14 when progress goes 13 -> 14', () => {
    expect(ids(themesNewAt(songs, 13, 14, never, () => true))).toEqual(['Second']);
  });

  it('shows nothing mid-range', () => {
    expect(themesNewAt(songs, 14, 15, never, () => true)).toEqual([]);
  });

  it('includes every song started across a jump', () => {
    expect(ids(themesNewAt(songs, 0, 20, never, never))).toEqual(['First', 'Second', 'Loose']);
  });

  it('shows unranged songs at episode 1 or once at the first update', () => {
    expect(ids(themesNewAt(songs, 0, 1, never, () => true))).toEqual(['First', 'Loose']);
    expect(ids(themesNewAt(songs, 5, 6, never, never))).toEqual(['Loose']);
    expect(themesNewAt(songs, 5, 6, never, () => true)).toEqual([]);
  });

  it('never shows rated songs', () => {
    expect(themesNewAt(songs, 13, 14, () => true, never)).toEqual([]);
  });

  it('ignores decreases and invalid progress', () => {
    expect(themesNewAt(songs, 14, 13, never, never)).toEqual([]);
    expect(themesNewAt(songs, Number.NaN, 3, never, never)).toEqual([]);
  });
});

describe('series-wide episode numbering', () => {
  const later = [
    parseThemeSong('1: "Shinzou" by LH (eps 26-37)', 'OP', 0, 2),
    parseThemeSong('1: "Yuugure" by Cinema (eps 26-36)', 'ED', 0, 2),
    parseThemeSong('2: "Late" by X (eps 33-37)', 'ED', 1, 2),
  ];

  it('maps "eps 26-37" of a later season onto AniList progress from 1', () => {
    expect(themesNewAt(later, 0, 1, never, never).map((s) => s.title)).toEqual(['Shinzou', 'Yuugure']);
    expect(themesNewAt(later, 7, 8, never, never).map((s) => s.title)).toEqual(['Late']);
    expect(themesNewAt(later, 25, 26, never, never)).toEqual([]);
  });

  it('leaves normal numbering alone, including an opening that starts at episode 2', () => {
    const normal = [
      parseThemeSong('1: "A" by X (eps 2-12)', 'OP', 0, 3),
      parseThemeSong('1: "B" by Y (eps 1-12)', 'ED', 0, 3),
    ];
    expect(themesNewAt(normal, 1, 2, never, never).map((s) => s.title)).toEqual(['A']);
  });
});
