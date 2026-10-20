import { describe, expect, it } from 'vitest';
import { buildYearReview } from './YearReview';
import type { ReviewActivity, ReviewCharacter, ReviewMedia, ReviewOptions, YearReviewInput } from './YearReviewTypes';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 1000;
let ids = 0;
const act = (mediaId: number, date: string, kind: ReviewActivity['kind'], progress?: [number, number], hour = 12): ReviewActivity => ({
  id: ++ids, mediaId, kind, progress: progress ? { from: progress[0], to: progress[1] } : null,
  createdAt: at(date, hour), likeCount: 0, replyCount: 0, likers: [],
});
const media = (id: number, patch: Partial<ReviewMedia> = {}): ReviewMedia => ({
  id, type: 'ANIME', title: `Title ${id}`, cover: null, color: null, format: 'TV', episodes: 12, chapters: null, duration: 24,
  releaseYear: 2024, country: 'JP', source: 'MANGA', genres: ['Action'], tags: [], meanScore: 70, popularity: 1000,
  studios: [], staff: [], characters: [], scoreDistribution: [], entry: { score: 0, status: 'COMPLETED', private: false, hidden: false }, ...patch,
});
const input = (activities: ReviewActivity[], items: ReviewMedia[], patch: Partial<YearReviewInput> = {}): YearReviewInput => ({
  period: { start: '2024-01-01', end: '2024-12-31' }, ownerId: 1, activities, media: items, priorProgress: {},
  posts: [], messages: [], allTimeGenres: [], truncated: false, ...patch,
});
const review = (data: YearReviewInput, includePrivate = false, local?: ReviewOptions['local']) =>
  buildYearReview(data, { includePrivate, local, now: at('2025-06-01') * 1000 });
const character = (id: number, role: ReviewCharacter['role'], actor: number): ReviewCharacter => ({
  id, name: `Character ${id}`, image: null, role, favourites: id, voiceActor: { id: actor, name: `Actor ${actor}`, image: null },
});

describe('Year review: units from the activity feed', () => {
  it('counts progress ranges once and fills the remainder when a title is completed', () => {
    const report = review(input([
      act(1, '2024-02-01', 'progress', [1, 4]), act(1, '2024-02-02', 'progress', [5, 5]), act(1, '2024-02-03', 'completed'),
    ], [media(1)]));
    expect(report).toMatchObject({ episodes: 12, minutes: 288, timedEpisodes: 12 });
    expect(report.titles[0]).toMatchObject({ mediaId: 1, units: 12, completed: true });
  });
  it('uses progress logged before the period and never counts a completion twice', () => {
    const report = review(input([act(1, '2024-03-01', 'completed'), act(2, '2024-03-01', 'completed'), act(2, '2024-03-02', 'completed')],
      [media(1), media(2, { episodes: 1, format: 'MOVIE', duration: 100 })], { priorProgress: { 1: 9 } }));
    expect(report.episodes).toBe(4);
    expect(report.minutes).toBe(3 * 24 + 100);
  });
  it('counts rewatches, manga chapters and unknown durations separately', () => {
    const report = review(input([
      act(1, '2024-01-05', 'repeat-progress', [1, 3]), act(2, '2024-01-05', 'progress', [10, 19]),
      act(3, '2024-01-06', 'progress', [1, 2]),
    ], [media(1), media(2, { type: 'MANGA', format: 'MANGA', chapters: 100, duration: null }), media(3, { duration: null })]));
    expect(report).toMatchObject({ episodes: 5, chapters: 10, minutes: 72, timedEpisodes: 3 });
  });
  it('tracks status changes without inventing units for planning, pauses or drops', () => {
    const report = review(input([
      act(1, '2024-01-01', 'planning'), act(2, '2024-01-01', 'paused'), act(3, '2024-01-01', 'dropped'), act(4, '2024-01-01', 'repeated'),
    ], [media(1), media(2), media(3), media(4)], { priorProgress: { 4: 12 } }));
    expect(report.statuses).toEqual({ completed: 0, dropped: 1, paused: 1, planned: 1, repeated: 1 });
    expect(report.episodes).toBe(0);
    expect(report.titles.map((title) => title.mediaId)).toEqual([4]);
    expect(report.first?.mediaId).toBe(4);
  });
  it('keeps Astra-private planning additions out unless private titles are included', () => {
    const data = input([act(9, '2024-01-01', 'planning'), act(1, '2024-01-02', 'completed')], [media(1)]);
    const local = new Map([[9, { score: null, private: true, hidden: false }]]);
    expect(review(data, false, local).statuses.planned).toBe(0);
    expect(review(data, true, local).statuses.planned).toBe(1);
  });
  it('counts planning additions without media details and ignores other unknown titles', () => {
    const report = review(input([act(9, '2024-01-01', 'planning'), act(8, '2024-01-02', 'progress', [1, 3])], []));
    expect(report).toMatchObject({ listActivities: 1, activeDays: 1, episodes: 0, statuses: { planned: 1 } });
  });
});

