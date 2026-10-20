import { describe, it, expect } from 'vitest';
import { AstraCalculator } from './AstraCalculator';
import type { AstraSection, AstraSeason, AstraSettings, AstraWork } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';

const section = (
  id: string,
  weight: number,
  subSections?: { id: string; weight: number }[]
): AstraSection => ({
  id,
  name: id,
  weight,
  subSections: subSections?.map((sub) => ({ ...sub, name: sub.id })),
});

const settings = (over: Partial<AstraSettings> = {}): AstraSettings => ({
  enableSeriesFinale: false,
  finaleWeightMultiplier: 2,
  autoSync: false,
  appendAstraToComment: false,
  ...over,
});

const season = (over: Partial<AstraSeason>): AstraSeason => ({
  id: 's',
  name: 'S1',
  scores: {},
  skip: [],
  episodeNotes: {},
  ...over,
});

const work = (seasons: AstraSeason[]): AstraWork => ({
  id: 'work_1',
  mediaId: 1,
  title: 'Test work',
  type: 'anime',
  status: MediaListStatus.CURRENT,
  customLists: [],
  tags: [],
  notes: '',
  updatedAt: 1,
  seasons,
});

describe('AstraCalculator.calcSectionScore', () => {
  it('returns the direct score when there are no sub-sections', () => {
    expect(AstraCalculator.calcSectionScore(section('A', 1), { A: 8 })).toBe(8);
  });

  it('returns null when a leaf section has no score', () => {
    expect(AstraCalculator.calcSectionScore(section('A', 1), {})).toBeNull();
  });

  it('computes a weighted average across sub-sections', () => {
    const s = section('X', 1, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ]);
    // (4*1 + 8*3) / (1+3) = 28/4 = 7
    expect(AstraCalculator.calcSectionScore(s, { X_a: 4, X_b: 8 })).toBe(7);
  });

  it('ignores sub-sections with no/zero score in the weighted average', () => {
    const s = section('X', 1, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ]);
    expect(AstraCalculator.calcSectionScore(s, { X_a: 6 })).toBe(6);
  });
});

describe('AstraCalculator.calcSeasonOverall', () => {
  const sections = [section('A', 1), section('B', 1)];

  it('returns the weighted average of section scores', () => {
    const result = AstraCalculator.calcSeasonOverall({ A: 8, B: 6 }, sections, settings());
    expect(result).toBe(7);
  });

  it('excludes skipped sections', () => {
    const result = AstraCalculator.calcSeasonOverall({ A: 8, B: 6 }, sections, settings(), ['A']);
    expect(result).toBe(6);
  });

  it('returns null when there are no usable scores', () => {
    expect(AstraCalculator.calcSeasonOverall({}, sections, settings())).toBeNull();
  });

  it('applies the finale weight multiplier when enabled and flagged as series finale', () => {
    const withFinale = [section('A', 1), section('finale', 1)];
    // finale weight doubled: (8*1 + 6*2) / (1+2) = 20/3 = 6.67 -> 6.7
    const result = AstraCalculator.calcSeasonOverall(
      { A: 8, finale: 6 },
      withFinale,
      settings({ enableSeriesFinale: true, finaleWeightMultiplier: 2 }),
      [],
      true
    );
    expect(result).toBe(6.7);
  });

  it('does NOT apply the finale multiplier when the season is not a series finale', () => {
    const withFinale = [section('A', 1), section('finale', 1)];
    // equal weights: (8 + 6) / 2 = 7
    const result = AstraCalculator.calcSeasonOverall(
      { A: 8, finale: 6 },
      withFinale,
      settings({ enableSeriesFinale: true, finaleWeightMultiplier: 2 }),
      [],
      false
    );
    expect(result).toBe(7);
  });
});

describe('AstraCalculator.calcSeriesOverall', () => {
  const sections = [section('A', 1)];

  it('averages the overall score of each season', () => {
    const series = work([season({ scores: { A: 8 } }), season({ scores: { A: 6 } })]);
    // (8 + 6) / 2 = 7
    expect(AstraCalculator.calcSeriesOverall(series, sections, settings())).toBe(7);
  });

  it('returns null when no season has a score', () => {
    const series = work([season({ scores: {} })]);
    expect(AstraCalculator.calcSeriesOverall(series, sections, settings())).toBeNull();
  });

  it('averages the manual overall of a season in place of its weighted score', () => {
    const series = work([
      season({ scores: { A: 8 }, manualScore: 10 }),
      season({ scores: { A: 6 } }),
    ]);
    // (10 + 6) / 2 = 8
    expect(AstraCalculator.calcSeriesOverall(series, sections, settings())).toBe(8);
  });
});

describe('AstraCalculator.calcSeasonScore manual overall', () => {
  const sections = [section('A', 1), section('B', 1)];

  it('returns the manual score over the weighted average', () => {
    const s = season({ scores: { A: 8, B: 6 }, manualScore: 10 });
    expect(AstraCalculator.calcSeasonScore(s, sections, settings())).toBe(10);
  });

  it('returns a low manual score as given', () => {
    const s = season({ scores: { A: 8, B: 6 }, manualScore: 3 });
    expect(AstraCalculator.calcSeasonScore(s, sections, settings())).toBe(3);
  });

  it('accepts 11 (the lode) as a manual score', () => {
    const s = season({ scores: { A: 8 }, manualScore: 11 });
    expect(AstraCalculator.calcSeasonScore(s, sections, settings())).toBe(11);
  });

  it.each([null, undefined])('uses the weighted average when manualScore is %s', (manualScore) => {
    const s = season({ scores: { A: 8, B: 6 }, manualScore });
    expect(AstraCalculator.calcSeasonScore(s, sections, settings())).toBe(7);
  });

  it.each([0, 11.5, -1, Number.NaN])('ignores the invalid manual score %s', (manualScore) => {
    const s = season({ scores: { A: 8, B: 6 }, manualScore });
    expect(AstraCalculator.calcSeasonScore(s, sections, settings())).toBe(7);
  });

  it('returns the manual score alone when no section is configured', () => {
    const s = season({ scores: {}, manualScore: 9 });
    expect(AstraCalculator.calcSeasonScore(s, [], settings())).toBe(9);
  });

  it('returns null with no sections and no manual score', () => {
    expect(AstraCalculator.calcSeasonScore(season({ scores: {} }), [], settings())).toBeNull();
  });
});
