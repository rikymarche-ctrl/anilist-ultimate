/**
 * @file AstraManualScore.ts
 * @description Reads the manual overall score typed into the rating modal.
 *
 * A blank value clears the manual score. Any other value is rounded to one decimal and must
 * fall in [0.1, 11], where 11 is the Astra lode. Browser input that is not a number is invalid.
 */

import { MANUAL_SCORE_MAX, MANUAL_SCORE_MIN } from '../utils/AstraSeasons';

export type ManualScoreInput = { valid: true; value: number | null } | { valid: false };

/**
 * @param raw The text of the overall input.
 * @param badInput True when the browser rejected the typed text (for example letters in a number field).
 */
export function parseManualScoreInput(raw: string, badInput = false): ManualScoreInput {
  if (badInput) return { valid: false };
  const text = raw.trim();
  if (text === '') return { valid: true, value: null };

  const number = Number(text);
  if (!Number.isFinite(number)) return { valid: false };

  const rounded = Math.round(number * 10) / 10;
  if (rounded < MANUAL_SCORE_MIN || rounded > MANUAL_SCORE_MAX) return { valid: false };
  return { valid: true, value: rounded };
}
