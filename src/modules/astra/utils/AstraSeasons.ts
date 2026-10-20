import type { AstraSeason } from '../AstraInterfaces';

/** The current season model, shared by storage reads and strict backup validation. */
export const ASTRA_SEASON_FIELDS = [
  'id',
  'name',
  'scores',
  'skip',
  'startDate',
  'endDate',
  'notes',
  'isSeriesFinale',
  'episodeNotes',
  'manualScore',
] as const;

/** Lowest manual overall score; 11 is the Astra lode and the highest accepted value. */
export const MANUAL_SCORE_MIN = 0.1;
export const MANUAL_SCORE_MAX = 11;

/** True when a manual overall score is a finite number in the accepted range. */
export function isManualScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MANUAL_SCORE_MIN &&
    value <= MANUAL_SCORE_MAX
  );
}

export function copyAstraSeason(season: AstraSeason): AstraSeason {
  // Preserve invalid values for validation to reject; never invent or repair scores.
  if (!season || typeof season !== 'object' || Array.isArray(season)) return season;
  return Object.fromEntries(
    ASTRA_SEASON_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(season, key)).map(
      (key) => [key, structuredClone(season[key])]
    )
  ) as unknown as AstraSeason;
}
