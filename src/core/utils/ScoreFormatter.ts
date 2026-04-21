/**
 * Score Formatter Utility
 * Handles conversion between numerical scores and AniList's visual scoring formats
 */

import { ScoreFormat } from '@core/types';

export class ScoreFormatter {
  /**
   * Format a numerical score (0-100) into a display string
   */
  public static format(score: number, format: ScoreFormat): string {
    if (!score || score === 0) return '';

    switch (format) {
      case 'POINT_100':
        return score.toString();

      case 'POINT_10_DECIMAL':
        return (score / 10).toFixed(1);

      case 'POINT_10':
        return Math.floor(score / 10).toString();

      case 'POINT_5': {
        const stars = Math.round(score / 20);
        return '★'.repeat(Math.max(1, stars));
      }

      case 'POINT_3': {
        if (score <= 35) return '☹️';
        if (score <= 65) return '😐';
        return '🙂';
      }

      default:
        return score.toString();
    }
  }

  /**
   * Get a CSS class or color for a score
   */
  public static getColor(score: number): string {
    if (score >= 90) return '#2d7a1f'; // Perfect
    if (score >= 80) return '#3fae2a'; // Excellent
    if (score >= 70) return '#4db83a'; // High
    if (score >= 60) return '#66cc33'; // Good
    if (score >= 50) return '#f7bf63'; // Medium
    if (score >= 40) return '#ff6b6b'; // Poor
    if (score >= 30) return '#e85d75'; // Bad
    return '#9370db'; // Terrible
  }

  /**
   * Get semantic label for score
   */
  public static getLabel(score: number): string {
    if (score >= 90) return 'perfect';
    if (score >= 80) return 'excellent';
    if (score >= 70) return 'high';
    if (score >= 60) return 'good';
    if (score >= 50) return 'medium';
    if (score >= 40) return 'poor';
    if (score >= 30) return 'bad';
    return 'terrible';
  }
}
