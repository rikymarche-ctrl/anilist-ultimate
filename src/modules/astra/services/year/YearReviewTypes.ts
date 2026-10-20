/**
 * @file YearReviewTypes.ts
 * @description Input and report shapes for Astra Wrapped, built from the AniList activity feed.
 *
 * Inputs are validated provider data (see YearReviewResponse.ts); the report is a pure
 * function of them (see YearReview.ts), so every figure on a slide can be traced to an
 * AniList activity, a media record or the user's own list entry.
 */

import type { WrappedPeriod } from '../AstraWrapped';

export type ReviewMediaType = 'ANIME' | 'MANGA';

/** Normalized list-activity verbs ("watched episode", "plans to read", …). */
export type ReviewActivityKind =
  | 'progress'
  | 'repeat-progress'
  | 'completed'
  | 'repeated'
  | 'planning'
  | 'paused'
  | 'dropped'
  | 'other';

export interface ReviewUser {
  id: number;
  name: string;
  avatar: string | null;
}

export interface ReviewActivity {
  id: number;
  mediaId: number;
  kind: ReviewActivityKind;
  /** Inclusive unit range from AniList's progress text ("4 - 10"); null when absent. */
  progress: { from: number; to: number } | null;
  /** Unix seconds. */
  createdAt: number;
  likeCount: number;
  replyCount: number;
  likers: ReviewUser[];
}

export interface ReviewPerson {
  id: number;
  name: string;
  image: string | null;
}

export interface ReviewCharacter extends ReviewPerson {
  role: 'MAIN' | 'SUPPORTING' | 'BACKGROUND';
  favourites: number;
  voiceActor: ReviewPerson | null;
}

export interface ReviewStaff extends ReviewPerson {
  role: string;
}

export interface ReviewEntry {
  /** 0–10 (POINT_10_DECIMAL); 0 means unscored. */
  score: number;
  status: string;
  private: boolean;
  hidden: boolean;
}

export interface ReviewMedia {
  id: number;
  type: ReviewMediaType;
  title: string;
  cover: string | null;
  color: string | null;
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  /** Minutes per episode. */
  duration: number | null;
  releaseYear: number | null;
  country: string | null;
  source: string | null;
  genres: string[];
  tags: Array<{ name: string; rank: number }>;
  /** Community mean, 0–100. */
  meanScore: number | null;
  popularity: number;
  studios: Array<{ id: number; name: string }>;
  staff: ReviewStaff[];
  characters: ReviewCharacter[];
  /** Community score histogram in 10-point buckets (10…100). */
  scoreDistribution: Array<{ score: number; amount: number }>;
  entry: ReviewEntry | null;
}

export interface ReviewMessage {
  createdAt: number;
  sender: ReviewUser | null;
}

export interface ReviewPost {
  createdAt: number;
  likeCount: number;
  replyCount: number;
  likers: ReviewUser[];
}

export interface YearReviewInput {
  period: WrappedPeriod;
  ownerId: number;
  activities: ReviewActivity[];
  media: ReviewMedia[];
  /** Last known progress before the period, for titles completed without in-period progress. */
  priorProgress: Record<number, number>;
  posts: ReviewPost[];
  messages: ReviewMessage[];
  /** All-time genre counts from the user's AniList statistics (anime). */
  allTimeGenres: Array<{ name: string; count: number }>;
  /** The activity feed reached AniList's 5,000-entry listing limit. */
  truncated: boolean;
}

export interface ReviewOptions {
  includePrivate?: boolean;
  /** Local overrides (Astra series scores, private/hidden flags) keyed by media id. */
  local?: Map<number, { score: number | null; private: boolean; hidden: boolean }>;
  /** Epoch milliseconds; later activity is ignored. */
  now?: number;
}

export interface ReviewTitle {
  mediaId: number;
  title: string;
  cover: string | null;
  color: string | null;
  type: ReviewMediaType;
  format: string | null;
  units: number;
  minutes: number;
  /** The user's score (0–10) or null when unscored. */
  score: number | null;
  scoreSource: 'Astra' | 'AniList' | null;
  meanScore: number | null;
  popularity: number;
  releaseYear: number | null;
  completed: boolean;
}

export interface Ranked<T> {
  item: T;
  value: number;
}

export interface ReviewVoiceActor extends ReviewPerson {
  minutes: number;
  titles: number;
  characters: Array<ReviewCharacter & { mediaTitle: string }>;
}

export interface ReviewCreator extends ReviewPerson {
  titles: number;
  minutes: number;
  /** Titles credited, most watched first. */
  works: string[];
  /** Cover and title of the top three entries in `works`, same order. */
  covers: Array<{ title: string; cover: string | null }>;
}

export interface ReviewComparison {
  title: ReviewTitle;
  you: number;
  community: number;
  /** you − community on the 0–100 scale. */
  difference: number;
}

export interface ReviewPercentile {
  title: ReviewTitle;
  /** Share of community votes strictly in lower 10-point buckets (generous) or higher ones (tough). */
  share: number;
}

export interface ReviewFan extends ReviewUser {
  likes: number;
  messages: number;
}

export type ReviewTrait =
  | 'binger'
  | 'night-owl'
  | 'completionist'
  | 'explorer'
  | 'critic'
  | 'loyalist'
  | 'simulcaster'
  | 'archivist';

export interface YearReviewReport {
  period: WrappedPeriod;
  truncated: boolean;
  episodes: number;
  chapters: number;
  minutes: number;
  /** Episodes whose duration is known (the hours estimate covers only these). */
  timedEpisodes: number;
  listActivities: number;
  activeDays: number;
  longestStreak: number;
  bestDay: { date: string; units: number } | null;
  days: Array<{ date: string; units: number }>;
  months: Array<{ month: string; episodes: number; chapters: number }>;
  /** Monday-first unit totals. */
  weekdays: number[];
  /** List updates per local hour. */
  hours: number[];
  statuses: {
    completed: number;
    dropped: number;
    paused: number;
    planned: number;
    repeated: number;
  };
  first: ReviewTitle | null;
  last: ReviewTitle | null;
  titles: ReviewTitle[];
  topRated: ReviewTitle[];
  meanScore: number | null;
  genres: Array<{ name: string; titles: number; minutes: number }>;
  genreShift: Array<{ name: string; now: number; before: number }>;
  tags: Array<{ name: string; titles: number }>;
  formats: Array<{ name: string; titles: number }>;
  countries: Array<{ name: string; titles: number }>;
  sources: Array<{ name: string; titles: number }>;
  decades: Array<{ name: string; titles: number }>;
  freshShare: number | null;
  oldest: ReviewTitle | null;
  community: {
    rated: number;
    meanDifference: number | null;
    warmer: ReviewComparison[];
    colder: ReviewComparison[];
    generous: ReviewPercentile | null;
    tough: ReviewPercentile | null;
  };
  popularity: {
    mostPopular: ReviewTitle | null;
    hiddenGem: ReviewTitle | null;
    median: number | null;
  };
  voiceActors: ReviewVoiceActor[];
  studios: ReviewCreator[];
  directors: ReviewCreator[];
  composers: ReviewCreator[];
  authors: ReviewCreator[];
  social: { likes: number; replies: number; posts: number; messages: number; fans: ReviewFan[] };
  traits: ReviewTrait[];
}
