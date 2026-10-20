import type { AstraSeason } from '../AstraInterfaces';

/** The current season model, shared by storage reads and strict backup validation. */
export const ASTRA_SEASON_FIELDS = ['id', 'name', 'scores', 'skip', 'startDate', 'endDate', 'notes', 'isSeriesFinale', 'episodeNotes'] as const;

export function copyAstraSeason(season: AstraSeason): AstraSeason {
  // Preserve invalid values for validation to reject; never invent or repair scores.
  if (!season || typeof season !== 'object' || Array.isArray(season)) return season;
  return Object.fromEntries(ASTRA_SEASON_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(season, key))
    .map(key => [key, structuredClone(season[key])])) as unknown as AstraSeason;
}
