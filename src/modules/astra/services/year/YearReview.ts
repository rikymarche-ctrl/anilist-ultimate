/**
 * @file YearReview.ts
 * @description Pure calculation of Astra Wrapped from the AniList activity feed.
 *
 * Units come only from dated list activity: a progress range ("4 - 10") counts its
 * episodes or chapters on the day it was logged, and a completion adds the units between
 * the last known progress and the title's length. Progress logged before the period
 * (priorProgress) prevents a completion from re-counting episodes watched earlier.
 */

import { localDateKey, wrappedDate } from '../AstraWrapped';
import { creators, fans, voiceActors } from './YearPeople';
import { buildTaste, median } from './YearTaste';
import type {
  ReviewActivity,
  ReviewMedia,
  ReviewOptions,
  ReviewTitle,
  ReviewTrait,
  ReviewUser,
  YearReviewInput,
  YearReviewReport,
} from './YearReviewTypes';

/** Guards against corrupt progress text such as "1 - 999999". */
const MAX_UNITS_PER_ACTIVITY = 10000;
const MAX_YEARS = 100;
const BINGE_UNITS = 20;
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4]);
const NIGHT_SHARE = 0.4;
const MIN_HABIT_SAMPLE = 10;
const MIN_TITLE_SAMPLE = 5;
const COMPLETION_RATE = 0.9;
const EXPLORER_MEDIAN_POPULARITY = 20000;
const CRITIC_GAP = 10;
const LOYAL_SHARE = 0.6;
const ARCHIVE_AGE_YEARS = 10;

interface TitleState {
  units: number;
  minutes: number;
  completed: boolean;
}

interface Tracker {
  report: YearReviewReport;
  days: Map<string, number>;
  activeDays: Set<string>;
  titles: Map<number, TitleState>;
  last: Map<number, number>;
  likers: ReviewUser[];
  firstId: number | null;
  lastId: number | null;
}

export function buildYearReview(input: YearReviewInput, options: ReviewOptions = {}): YearReviewReport {
  const start = wrappedDate(input.period.start);
  const end = wrappedDate(input.period.end);
  if (start > end) throw new Error('The end date must follow the start date.');
  if (end.getFullYear() - start.getFullYear() > MAX_YEARS) throw new Error('Choose a period of up to 100 years.');
  end.setDate(end.getDate() + 1);
  const from = start.getTime() / 1000;
  const until = Math.min(end.getTime(), options.now ?? Date.now()) / 1000;
  const media = new Map(input.media.filter((item) => visible(item, options)).map((item) => [item.id, item]));
  const hidden = new Set(input.media.filter((item) => !media.has(item.id)).map((item) => item.id));
  // Planning-only titles have no media details; Astra still knows if they are private.
  if (!options.includePrivate) for (const [id, flags] of options.local ?? []) if (flags.private || flags.hidden) hidden.add(id);
  const tracker = createTracker(input, start, end);
  const seen = new Set<number>();
  // Planning additions are counted without media details (they are never looked up).
  const activities = input.activities
    .filter((activity) => activity.createdAt >= from && activity.createdAt < until && !hidden.has(activity.mediaId))
    .filter((activity) => activity.kind === 'planning' || media.has(activity.mediaId))
    .filter((activity) => !seen.has(activity.id) && seen.add(activity.id))
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  for (const activity of activities) track(tracker, activity, media.get(activity.mediaId));
  return finish(tracker, input, media, options, { from, until });
}

function visible(item: ReviewMedia, options: ReviewOptions): boolean {
  if (options.includePrivate) return true;
  const local = options.local?.get(item.id);
  return !(item.entry?.private || item.entry?.hidden || local?.private || local?.hidden);
}

