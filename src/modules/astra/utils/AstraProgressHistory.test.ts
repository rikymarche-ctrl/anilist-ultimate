import { describe, expect, it } from 'vitest';
import { MAX_STAMPED_UNITS, stampAstraProgress } from './AstraProgressHistory';
import type { AstraWork } from '../AstraInterfaces';

const workWithSeason = () => ({ seasons: [{ id: 'season_1', name: 'Season 1', scores: {}, episodeNotes: {} }] }) as unknown as AstraWork;

describe('stampAstraProgress', () => {
  it('stamps every newly watched unit when the jump is within the cap', () => {
    const work = workWithSeason();
    expect(stampAstraProgress(work, 0, 3, 1000)).toBe(true);
    expect(Object.keys(work.seasons[0].episodeNotes ?? {})).toEqual(['1', '2', '3']);
  });

  it('caps a mistyped jump to the most recent units instead of stamping every unit', () => {
    const work = workWithSeason(); const progress = 100_000;
    expect(stampAstraProgress(work, 0, progress, 1000)).toBe(true);
    const notes = work.seasons[0].episodeNotes ?? {};
    expect(MAX_STAMPED_UNITS).toBe(2000);
    expect(Object.keys(notes)).toHaveLength(MAX_STAMPED_UNITS);
    expect(notes[progress - MAX_STAMPED_UNITS + 1]?.timestamp).toBe(1000);
    expect(notes[progress - MAX_STAMPED_UNITS]).toBeUndefined();
  });
});
