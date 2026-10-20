import type { AniListDate, MediaListStatus, MediaStatus } from '@/api/AnilistTypes';
import type { AstraWork } from '../AstraInterfaces';
import { localDateKey } from './AstraWrapped';
import { isRecord } from '@/api/GraphQLResponse';

export const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;
export type BroadcastSeason = typeof SEASONS[number];
export interface SeasonalPeriod { year: number; season: BroadcastSeason }
export const SEASONAL_AWARDS = [
  { id: 'favorite', label: 'Anime of the season' }, { id: 'surprise', label: 'Biggest surprise' },
  { id: 'disappointment', label: 'Biggest disappointment' }, { id: 'discovery', label: 'Personal discovery' },
] as const;
export type SeasonalAward = typeof SEASONAL_AWARDS[number]['id'];
export interface SeasonalChoices {
  updatedAt: number;
  awards: Partial<Record<SeasonalAward, number>>;
  confirmedMediaIds: number[];
  /** Present once the newest post-season release was shown to the user. */
  releaseSeenAt?: number;
}
export type SeasonalArchive = Record<string, SeasonalChoices>;
export const emptySeasonalChoices = (): SeasonalChoices => ({ updatedAt: 0, awards: {}, confirmedMediaIds: [] });
export const seasonKey = (period: SeasonalPeriod): string => `${period.year}-${period.season}`;
export function validateSeasonKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !/^(19|20|21)\d{2}-(WINTER|SPRING|SUMMER|FALL)$/.test(key)) throw new Error('Invalid Seasonal Wrapped period');
}
export function validateSeasonalArchive(value: unknown): asserts value is SeasonalArchive {
  if (!isRecord(value) || Object.keys(value).length > 400) throw new Error('Invalid Seasonal Wrapped archive');
  for (const [key, choices] of Object.entries(value)) {
    validateSeasonKey(key);
    if (!isRecord(choices) || Object.keys(choices).some(key => !['updatedAt', 'awards', 'confirmedMediaIds', 'releaseSeenAt'].includes(key))
      || !Number.isSafeInteger(choices.updatedAt) || (choices.updatedAt as number) < 0 || !isRecord(choices.awards)
      || (choices.releaseSeenAt !== undefined && (!Number.isSafeInteger(choices.releaseSeenAt) || (choices.releaseSeenAt as number) <= 0))
      || !Object.entries(choices.awards).every(([award, id]) => SEASONAL_AWARDS.some(item => item.id === award) && validMediaId(id))
      || !Array.isArray(choices.confirmedMediaIds) || choices.confirmedMediaIds.length > 10000
      || !choices.confirmedMediaIds.every(validMediaId) || new Set(choices.confirmedMediaIds).size !== choices.confirmedMediaIds.length) {
      throw new Error('Invalid Seasonal Wrapped choices');
    }
  }
}
const validMediaId = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
export function currentSeason(now = new Date()): SeasonalPeriod { return { year: now.getFullYear(), season: SEASONS[Math.floor(now.getMonth() / 3)] }; }
/** Publish a season three calendar days after its final day, leaving time for last-minute rating edits. */
export function latestReleasedSeason(now = new Date(), graceDays = 3): SeasonalPeriod {
  const today = localDateKey(now);
  const active = currentSeason(now);
  let index = SEASONS.indexOf(active.season) - 1;
  let year = active.year;
  if (index < 0) { index = SEASONS.length - 1; year--; }
  for (let checked = 0; checked < 800; checked++) {
    const period = { year, season: SEASONS[index] };
    const end = new Date(`${seasonBounds(period).end}T00:00:00`);
    end.setDate(end.getDate() + graceDays);
    if (today >= localDateKey(end)) return period;
    index--;
    if (index < 0) { index = SEASONS.length - 1; year--; }
  }
  throw new Error('No released Seasonal Wrapped period is available.');
}
export function seasonLabel(period: SeasonalPeriod): string {
  return `${period.season[0]}${period.season.slice(1).toLowerCase()} ${period.year}`;
}
export function seasonBounds(period: SeasonalPeriod): { start: string; end: string } {
  validateSeasonKey(seasonKey(period));
  const month = SEASONS.indexOf(period.season) * 3;
  return { start: localDateKey(new Date(period.year, month, 1)), end: localDateKey(new Date(period.year, month + 3, 0)) };
}
/** Month precision is enough to identify a quarter; year-only dates stay unresolved. */
export function dateSeason(date: AniListDate | null): SeasonalPeriod | null {
  return date?.year && date.month && date.year >= 1900 && date.year <= 2199
    ? { year: date.year, season: SEASONS[Math.floor((date.month - 1) / 3)] } : null;
}
function dateLimits(date: AniListDate | null | undefined): { first: string; last: string } | null {
  if (!date?.year || date.year < 1900 || date.year > 2199) return null;
  const month = date.month ?? 12;
  const lastDay = date.day ?? new Date(date.year, month, 0).getDate();
  return { first: `${date.year}-${String(date.month ?? 1).padStart(2, '0')}-${String(date.day ?? 1).padStart(2, '0')}`,
    last: localDateKey(new Date(date.year, month - 1, lastDay)) };
}