function createTracker(input: YearReviewInput, start: Date, end: Date): Tracker {
  const months: YearReviewReport['months'] = [];
  for (const cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor < end; cursor.setMonth(cursor.getMonth() + 1)) {
    months.push({ month: localDateKey(cursor).slice(0, 7), episodes: 0, chapters: 0 });
  }
  const report: YearReviewReport = {
    period: { ...input.period }, truncated: input.truncated, episodes: 0, chapters: 0, minutes: 0, timedEpisodes: 0,
    listActivities: 0, activeDays: 0, longestStreak: 0, bestDay: null, days: [], months,
    weekdays: new Array<number>(7).fill(0), hours: new Array<number>(24).fill(0),
    statuses: { completed: 0, dropped: 0, paused: 0, planned: 0, repeated: 0 }, first: null, last: null,
    titles: [], topRated: [], meanScore: null, genres: [], genreShift: [], tags: [], formats: [], countries: [],
    sources: [], decades: [], freshShare: null, oldest: null,
    community: { rated: 0, meanDifference: null, warmer: [], colder: [], generous: null, tough: null },
    popularity: { mostPopular: null, hiddenGem: null, median: null },
    voiceActors: [], studios: [], directors: [], composers: [], authors: [],
    social: { likes: 0, replies: 0, posts: 0, messages: 0, fans: [] }, traits: [],
  };
  const last = new Map<number, number>();
  for (const [id, progress] of Object.entries(input.priorProgress)) {
    if (Number.isSafeInteger(progress) && progress > 0) last.set(Number(id), progress);
  }
  return { report, days: new Map(), activeDays: new Set(), titles: new Map(), last, likers: [], firstId: null, lastId: null };
}

/** Units this activity adds, updating the last known progress of its title. */
function unitsOf(tracker: Tracker, activity: ReviewActivity, item: ReviewMedia): number {
  if (activity.kind === 'progress' || activity.kind === 'repeat-progress') {
    const range = activity.progress;
    if (!range || range.to < range.from) return 0;
    tracker.last.set(item.id, range.to);
    return Math.min(MAX_UNITS_PER_ACTIVITY, range.to - range.from + 1);
  }
  if (activity.kind !== 'completed' && activity.kind !== 'repeated') return 0;
  const total = item.type === 'ANIME' ? item.episodes : item.chapters;
  if (!total) return 0;
  const previous = tracker.last.get(item.id) ?? 0;
  tracker.last.set(item.id, total);
  return Math.min(MAX_UNITS_PER_ACTIVITY, Math.max(0, total - previous));
}

function track(tracker: Tracker, activity: ReviewActivity, item: ReviewMedia | undefined): void {
  const { report } = tracker;
  const date = new Date(activity.createdAt * 1000);
  const day = localDateKey(date);
  report.listActivities++;
  report.hours[date.getHours()]++;
  tracker.activeDays.add(day);
  report.social.likes += activity.likeCount;
  report.social.replies += activity.replyCount;
  tracker.likers.push(...activity.likers);
  const statuses = report.statuses;
  if (activity.kind === 'planning') statuses.planned++;
  else if (activity.kind === 'paused') statuses.paused++;
  else if (activity.kind === 'dropped') statuses.dropped++;
  else if (activity.kind === 'completed') statuses.completed++;
  else if (activity.kind === 'repeated') statuses.repeated++;
  if (activity.kind === 'planning' || !item) return;
  const units = unitsOf(tracker, activity, item);
  const finished = activity.kind === 'completed' || activity.kind === 'repeated';
  // A pause or drop with nothing watched in the period is a status change, not a title of the year.
  if (!units && !finished) return;
  tracker.firstId ??= item.id;
  tracker.lastId = item.id;
  const state = tracker.titles.get(item.id) ?? { units: 0, minutes: 0, completed: false };
  state.completed ||= finished;
  tracker.titles.set(item.id, state);
  if (!units) return;
  state.units += units;
  tracker.days.set(day, (tracker.days.get(day) ?? 0) + units);
  report.weekdays[(date.getDay() + 6) % 7] += units;
  const month = report.months.find((bucket) => bucket.month === day.slice(0, 7));
  if (item.type === 'MANGA') {
    report.chapters += units;
    if (month) month.chapters += units;
    return;
  }
  report.episodes += units;
  if (month) month.episodes += units;
  if (item.duration && item.duration > 0) {
    state.minutes += units * item.duration;
    report.minutes += units * item.duration;
    report.timedEpisodes += units;
  }
}

function scoreOf(item: ReviewMedia, options: ReviewOptions): Pick<ReviewTitle, 'score' | 'scoreSource'> {
  const astra = options.local?.get(item.id)?.score;
  if (typeof astra === 'number' && Number.isFinite(astra) && astra > 0) return { score: astra, scoreSource: 'Astra' };
  if (item.entry && item.entry.score > 0) return { score: item.entry.score, scoreSource: 'AniList' };
  return { score: null, scoreSource: null };
}

function titleOf(item: ReviewMedia, state: TitleState, options: ReviewOptions): ReviewTitle {
  return {
    mediaId: item.id, title: item.title, cover: item.cover, color: item.color, type: item.type, format: item.format,
    units: state.units, minutes: state.minutes, ...scoreOf(item, options), meanScore: item.meanScore,
    popularity: item.popularity, releaseYear: item.releaseYear, completed: state.completed,
  };
}

