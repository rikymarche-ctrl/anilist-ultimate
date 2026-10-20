/**
 * Synthetic Astra Wrapped input for unit and browser tests: invented people, no network
 * images, one hostile title and one private title. Activity is spread over the current
 * year up to `now`, so the default "This year" period always contains it.
 */

import type {
  ReviewActivity,
  ReviewMedia,
  YearReviewInput,
} from '@modules/astra/services/year/YearReviewTypes';
import type { YearReviewData } from '@modules/astra/services/year/YearReviewService';
import { localDateKey, wrappedPeriod } from '@modules/astra/services/AstraWrapped';

export const HOSTILE_TITLE = `<img src=x onerror=alert(1)> ${'A very long title '.repeat(5)}`;
export const PRIVATE_TITLE = 'Private title';

const person = (id: number, name: string) => ({ id, name, image: null });
const ANIME: Array<[string, number, number, string[], number, number]> = [
  // title, episodes, release year, genres, community mean, popularity
  ['Frieren: Beyond Journey’s End', 28, 2023, ['Adventure', 'Drama', 'Fantasy'], 89, 420000],
  ['The Apothecary Diaries', 24, 2023, ['Drama', 'Mystery'], 87, 300000],
  ['Dandadan', 12, 2024, ['Action', 'Comedy', 'Supernatural'], 84, 350000],
  ['Delicious in Dungeon', 24, 2024, ['Adventure', 'Comedy', 'Fantasy'], 85, 260000],
  ['Look Back', 1, 2024, ['Drama', 'Slice of Life'], 86, 120000],
  ['Blue Box', 25, 2024, ['Romance', 'Sports'], 80, 150000],
  ['Kaiba', 12, 2008, ['Mystery', 'Romance', 'Sci-Fi'], 79, 9000],
  [HOSTILE_TITLE, 12, 2020, ['Action'], 60, 3000],
  [PRIVATE_TITLE, 12, 2022, ['Drama'], 70, 5000],
];
const VOICES = ['Rin Amano', 'Sora Kisaragi', 'Mei Tachibana', 'Kaito Hayase', 'Yuna Shiraishi'];
const STUDIOS = [
  { id: 501, name: 'Studio Lumen' },
  { id: 502, name: 'Orbit Works' },
];

function media(index: number): ReviewMedia {
  const [title, episodes, releaseYear, genres, meanScore, popularity] = ANIME[index];
  const id = index + 1;
  return {
    id,
    type: 'ANIME',
    title,
    cover: null,
    color: null,
    format: episodes === 1 ? 'MOVIE' : 'TV',
    episodes,
    chapters: null,
    duration: episodes === 1 ? 119 : 24,
    releaseYear,
    country: index === 6 ? 'JP' : index === 7 ? 'KR' : 'JP',
    source: ['MANGA', 'LIGHT_NOVEL', 'ORIGINAL'][index % 3],
    genres,
    tags: [
      { name: 'Found Family', rank: 80 },
      { name: index % 2 ? 'Female Protagonist' : 'Male Protagonist', rank: 90 },
      { name: 'Iyashikei', rank: 60 + index },
    ],
    meanScore,
    popularity,
    studios: [STUDIOS[index % 2]],
    staff: [
      { ...person(600 + (index % 3), `Director ${'ABC'[index % 3]}`), role: 'Director' },
      { ...person(700 + (index % 2), `Composer ${'XY'[index % 2]}`), role: 'Music' },
    ],
    characters: [0, 1, 2].map((slot) => ({
      ...person(1000 + index * 10 + slot, `Character ${index + 1}-${slot + 1}`),
      role: slot === 0 ? 'MAIN' : 'SUPPORTING',
      favourites: 100 - slot,
      voiceActor: person(
        900 + ((index + slot) % VOICES.length),
        VOICES[(index + slot) % VOICES.length]
      ),
    })),
    scoreDistribution: [50, 60, 70, 80, 90, 100].map((score, bucket) => ({
      score,
      amount: 20 + bucket * 30,
    })),
    entry: {
      score: [9.5, 9, 8.5, 8, 9, 7, 6.5, 5, 7][index],
      status: 'COMPLETED',
      private: title === PRIVATE_TITLE,
      hidden: false,
    },
  };
}

function manga(id: number, title: string, chapters: number): ReviewMedia {
  return {
    ...media(0),
    id,
    type: 'MANGA',
    title,
    format: 'MANGA',
    episodes: null,
    chapters,
    duration: null,
    characters: [],
    staff: [{ ...person(800 + id, `Author ${id}`), role: 'Story & Art' }],
    studios: [],
    entry: { score: 0, status: 'CURRENT', private: false, hidden: false },
  };
}

/** Input for the period from 1 January to `now`. */
export function yearReviewInput(now = new Date()): YearReviewInput {
  const period = wrappedPeriod('year', now);
  const start = new Date(`${period.start}T00:00:00`).getTime();
  const span = Math.max(1, Math.floor((now.getTime() - start) / 86400000));
  let id = 0;
  const at = (day: number, hour: number) =>
    Math.floor((start + (day % span) * 86400000 + hour * 3600000) / 1000);
  const activities: ReviewActivity[] = [];
  const add = (
    mediaId: number,
    day: number,
    hour: number,
    kind: ReviewActivity['kind'],
    from?: number,
    to?: number,
    likes = 0
  ) =>
    activities.push({
      id: ++id,
      mediaId,
      kind,
      progress: from ? { from, to: to ?? from } : null,
      createdAt: at(day, hour),
      likeCount: likes,
      replyCount: likes ? 1 : 0,
      likers: Array.from({ length: likes }, (_, index) => ({
        id: 50 + index,
        name: `Friend ${index + 1}`,
        avatar: null,
      })),
    });
  ANIME.forEach(([, episodes], index) => {
    const mediaId = index + 1;
    if (episodes > 4) {
      add(mediaId, index * 9, 21 + (index % 3), 'progress', 1, 4, index % 2);
      add(mediaId, index * 9 + 1, 23, 'progress', 5, Math.min(episodes - 1, 9));
    }
    add(mediaId, index * 9 + 2, 22, 'completed', undefined, undefined, 2);
  });
  add(20, 3, 13, 'progress', 1, 40);
  add(20, 30, 14, 'progress', 41, 52);
  add(21, 40, 9, 'progress', 100, 112);
  add(30, 5, 20, 'planning');
  add(31, 6, 20, 'planning');
  add(2, 70, 1, 'paused');
  return {
    period,
    ownerId: 42,
    activities,
    priorProgress: {},
    media: [
      ...ANIME.map((_, index) => media(index)),
      manga(20, 'Witch Hat Atelier', 80),
      manga(21, 'Vagabond', 327),
    ],
    posts: [
      {
        createdAt: at(12, 18),
        likeCount: 6,
        replyCount: 3,
        likers: [{ id: 50, name: 'Friend 1', avatar: null }],
      },
    ],
    messages: [{ createdAt: at(15, 18), sender: { id: 51, name: 'Friend 2', avatar: null } }],
    allTimeGenres: [
      { name: 'Action', count: 40 },
      { name: 'Drama', count: 30 },
      { name: 'Comedy', count: 25 },
      { name: 'Romance', count: 8 },
    ],
    truncated: false,
  };
}

export function yearReviewData(now = new Date()): YearReviewData {
  return {
    input: yearReviewInput(now),
    local: new Map([[3, { score: 9.2, private: false, hidden: false }]]),
    loadedAt: now.getTime(),
  };
}

export const todayKey = () => localDateKey(new Date());
