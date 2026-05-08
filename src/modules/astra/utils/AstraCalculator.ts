/**
 * @file AstraCalculator.ts
 * @description Pure utility functions for calculating Astra scores.
 * 
 * Implements the weighted average calculation logic for sections, seasons, and series.
 */

import type { AstraSection, AstraSeason, AstraWork, AstraSettings } from '../AstraInterfaces';

export class AstraCalculator {
  /**
   * Calculate score for a single section (possibly from sub-sections)
   */
  public static calcSectionScore(section: AstraSection, scores: Record<string, number | null>): number | null {
    if (!section.subSections || section.subSections.length === 0) {
      return scores[section.id] || null;
    }

    let num = 0, den = 0;
    for (const sub of section.subSections) {
      const v = scores[`${section.id}_${sub.id}`];
      if (v !== null && v !== undefined && v > 0) {
        num += v * sub.weight;
        den += sub.weight;
      }
    }

    if (den === 0) return null;
    return num / den;
  }

  /**
   * Calculate overall score for a season object
   */
  public static calcSeasonScore(season: AstraSeason, sections: AstraSection[], settings: AstraSettings): number | null {
    return this.calcSeasonOverall(season.scores, sections, settings, season.skip, season.isSeriesFinale, season.legacyScore, season.manualOverride);
  }

  /**
   * Calculate overall score for raw data
   */
  public static calcSeasonOverall(
    scores: Record<string, number | null>,
    sections: AstraSection[],
    settings: AstraSettings,
    skip?: string[],
    isSeriesFinale?: boolean,
    legacyScore?: number,
    manualOverride?: boolean
  ): number | null {
    if (manualOverride && legacyScore !== undefined && legacyScore > 0) {
      return legacyScore;
    }

    const skipSet = new Set(skip || []);
    let num = 0, den = 0;

    for (const s of sections) {
      if (skipSet.has(s.id)) continue;

      const v = this.calcSectionScore(s, scores);
      if (v === null || v === undefined || v === 0) continue;

      let weight = s.weight;
      const isFinale = s.id === 'finale' || s.name.toLowerCase().trim() === 'finale';
      if (isFinale && isSeriesFinale && settings.enableSeriesFinale) {
        weight *= (settings.finaleWeightMultiplier || 2);
      }

      num += v * weight;
      den += weight;
    }

    if (den === 0) return (legacyScore && legacyScore > 0) ? legacyScore : null;
    return Math.round((num / den) * 10) / 10;
  }

  /**
   * Calculate series average score
   */
  public static calcSeriesOverall(work: AstraWork, sections: AstraSection[], settings: AstraSettings): number | null {
    const scores = work.seasons
      .map((s: AstraSeason) => this.calcSeasonOverall(s.scores, sections, settings, s.skip, s.isSeriesFinale, s.legacyScore, s.manualOverride))
      .filter((v: number | null): v is number => v !== null);

    if (!scores.length) return null;
    return Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10;
  }
}
