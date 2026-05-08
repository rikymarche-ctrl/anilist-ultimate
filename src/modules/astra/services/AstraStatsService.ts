/**
 * @file AstraStatsService.ts
 * @description Implementation of the analytical engine for calculating Astra statistics.
 */

import { injectable } from 'tsyringe';
import type { AstraWorkSummary } from '../AstraInterfaces';
import { IStatsService } from '../interfaces/IStatsService';
import { IDashboardStats } from '../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

/**
 * Enterprise implementation of the Astra statistics engine.
 */
@injectable()
export class AstraStatsService implements IStatsService {
  /**
   * Generates a full statistical report.
   */
  public calculateStats(works: AstraWorkSummary[]): IDashboardStats {
    return {
      totalCount: works.length,
      averageScore: this.calculateAverageScore(works),
      completedCount: works.filter(w => w.status === MediaListStatus.COMPLETED).length,
      droppedCount: works.filter(w => w.status === MediaListStatus.DROPPED).length,
      planningCount: works.filter(w => w.status === MediaListStatus.PLANNING).length,
      genreDistribution: this.getDistribution(works, 'genres'),
      statusDistribution: this.getDistribution(works, 'status')
    };
  }

  /**
   * Calculates weighted average score across all works.
   */
  public calculateAverageScore(works: AstraWorkSummary[]): number {
    const scores = works
      .map(w => w.currentScore)
      .filter((s): s is number => s !== null && s > 0);

    if (scores.length === 0) return 0;
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round((sum / scores.length) * 100) / 100;
  }

  /**
   * Calculates frequency distribution.
   */
  public getDistribution(works: AstraWorkSummary[], attribute: keyof AstraWorkSummary): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const work of works) {
      const value = work[attribute];
      if (!value) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' || typeof item === 'number') {
            distribution[item] = (distribution[item] || 0) + 1;
          }
        }
      } else if (typeof value === 'string' || typeof value === 'number') {
        const key = String(value);
        distribution[key] = (distribution[key] || 0) + 1;
      }
    }

    return distribution;
  }
}
