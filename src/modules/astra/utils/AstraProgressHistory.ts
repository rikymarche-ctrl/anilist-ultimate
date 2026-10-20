import type { AstraWork } from '../AstraInterfaces';

/** Caps one save's stamps so a mistyped progress cannot create thousands of history entries. */
export const MAX_STAMPED_UNITS = 2000;

/** First local completion date per unit/season; reductions and retries preserve history. */
export function stampAstraProgress(work: AstraWork, previous: number, progress: number, timestamp = Date.now()): boolean {
  const season = work.seasons[work.seasons.length - 1];
  if (!season || !Number.isSafeInteger(previous) || !Number.isSafeInteger(progress)
    || previous < 0 || progress <= previous || progress > 2147483647) return false;
  season.episodeNotes ??= {};
  let changed = false;
  const start = Math.max(previous + 1, progress - MAX_STAMPED_UNITS + 1);
  for (let unit = start; unit <= progress; unit++) {
    const note = season.episodeNotes[unit] ?? { text: '' };
    if (note.timestamp === undefined) {
      season.episodeNotes[unit] = { ...note, timestamp };
      changed = true;
    }
  }
  return changed;
}
