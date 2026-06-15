import { MediaListStatus } from '@/api/AnilistTypes';

export interface AstraWork {
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
  seasons: AstraSeason[];
  genres?: string[];
  episodes?: number;
  chapters?: number;
  progress?: number;
  duration?: number;
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
  currentScore: number | null;
  sectionScores?: Record<string, number | null>;
  genres?: string[];
  customLists?: string[];
}

export interface AstraSeason {
  id?: string;
  name?: string;
  label?: string; // Add label for compatibility
  scores: Record<string, number | null>;
  skip?: string[]; // Add skip for calculator
  startDate?: string;
  endDate?: string;
  notes?: string;
  legacyScore?: number;
  manualOverride?: boolean;
  isSeriesFinale?: boolean;
  episodeNotes?: Record<number, AstraEpisodeNote>;
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
}