export interface SeasonalEntry {
  mediaId: number; title: string; cover: string | null; format: string | null;
  status: MediaListStatus; progress: number; score: number; private: boolean; hidden: boolean;
  startedAt: AniListDate | null; completedAt: AniListDate | null;
  releaseStatus: MediaStatus; startDate: AniListDate | null; endDate: AniListDate | null;
  origin: SeasonalPeriod | null; genres: string[];
}
export interface SeasonalTitle extends SeasonalEntry {
  leftover: boolean; currentScore: number | null; scoreSource: 'Astra' | 'AniList' | null;
  reason?: 'viewing-dates' | 'broadcast-dates';
}
export interface SeasonalReport {
  period: SeasonalPeriod; provisional: boolean;
  concluded: SeasonalTitle[]; continuing: SeasonalTitle[]; uncertain: SeasonalTitle[];
  ranking: Array<SeasonalTitle & { rank: number }>;
  awards: Array<{ id: SeasonalAward; label: string; title: SeasonalTitle | null }>;
  completed: number; dropped: number; leftovers: number; average: number | null;
  excludedRecoveries: number; genres: Array<{ name: string; count: number }>;
}

export function buildSeasonalReport(entries: SeasonalEntry[], works: AstraWork[], period: SeasonalPeriod, choices: SeasonalChoices,
  score: (work: AstraWork) => number | null, includePrivate = false, now = new Date()): SeasonalReport {
  const bounds = seasonBounds(period); const today = localDateKey(now);
  const local = new Map(works.map(work => [work.mediaId, work]));
  const report: SeasonalReport = { period: { ...period }, provisional: today <= bounds.end, concluded: [], continuing: [], uncertain: [], ranking: [], awards: [],
    completed: 0, dropped: 0, leftovers: 0, average: null, excludedRecoveries: 0, genres: [] };
  const confirmed = new Set(choices.confirmedMediaIds); const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.mediaId)) continue; seen.add(entry.mediaId);
    const work = local.get(entry.mediaId);
    if (!includePrivate && (entry.private || entry.hidden || work?.isPrivate || work?.isHidden)) continue;
    if (entry.status === 'PLANNING' || entry.releaseStatus === 'NOT_YET_RELEASED') continue;
    const finish = dateSeason(entry.endDate);
    const finishStart = finish ? seasonBounds(finish).start : null;
    if (finishStart && finishStart < bounds.start) continue;
    const origin = entry.origin ?? dateSeason(entry.startDate);
    if (!origin) { report.uncertain.push({ ...entry, origin, leftover: false, currentScore: null, scoreSource: null, reason: 'broadcast-dates' }); continue; }
    const originStart = seasonBounds(origin).start;
    if (originStart > bounds.end) continue;
    const endLimits = dateLimits(entry.endDate);
    const ended = entry.releaseStatus === 'FINISHED' && finishStart === bounds.start && !!endLimits && endLimits.last <= today;
    const continues = finishStart !== null && finishStart > bounds.start;
    const unresolved = !ended && !continues;
    // Personal completion alone cannot prove when a title was watched. Undated
    // historical participation is explicitly confirmed without changing AniList.
    const started = dateLimits(entry.startedAt);
    const completed = dateLimits(entry.completedAt);
    const datedActivity = work?.seasons.some(season => Object.values(season.episodeNotes ?? {}).some(note => {
      if (typeof note.timestamp !== 'number' || !Number.isFinite(note.timestamp) || note.timestamp > now.getTime()) return false;
      const day = localDateKey(new Date(note.timestamp)); return day >= originStart && day <= bounds.end;
    })) ?? false;
    if (started && started.first > bounds.end && !datedActivity) { report.excludedRecoveries++; continue; }
    const participation = confirmed.has(entry.mediaId) || datedActivity || (started !== null && started.last <= bounds.end)
      || (completed !== null && completed.last <= bounds.end)
      || (today >= bounds.start && today <= bounds.end && ['CURRENT', 'REPEATING'].includes(entry.status) && entry.progress > 0);
    const astraScore = work ? score(work) : null;
    const hasAstra = astraScore !== null && Number.isFinite(astraScore) && astraScore > 0;
    const rated = entry.status === 'COMPLETED' && ended && participation;
    const title: SeasonalTitle = { ...entry, origin, leftover: originStart < bounds.start,
      currentScore: rated ? hasAstra ? astraScore : entry.score > 0 ? entry.score : null : null,
      scoreSource: rated ? hasAstra ? 'Astra' : entry.score > 0 ? 'AniList' : null : null };
    if (!participation) report.uncertain.push({ ...title, currentScore: null, scoreSource: null, reason: 'viewing-dates' });
    else if (ended) report.concluded.push(title);
    else if (continues || (['RELEASING', 'HIATUS'].includes(entry.releaseStatus) && today <= bounds.end)) report.continuing.push(title);
    else if (unresolved) report.uncertain.push({ ...title, reason: 'broadcast-dates' });
  }
  for (const titles of [report.concluded, report.continuing, report.uncertain]) titles.sort((a, b) => a.title.localeCompare(b.title));
  const ranked = report.concluded.filter(title => title.currentScore !== null).sort((a, b) => b.currentScore! - a.currentScore! || a.title.localeCompare(b.title));
  for (const [index, title] of ranked.entries()) report.ranking.push({ ...title, rank: index > 0 && ranked[index - 1].currentScore === title.currentScore ? report.ranking[index - 1].rank : index + 1 });
  report.completed = report.concluded.filter(title => title.status === 'COMPLETED').length;
  report.dropped = report.concluded.filter(title => title.status === 'DROPPED').length;
  report.leftovers = report.concluded.filter(title => title.leftover).length;
  report.average = ranked.length ? ranked.reduce((sum, title) => sum + title.currentScore!, 0) / ranked.length : null;
  const genres = new Map<string, number>();
  for (const title of report.concluded) for (const genre of new Set(title.genres)) genres.set(genre, (genres.get(genre) ?? 0) + 1);
  report.genres = [...genres].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  report.awards = SEASONAL_AWARDS.map(award => ({ ...award,
    title: report.concluded.find(title => title.mediaId === choices.awards[award.id] && (award.id === 'disappointment' || title.status === 'COMPLETED')) ?? null }));
  return report;
}
