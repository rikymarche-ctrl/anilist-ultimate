import { describe, it, expect } from 'vitest';
import { AstraCalculator } from './AstraCalculator';
import type { AstraSection, AstraSeason, AstraSettings } from '../AstraInterfaces';

const section = (
  id: string,
  weight: number,
  subSections?: { id: string; weight: number }[]
): AstraSection => ({ id, name: id, weight, subSections }) as any;

const settings = (over: Partial<AstraSettings> = {}): AstraSettings =>
  ({ enableSeriesFinale: false, finaleWeightMultiplier: 2, ...over }) as any;

const season = (over: Partial<AstraSeason>): AstraSeason =>
  ({ id: 's', label: 'S1', scores: {}, skip: [], episodeNotes: {}, ...over }) as any;

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

  it('returns legacyScore when manualOverride is set', () => {
    const result = AstraCalculator.calcSeasonOverall(
      { A: 1 },
      sections,
      settings(),
      [],
      false,
      9.5,
      true
    );
    expect(result).toBe(9.5);
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
    const work: any = {
      seasons: [season({ scores: { A: 8 } }), season({ scores: { A: 6 } })],
    };
    // (8 + 6) / 2 = 7
    expect(AstraCalculator.calcSeriesOverall(work, sections, settings())).toBe(7);
  });

  it('returns null when no season has a score', () => {
    const work: any = { seasons: [season({ scores: {} })] };
    expect(AstraCalculator.calcSeriesOverall(work, sections, settings())).toBeNull();
  });
});
