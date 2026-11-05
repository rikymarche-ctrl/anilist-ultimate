import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  pearson,
  vennLayout,
  type CompareEntry,
  type CompareUser,
} from './ProfileCompareModel';

const viewer: CompareUser = { id: 1, name: 'Me', avatar: null, stats: { count: 2, minutes: 600, units: 10, volumes: 0, tags: [], studios: [], voiceActors: [], staff: [] } };
const other: CompareUser = { id: 2, name: 'Friend', avatar: null, stats: { count: 2, minutes: 600, units: 10, volumes: 0, tags: [], studios: [], voiceActors: [], staff: [] } };

const entry = (mediaId: number, overrides: Partial<CompareEntry> = {}): CompareEntry => ({
  mediaId,
  title: `Title ${mediaId}`,
  cover: null,
  status: 'COMPLETED',
  score: 0,
  private: false,
  adult: false,
  unreleased: false,
  started: null,
  completed: null,
  genres: [],
  repeat: 0,
  format: null,
  releaseYear: null,
  country: null,
  popularity: 0,
  ...overrides,
});

describe('buildComparison', () => {
  it('counts shared titles and leaves Planning out of them', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1), entry(2), entry(3, { status: 'PLANNING' })],
      [entry(1), entry(3), entry(4)]
    );

    expect(report).toMatchObject({
      viewerSeen: 2,
      otherSeen: 3,
      shared: 1,
      viewerOnly: 1,
      otherOnly: 2,
      overlap: 25,
    });
  });

  it('never lets a private entry count, on either side', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { private: true, score: 9 }), entry(2, { score: 9 })],
      [entry(1, { score: 1 }), entry(2, { score: 2 }), entry(3, { private: true, score: 10 })]
    );

    expect(report.shared).toBe(1);
    expect(report.fights.map((title) => title.mediaId)).toEqual([2]);
    expect(report.homework.viewer.map((title) => title.mediaId)).toEqual([]);
  });

  it('reports a pair with nothing in common without any score slide data', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { score: 9 })],
      [entry(2, { score: 8 })]
    );

    expect(report).toMatchObject({
      shared: 0,
      overlap: 0,
      affinity: null,
      fights: [],
      agreements: [],
      first: null,
    });
    expect(report.verdict).toBe('Different worlds');
    expect(report.homework.viewer.map((title) => title.mediaId)).toEqual([2]);
    expect(report.homework.other.map((title) => title.mediaId)).toEqual([1]);
  });

  it('computes affinity only from titles both scored, once there are enough', () => {
    const scores: Array<[number, number]> = [
      [9, 8],
      [8, 7],
      [7, 6],
      [6, 5],
    ];
    const mine = scores.map(([score], index) => entry(index + 1, { score }));
    const theirs = scores.map(([, score], index) => entry(index + 1, { score }));

    const tooFew = buildComparison('ANIME', viewer,
      other,
      [...mine, entry(9)],
      [...theirs, entry(9, { score: 5 })]
    );
    expect(tooFew.affinity).toBeNull();

    const enough = buildComparison('ANIME', viewer,
      other,
      [...mine, entry(9, { score: 5 })],
      [...theirs, entry(9, { score: 4 })]
    );
    expect(enough.affinity).toEqual({ percent: 100, pairs: 5, exact: 0, meanGap: 1, bias: -1 });
    expect(enough.verdict).toBe('Taste twins');
  });

  it('has no affinity when one side gives every title the same score', () => {
    const mine = [1, 2, 3, 4, 5].map((id) => entry(id, { score: 7 }));
    const theirs = [1, 2, 3, 4, 5].map((id) => entry(id, { score: id }));

    expect(buildComparison('ANIME', viewer, other, mine, theirs).affinity).toBeNull();
  });

  it('ranks disagreements by gap and agreements by the lower score', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [
        entry(1, { score: 10 }),
        entry(2, { score: 9 }),
        entry(3, { score: 8 }),
        entry(4, { score: 8.5 }),
      ],
      [
        entry(1, { score: 2 }),
        entry(2, { score: 9 }),
        entry(3, { score: 4 }),
        entry(4, { score: 8.5 }),
      ]
    );

    expect(report.fights.map((title) => title.mediaId)).toEqual([1, 3]);
    expect(report.agreements.map((title) => title.mediaId)).toEqual([2, 4]);
  });

  it('counts an adult title but never names it', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { adult: true, score: 10, started: 100 }), entry(2, { adult: true })],
      [entry(1, { adult: true, score: 1, started: 50 }), entry(3, { adult: true, score: 10 })]
    );

    expect(report.shared).toBe(1);
    expect(report.fights).toEqual([]);
    expect(report.homework.viewer).toEqual([]);
  });

  it('compares start with start, falls back to finish, and skips incomparable titles', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [
        entry(1, { started: 100, completed: 900 }),
        entry(2, { started: 200 }),
        entry(3, { completed: 300 }),
        entry(4, { started: 400 }),
      ],
      [
        entry(1, { started: 150, completed: 110 }),
        entry(2, { started: 200 }),
        entry(3, { completed: 100 }),
        entry(4, { completed: 400 }),
      ]
    );

    expect(report.first).toMatchObject({ viewer: 1, other: 1, sameDay: 1 });
    expect(report.first!.otherLeads).toEqual([
      expect.objectContaining({ mediaId: 3, days: 200, basis: 'completed', viewerDay: 300, otherDay: 100 }),
    ]);
    expect(report.first!.viewerLeads).toEqual([expect.objectContaining({ mediaId: 1, days: 50, basis: 'started' })]);
  });

  it('hides the first-watcher score with too few comparable dates', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { started: 1 })],
      [entry(1, { started: 2 })]
    );

    expect(report.first).toBeNull();
  });

  it('recommends unseen favourites, flags Planning and skips unreleased or weak titles', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { status: 'PLANNING' }), entry(5)],
      [
        entry(1, { score: 9 }),
        entry(2, { score: 10 }),
        entry(3, { score: 6 }),
        entry(4, { score: 10, unreleased: true }),
        entry(5, { score: 10 }),
      ]
    );

    expect(report.homework.viewer).toEqual([
      expect.objectContaining({ mediaId: 2, onPlanning: false }),
      expect.objectContaining({ mediaId: 1, onPlanning: true }),
    ]);
  });

  it('does not recommend a title the viewer watched privately', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { private: true })],
      [entry(1, { score: 10 })]
    );

    expect(report.homework.viewer).toEqual([]);
  });

  it('picks the genre that unites and the genre that divides', () => {
    const report = buildComparison('ANIME', viewer,
      other,
      [entry(1, { genres: ['Drama', 'Sports'] }), entry(2, { genres: ['Drama', 'Sports'] })],
      [entry(3, { genres: ['Drama'] }), entry(4, { genres: ['Drama'] })]
    );

    expect(report.genres).toMatchObject({ overlap: 50 });
    expect(report.genres!.common!.genre).toBe('Drama');
    expect(report.genres!.divide!.genre).toBe('Sports');
  });

  it('never shows the adult genre on a slide or card', () => {
    const genres = { genres: ['Hentai', 'Drama'] };
    const report = buildComparison('ANIME', viewer, other, [entry(1, genres)], [entry(2, genres)]);

    expect(report.genres!.rows.map((row) => row.genre)).toEqual(['Drama']);
  });

  it('has no genre data when a list is empty', () => {
    expect(buildComparison('ANIME', viewer, other, [], [entry(1, { genres: ['Drama'] })]).genres).toBeNull();
  });
});

describe('pearson', () => {
  it('is 1 for lists in step, -1 for opposite lists and null without variance', () => {
    expect(
      pearson([
        [1, 2],
        [2, 3],
        [3, 4],
      ])
    ).toBeCloseTo(1);
    expect(
      pearson([
        [1, 3],
        [2, 2],
        [3, 1],
      ])
    ).toBeCloseTo(-1);
    expect(
      pearson([
        [5, 1],
        [5, 2],
      ])
    ).toBeNull();
  });
});

describe('vennLayout', () => {
  it('sizes circles by area and separates them with no shared titles', () => {
    const layout = vennLayout(400, 100, 0);

    expect(layout.viewerRadius / layout.otherRadius).toBeCloseTo(2);
    expect(layout.distance).toBeCloseTo(layout.viewerRadius + layout.otherRadius);
  });

  it('nests the smaller circle when all of its titles are shared', () => {
    const layout = vennLayout(400, 100, 100);

    expect(layout.distance).toBeCloseTo(layout.viewerRadius - layout.otherRadius);
  });
});