describe('Year review: rhythm', () => {
  it('groups by local day, finds the best day, streaks, weekdays, hours and months', () => {
    const report = review(input([
      act(1, '2024-03-30', 'progress', [1, 2], 23), act(1, '2024-03-31', 'progress', [3, 8], 23), act(1, '2024-04-01', 'progress', [9, 9], 8),
      act(2, '2024-06-10', 'planning', undefined, 23),
    ], [media(1), media(2)]));
    expect(report).toMatchObject({ activeDays: 4, longestStreak: 3, listActivities: 4, bestDay: { date: '2024-03-31', units: 6 } });
    expect(report.months).toHaveLength(12);
    expect(report.months[2]).toMatchObject({ month: '2024-03', episodes: 8 });
    expect(report.weekdays[6]).toBe(6); // 31 March 2024 was a Sunday
    expect(report.hours[23]).toBe(3);
    expect(report.first?.mediaId).toBe(1);
    expect(report.last?.mediaId).toBe(1);
  });
});

describe('Year review: scores and taste', () => {
  it('prefers Astra scores, excludes private titles unless asked and ranks by score', () => {
    const data = input([act(1, '2024-01-01', 'completed'), act(2, '2024-01-02', 'completed'), act(3, '2024-01-03', 'completed')], [
      media(1, { entry: { score: 6, status: 'COMPLETED', private: false, hidden: false } }),
      media(2, { entry: { score: 9, status: 'COMPLETED', private: true, hidden: false } }),
      media(3, { entry: { score: 7, status: 'COMPLETED', private: false, hidden: false } }),
    ]);
    const local = new Map([[1, { score: 8.5, private: false, hidden: false }], [3, { score: null, private: false, hidden: true }]]);
    expect(review(data, false, local).topRated.map((title) => [title.mediaId, title.score, title.scoreSource])).toEqual([[1, 8.5, 'Astra']]);
    expect(review(data, true, local).topRated.map((title) => title.mediaId)).toEqual([2, 1, 3]);
    expect(review(data, true, local).meanScore).toBeCloseTo((8.5 + 9 + 7) / 3);
  });
  it('compares scores with the community and finds percentile standouts', () => {
    const distribution = [{ score: 50, amount: 50 }, { score: 70, amount: 30 }, { score: 90, amount: 20 }];
    const scored = (id: number, score: number, meanScore: number) => media(id, { meanScore, scoreDistribution: distribution, entry: { score, status: 'COMPLETED', private: false, hidden: false } });
    const report = review(input([1, 2, 3].map((id) => act(id, '2024-05-01', 'completed')), [scored(1, 9.5, 60), scored(2, 4, 80), scored(3, 7, 70)]));
    expect(report.community.rated).toBe(3);
    expect(report.community.meanDifference).toBeCloseTo((35 - 40 + 0) / 3);
    expect(report.community.warmer.map((item) => [item.title.mediaId, item.difference])).toEqual([[1, 35]]);
    expect(report.community.colder.map((item) => [item.title.mediaId, item.difference])).toEqual([[2, -40]]);
    expect(report.community.generous).toMatchObject({ title: { mediaId: 1 }, share: 0.8 });
    expect(report.community.tough).toMatchObject({ title: { mediaId: 2 }, share: 1 });
  });
  it('builds genres, all-time shift, tags, formats, eras and popularity', () => {
    const report = review(input([1, 2, 3].map((id) => act(id, '2024-05-01', 'completed')), [
      media(1, { genres: ['Drama', 'Romance'], tags: [{ name: 'Iyashikei', rank: 90 }, { name: 'Weak', rank: 20 }], releaseYear: 2024, popularity: 500000 }),
      media(2, { genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 70 }], format: 'MOVIE', episodes: 1, releaseYear: 1998, popularity: 900 }),
      media(3, { genres: ['Action'], country: 'KR', releaseYear: 2011, popularity: 40000 }),
    ], { allTimeGenres: [{ name: 'Action', count: 3 }, { name: 'Drama', count: 1 }] }));
    expect(report.genres.map((genre) => [genre.name, genre.titles])).toEqual([['Drama', 2], ['Action', 1], ['Romance', 1]]);
    // Shares of genre mentions, so this year and all time use the same denominator.
    expect(report.genreShift.find((genre) => genre.name === 'Drama')).toEqual({ name: 'Drama', now: 0.5, before: 0.25 });
    expect(report.tags).toEqual([{ name: 'Iyashikei', titles: 2 }]);
    expect(report.formats).toEqual([{ name: 'TV', titles: 2 }, { name: 'MOVIE', titles: 1 }]);
    expect(report.countries).toEqual([{ name: 'JP', titles: 2 }, { name: 'KR', titles: 1 }]);
    expect(report.decades.map((decade) => decade.name)).toEqual(['1990s', '2010s', '2020s']);
    expect(report.freshShare).toBeCloseTo(1 / 3);
    expect(report.oldest?.mediaId).toBe(2);
    expect(report.popularity).toMatchObject({ mostPopular: { mediaId: 1 }, hiddenGem: { mediaId: 2 }, median: 40000 });
  });
});

