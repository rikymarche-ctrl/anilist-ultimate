/**
 * @file IStatsService.ts
 * @description Contract for calculating analytical insights from Astra data.
 */

import type { AstraWorkSummary } from '../AstraInterfaces';
import { IDashboardStats } from './IDashboardState';

/**
 * Service responsible for data aggregation and statistical analysis.
 * Decouples complex math from the UI layer.
 */
export interface IStatsService {
  /**
   * Calculates a full statistical report from a collection of works.
   * 
   * @param works - The collection of works to analyze.
   * @returns A comprehensive stats object.
   */
  calculateStats(works: AstraWorkSummary[]): IDashboardStats;

  /**
   * Calculates the weighted average score for a specific subset.
   * 
   * @param works - The collection to calculate average for.
   */
  calculateAverageScore(works: AstraWorkSummary[]): number;

  /**
   * Generates a distribution map for a specific attribute (e.g., Status, Genre).
   * 
   * @param works - The collection to analyze.
   * @param attribute - The work attribute to group by.
   */
  getDistribution(works: AstraWorkSummary[], attribute: keyof AstraWorkSummary): Record<string, number>;
}