function rhythm(tracker: Tracker): void {
  const { report } = tracker;
  const sorted = [...tracker.activeDays].sort();
  let streak = 0;
  let previous = '';
  for (const day of sorted) {
    const yesterday = wrappedDate(day);
    yesterday.setDate(yesterday.getDate() - 1);
    streak = localDateKey(yesterday) === previous ? streak + 1 : 1;
    report.longestStreak = Math.max(report.longestStreak, streak);
    previous = day;
  }
  report.activeDays = sorted.length;
  report.days = [...tracker.days.keys()].sort().map((date) => ({ date, units: tracker.days.get(date)! }));
  for (const day of report.days) if (!report.bestDay || day.units > report.bestDay.units) report.bestDay = { ...day };
}

function finish(
  tracker: Tracker,
  input: YearReviewInput,
  media: Map<number, ReviewMedia>,
  options: ReviewOptions,
  window: { from: number; until: number }
): YearReviewReport {
  const { report } = tracker;
  rhythm(tracker);
  const titles = [...tracker.titles].map(([id, state]) => titleOf(media.get(id)!, state, options));
  report.titles = [...titles].sort((a, b) => b.units - a.units || a.title.localeCompare(b.title) || a.mediaId - b.mediaId);
  report.topRated = titles
    .filter((title) => title.score !== null)
    .sort((a, b) => b.score! - a.score! || b.units - a.units || a.title.localeCompare(b.title));
  report.meanScore = report.topRated.length
    ? report.topRated.reduce((sum, title) => sum + title.score!, 0) / report.topRated.length
    : null;
  report.first = titles.find((title) => title.mediaId === tracker.firstId) ?? null;
  report.last = titles.find((title) => title.mediaId === tracker.lastId) ?? null;
  const years = { first: Number(input.period.start.slice(0, 4)), last: Number(input.period.end.slice(0, 4)) };
  Object.assign(report, buildTaste(report.titles, media, input.allTimeGenres, years));
  report.voiceActors = voiceActors(report.titles, media);
  Object.assign(report, creators(report.titles, media));
  const inWindow = (item: { createdAt: number }) => item.createdAt >= window.from && item.createdAt < window.until;
  const posts = input.posts.filter(inWindow);
  const messages = input.messages.filter(inWindow);
  report.social.posts = posts.length;
  report.social.messages = messages.length;
  for (const post of posts) {
    report.social.likes += post.likeCount;
    report.social.replies += post.replyCount;
  }
  report.social.fans = fans(tracker.likers, posts, messages, input.ownerId);
  report.traits = traits(report, years.last);
  return report;
}

function traits(report: YearReviewReport, lastYear: number): ReviewTrait[] {
  const found: ReviewTrait[] = [];
  const night = report.hours.reduce((sum, count, hour) => sum + (NIGHT_HOURS.has(hour) ? count : 0), 0);
  const { completed, dropped, paused } = report.statuses;
  const years = report.titles.flatMap((title) => (title.releaseYear === null ? [] : [title.releaseYear]));
  const releaseMedian = median(years);
  if ((report.bestDay?.units ?? 0) >= BINGE_UNITS) found.push('binger');
  if (report.listActivities >= MIN_HABIT_SAMPLE && night / report.listActivities >= NIGHT_SHARE) found.push('night-owl');
  if (completed >= MIN_HABIT_SAMPLE && completed / (completed + dropped + paused) >= COMPLETION_RATE) found.push('completionist');
  if (report.titles.length >= MIN_TITLE_SAMPLE && report.popularity.median !== null && report.popularity.median < EXPLORER_MEDIAN_POPULARITY) found.push('explorer');
  if (report.community.rated >= MIN_TITLE_SAMPLE && Math.abs(report.community.meanDifference!) >= CRITIC_GAP) found.push('critic');
  if (report.titles.length >= MIN_TITLE_SAMPLE && (report.genres[0]?.titles ?? 0) / report.titles.length >= LOYAL_SHARE) found.push('loyalist');
  if (years.length >= MIN_TITLE_SAMPLE && (report.freshShare ?? 0) >= 0.5) found.push('simulcaster');
  if (years.length >= MIN_TITLE_SAMPLE && releaseMedian !== null && releaseMedian <= lastYear - ARCHIVE_AGE_YEARS) found.push('archivist');
  return found;
}