describe('Year review: people', () => {
  it('weights voice actors by time watched and role, and keeps their characters', () => {
    const long = media(1, { episodes: 24, characters: [character(1, 'MAIN', 100), character(2, 'SUPPORTING', 200)] });
    const shorts = [2, 3, 4].map((id) => media(id, { episodes: 1, duration: 24, characters: [character(10 + id, 'SUPPORTING', 200)] }));
    const report = review(input([act(1, '2024-02-01', 'completed'), ...[2, 3, 4].map((id) => act(id, '2024-02-02', 'completed'))], [long, ...shorts]));
    expect(report.voiceActors[0]).toMatchObject({ id: 100, titles: 1, minutes: 576 });
    expect(report.voiceActors[1]).toMatchObject({ id: 200, titles: 4 });
    expect(report.voiceActors[1].characters.map((item) => item.id)).toEqual([2, 14, 13, 12]);
  });
  it('ranks studios, directors, composers and authors', () => {
    const staff = (id: number, role: string) => ({ id, name: `Staff ${id}`, image: null, role });
    const report = review(input([act(1, '2024-02-01', 'completed'), act(2, '2024-02-01', 'completed'), act(3, '2024-02-01', 'progress', [1, 5])], [
      media(1, { studios: [{ id: 7, name: 'Madhouse' }], staff: [staff(1, 'Director'), staff(2, 'Music')] }),
      media(2, { studios: [{ id: 7, name: 'Madhouse' }], staff: [staff(1, 'Episode Director (ep 3)'), staff(3, 'Music (OP)')] }),
      media(3, { type: 'MANGA', format: 'MANGA', staff: [staff(4, 'Story & Art')] }),
    ]));
    expect(report.studios[0]).toMatchObject({ name: 'Madhouse', titles: 2, minutes: 576 });
    expect(report.directors.map((person) => person.id)).toEqual([1]);
    expect(report.composers.map((person) => person.id)).toEqual([2, 3]);
    expect(report.authors.map((person) => person.id)).toEqual([4]);
  });
  it('gives each creator the covers of their top three works, in the order of their works', () => {
    const staff = [{ id: 1, name: 'Director One', image: null, role: 'Director' }];
    const report = review(input([1, 2, 3, 4].map((id) => act(id, '2024-02-01', 'completed')), [
      media(1, { cover: 'https://s4.anilist.co/1.jpg', episodes: 4, staff }),
      media(2, { cover: null, episodes: 12, staff }),
      media(3, { cover: 'https://s4.anilist.co/3.jpg', episodes: 8, staff }),
      media(4, { cover: 'https://s4.anilist.co/4.jpg', episodes: 2, staff }),
    ]));
    expect(report.directors[0].works).toEqual(['Title 2', 'Title 3', 'Title 1', 'Title 4']);
    expect(report.directors[0].covers).toEqual([
      { title: 'Title 2', cover: null },
      { title: 'Title 3', cover: 'https://s4.anilist.co/3.jpg' },
      { title: 'Title 1', cover: 'https://s4.anilist.co/1.jpg' },
    ]);
  });
  it('totals likes, replies, posts and messages and ranks fans without the owner', () => {
    const fan = (id: number) => ({ id, name: `Fan ${id}`, avatar: null });
    const liked = { ...act(1, '2024-02-01', 'progress', [1, 1]), likeCount: 3, replyCount: 1, likers: [fan(2), fan(3), fan(1)] };
    const report = review(input([liked], [media(1)], {
      posts: [{ createdAt: at('2024-02-02'), likeCount: 2, replyCount: 4, likers: [fan(3), fan(4)] }],
      messages: [{ createdAt: at('2024-02-03'), sender: fan(2) }, { createdAt: at('2024-02-04'), sender: fan(2) }],
    }));
    expect(report.social).toMatchObject({ likes: 5, replies: 5, posts: 1, messages: 2 });
    expect(report.social.fans.map((person) => [person.id, person.likes, person.messages])).toEqual([[2, 1, 2], [3, 2, 0], [4, 1, 0]]);
  });
});

describe('Year review: traits', () => {
  it('derives traits from habits', () => {
    const many = Array.from({ length: 20 }, (_, index) => media(index + 1, { popularity: 2000 }));
    const report = review(input(many.map((item) => act(item.id, '2024-08-13', 'completed', undefined, 1)), many));
    expect(report.traits).toEqual(expect.arrayContaining(['binger', 'night-owl', 'completionist', 'explorer', 'loyalist', 'simulcaster']));
  });
});
