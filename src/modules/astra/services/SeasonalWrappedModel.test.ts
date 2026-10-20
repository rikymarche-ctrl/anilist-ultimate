import { describe, expect, it } from 'vitest';
import { MediaListStatus } from '@/api/AnilistTypes';
import { seasonalEntry, seasonalWork } from '@/test/seasonal-wrapped-fixtures';
import { buildSeasonalReport, emptySeasonalChoices, validateSeasonalArchive, seasonBounds, currentSeason,
  type SeasonalChoices, type SeasonalEntry, type SeasonalPeriod } from './SeasonalWrappedModel';
import type { AstraWork } from '../AstraInterfaces';

const spring: SeasonalPeriod = { year: 2026, season: 'SPRING' };
const summer: SeasonalPeriod = { year: 2026, season: 'SUMMER' };
const build = (entries: SeasonalEntry[], choices = emptySeasonalChoices(), works: AstraWork[] = [], period = spring) =>
  buildSeasonalReport(entries, works, period, choices, () => 9, false, new Date('2026-10-19T12:00:00'));

describe('Seasonal Wrapped broadcast and personal eligibility', () => {
  it('moves a two-season title from continuations to the next season as a leftover, without an earlier final score', () => {
    const title = seasonalEntry({ endDate: { year: 2026, month: 9, day: 26 }, completedAt: { year: 2026, month: 9, day: 26 } });
    const previous = build([title]); expect(previous.concluded).toHaveLength(0); expect(previous.ranking).toHaveLength(0);
    expect(previous.continuing[0]).toMatchObject({ currentScore: null, scoreSource: null });
    expect(build([title], undefined, [], summer)).toMatchObject({ completed: 1, leftovers: 1 });
    expect(build([title], undefined, [], summer).ranking[0]).toMatchObject({ leftover: true, currentScore: 8 });
  });
  it('combines new releases and concluded leftovers without double counting', () => {
    const earlier = seasonalEntry({ mediaId: 2, origin: { year: 2026, season: 'WINTER' }, startDate: { year: 2026, month: 1, day: 5 } });
    const report = build([seasonalEntry(), earlier, earlier]);
    expect(report.concluded).toHaveLength(2); expect(report.leftovers).toBe(1); expect(report.average).toBe(8);
    expect(report.genres).toContainEqual({ name: 'Drama', count: 2 });
  });
  it('excludes backlog titles finished in a previous broadcast season', () => {
    expect(build([seasonalEntry()], undefined, [], summer).concluded).toHaveLength(0);
    expect(build([seasonalEntry()], undefined, [], summer).uncertain).toHaveLength(0);
  });
  it('excludes titles first watched after the season even with a manual participation flag', () => {
    const title = seasonalEntry({ startedAt: { year: 2026, month: 7, day: 1 }, completedAt: null });
    const report = build([title], { ...emptySeasonalChoices(), confirmedMediaIds: [1] });
    expect(report.excludedRecoveries).toBe(1); expect(report.ranking).toEqual([]);
  });
  it('requires explicit participation for undated historical titles, and supports reverting that confirmation', () => {
    const title = seasonalEntry({ startedAt: null, completedAt: null });
    expect(build([title]).uncertain[0].reason).toBe('viewing-dates');
    expect(build([title], { ...emptySeasonalChoices(), confirmedMediaIds: [1] }).ranking).toHaveLength(1);
    expect(build([title]).ranking).toHaveLength(0);
  });
  it('accepts dated journal evidence but ignores future dates as proof', () => {
    const title = seasonalEntry({ startedAt: null, completedAt: null });
    const work = seasonalWork({ seasons: [{ scores: {}, episodeNotes: { 1: { text: '', timestamp: new Date('2026-05-01T12:00:00').getTime() } } }] });
    expect(build([title], undefined, [work]).ranking[0].scoreSource).toBe('Astra');
    work.seasons[0].episodeNotes![1].timestamp = new Date('2027-05-01').getTime();
    expect(build([title], undefined, [work]).uncertain[0].reason).toBe('viewing-dates');
  });
  it('does not infer an end season from personal completion, an original season or a year-only release date', () => {
    for (const endDate of [null, { year: 2026, month: null, day: null }]) {
      const report = build([seasonalEntry({ endDate })]);
      expect(report.ranking).toEqual([]); expect(report.uncertain[0].reason).toBe('broadcast-dates');
    }
  });
  it('uses month-precision dates only when their entire month has elapsed', () => {
    const title = seasonalEntry({ endDate: { year: 2026, month: 6, day: null } });
    expect(build([title]).concluded).toHaveLength(1);
    expect(buildSeasonalReport([title], [], spring, emptySeasonalChoices(), () => null, false, new Date('2026-06-10T12:00:00')).ranking).toEqual([]);
  });
  it.each([MediaListStatus.CURRENT, MediaListStatus.PAUSED, MediaListStatus.DROPPED])('keeps personal %s titles out of final rankings', status => {
    const report = build([seasonalEntry({ status })]);
    expect(report.concluded).toHaveLength(1); expect(report.ranking).toEqual([]);
  });
  it('uses Astra first, a labelled AniList fallback, stable ties, and no artificial zero ratings', () => {
    const entries = [seasonalEntry(), seasonalEntry({ mediaId: 2, title: 'Second', score: 9 }), seasonalEntry({ mediaId: 3, score: 0 })];
    const report = build(entries, undefined, [seasonalWork()]);
    expect(report.ranking.map(title => [title.rank, title.scoreSource])).toEqual([[1, 'AniList'], [1, 'Astra']]);
    expect(report.average).toBe(9); expect(report.completed).toBe(3);
  });
  it('filters private and hidden titles consistently from rankings and awards', () => {
    const choices: SeasonalChoices = { ...emptySeasonalChoices(), awards: { favorite: 1 } };
    const title = seasonalEntry({ private: true });
    expect(build([title], choices).awards[0].title).toBeNull();
    expect(buildSeasonalReport([title], [], spring, choices, () => null, true, new Date('2026-10-19')).awards[0].title?.mediaId).toBe(1);
    expect(build([seasonalEntry()], undefined, [seasonalWork({ isHidden: true })]).concluded).toEqual([]);
  });
  it('allows dropped titles only for disappointment; continuing titles win no final awards', () => {
    const choices = { ...emptySeasonalChoices(), awards: { favorite: 1, disappointment: 1 } };
    const report = build([seasonalEntry({ status: MediaListStatus.DROPPED })], choices);
    expect(report.awards[0].title).toBeNull(); expect(report.awards[2].title?.mediaId).toBe(1);
    expect(build([seasonalEntry({ endDate: { year: 2026, month: 9, day: 26 } })], choices).awards.every(award => award.title === null)).toBe(true);
  });
  it('marks a current season provisional and does not treat known future end dates as final', () => {
    const report = buildSeasonalReport([seasonalEntry()], [], spring, emptySeasonalChoices(), () => null, false, new Date('2026-05-01'));
    expect(report.provisional).toBe(true); expect(report.ranking).toHaveLength(0);
    expect(seasonBounds({ year: 2024, season: 'WINTER' })).toEqual({ start: '2024-01-01', end: '2024-03-31' });
    expect(currentSeason(new Date('2026-12-31T12:00:00'))).toEqual({ year: 2026, season: 'FALL' });
  });
  it.each([{ '2026-SPRING': { ...emptySeasonalChoices(), awards: { fake: 1 } } }, { '2026-SPRING': { ...emptySeasonalChoices(), confirmedMediaIds: [1, 1] } },
    { '__proto__': 'bad', bad: emptySeasonalChoices() }, { '2026-SPRING': { ...emptySeasonalChoices(), updatedAt: Infinity } }])('rejects malformed persistent choices', archive => {
    expect(() => validateSeasonalArchive(archive)).toThrow();
  });
});
