import type { AniListDate } from '@/api/AnilistTypes';
import { MediaListStatus } from '@/api/AnilistTypes';

export interface AstraWork {
  /** Bound by the background repository; null denotes a local-only workspace. */
  ownerId?: number | null;
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga' | 'novel';
  country?: string;
  cover?: string;
  status: MediaListStatus;
  customLists: string[];
  tags: string[];
  notes: string;
  updatedAt: number;
  /** Last observed list dates or local save intent. */
  startedAt?: AniListDate | null;
  completedAt?: AniListDate | null;
  seasons: AstraSeason[];
  genres?: string[];
  episodes?: number;
  chapters?: number;
  progress?: number;
  duration?: number;
  isPrivate?: boolean;
  isHidden?: boolean;
}

export interface AstraWorkSummary {
  id: string;
  mediaId: number;
  title: string;
  type: 'anime' | 'manga' | 'novel';
  cover?: string;
  status: MediaListStatus;
  progress?: number;
  episodes?: number;
  chapters?: number;
  country?: string;
  updatedAt: number;
  /** Last observed list dates or local save intent. */
  startedAt?: AniListDate | null;
  completedAt?: AniListDate | null;
  currentScore: number | null;
  sectionScores?: Record<string, number | null>;
  genres?: string[];
  customLists?: string[];
  isPrivate?: boolean;
  isHidden?: boolean;
}

export interface AstraSeason {
  id?: string;
  name?: string;
  scores: Record<string, number | null>;
  skip?: string[]; // Add skip for calculator
  startDate?: string;
  endDate?: string;
  notes?: string;
  isSeriesFinale?: boolean;
  episodeNotes?: Record<number, AstraEpisodeNote>;
  /** Overall score set by hand (0.1-10 with one decimal, or 11 for the lode). Absent or null uses the weighted average. */
  manualScore?: number | null;
}

export interface AstraEpisodeNote {
  text: string;
  score?: number | null;
  timestamp?: number;
}

export interface AstraSection {
  id: string;
  name: string;
  weight: number;
  subSections?: AstraSubSection[];
}

export interface AstraSubSection {
  id: string;
  name: string;
  weight: number;
}

export interface AstraSettings {
  enableSeriesFinale: boolean;
  finaleWeightMultiplier: number;
  autoSync: boolean;
  appendAstraToComment: boolean;
  /** Section-based scoring in Quick Edit. Absent until the user picks a mode (or one is inferred from rated works). */
  detailedScoring?: boolean;
}
