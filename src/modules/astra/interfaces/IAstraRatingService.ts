/**
 * @file IAstraRatingService.ts
 * @description Contract for the business logic of the Astra Rating system.
 * Handles data fetching, AniList synchronization, and local persistence coordination.
 */

import type { AstraWork } from '../AstraInterfaces';
import type {
  MediaListStatus,
  AniListDate,
  MediaType,
  MediaFormat,
  MediaStatus,
  AniListCoverImage,
} from '@/api/AnilistTypes';

export type AstraSaveResult = 'synced' | 'queued' | 'local';

/**
 * 'await' (default) waits for the AniList round-trip before resolving.
 * 'background' resolves as soon as the save is durably queued; dispatch continues without the caller.
 */
export type AstraDispatchMode = 'await' | 'background';

/** Outcome of a background drain: 'synced' once no queued save for the entry remains. */
export type AstraDispatchOutcome = 'synced' | 'queued';

export interface AstraProgressResult {
  mediaId: number;
  progress: number;
  previousProgress: number;
  userId: number;
  status: MediaListStatus;
  title: string;
  syncState?: 'synced' | 'queued';
}

export interface AstraSaveOptions {
  overallScore: number;
  progress?: number;
  repeat?: number;
  private?: boolean;
  hidden?: boolean;
  notes?: string;
  /** General thoughts were edited in this session; with appendAstraToComment the text outside the Astra block is replaced by them. */
  replaceNotes?: boolean;
  /** Skip rewriting the Astra report comment when a save only changes AniList list fields. */
  syncAstraNotes?: boolean;
  /** Send the Astra overall score to AniList. False leaves AniList's score untouched. Defaults to true. */
  syncScore?: boolean;
  customLists?: string[];
  startedAt?: AniListDate | null;
  completedAt?: AniListDate | null;
  skipSync?: boolean;
  /** How long the caller waits for the AniList dispatch. Defaults to 'await'. */
  dispatch?: AstraDispatchMode;
  /** Background saves only: called exactly once after AniList settles, with the outcome. */
  onDispatched?: (result: AstraDispatchOutcome) => void;
}

/**
 * Data structure returned when fetching initial data for a rating form.
 */
export interface AstraRatingEntry {
  id: number;
  mediaId: number;
  userId: number;
  status: MediaListStatus;
  progress: number;
  score: number;
  notes: string;
  repeat: number;
  private: boolean;
  hiddenFromStatusLists: boolean;
  startedAt: AniListDate | null;
  completedAt: AniListDate | null;
  customLists: Record<string, boolean>;
}

export interface AstraRatingMedia {
  id: number;
  title: { userPreferred: string };
  type: MediaType;
  format?: MediaFormat;
  status?: MediaStatus;
  episodes: number | null;
  chapters: number | null;
  countryOfOrigin?: string;
  coverImage: AniListCoverImage;
  nextAiringEpisode: { episode: number } | null;
  mediaListEntry: AstraRatingEntry | null;
}

export interface IRatingInitialData {
  media: AstraRatingMedia;
  allCustomLists: string[];
  /** Explicit durable date edits for a remote entry that may not exist yet. */
  pendingDates?: Pick<AstraWork, 'startedAt' | 'completedAt'>;
  /** Latest queued list fields for a new entry that has not reached AniList yet. */
  pendingListState?: AstraPendingListState;
  pendingDeletion?: boolean;
  /** A queued ASTRA_SAVE for this entry still carries score or notes: the local report is newer than AniList. */
  pendingReport?: boolean;
  /** Latest queued AniList score (0-100 scale; null clears it) for this entry that has not reached AniList yet. */
  pendingScore?: number | null;
}

/** Durable AniList list-field intent that must take precedence over a stale remote read. */
export interface AstraPendingListState {
  status?: MediaListStatus;
  progress?: number;
  repeat?: number;
  private?: boolean;
  hidden?: boolean;
  customLists?: string[];
  startedAt?: AniListDate | null;
  completedAt?: AniListDate | null;
}

/**
 * Interface for the Rating Service.
 * Decouples the UI controllers from API and persistence implementations.
 */
export interface IAstraRatingService {
  /** Durably remove the AniList entry and its account-scoped Astra data. */
  deleteEntry(mediaId: number): Promise<'synced' | 'queued'>;
  /**
   * Fetches data for a media entry (notes, score, etc).
   */
  getMediaRatingData(mediaId: number): Promise<IRatingInitialData | null>;

  /**
   * Increments or sets progress for a media entry.
   */
  updateProgress(mediaId: number, progress?: number): Promise<AstraProgressResult>;

  /**
   * Saves work locally and pushes to AniList.
   */
  saveAndSync(work: AstraWork, extra: AstraSaveOptions): Promise<AstraSaveResult>;
}
