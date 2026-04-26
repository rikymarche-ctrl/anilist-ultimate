/**
 * TypeScript interfaces for AniList GraphQL API responses
 * Auto-generated from AniList GraphQL schema
 */

// ============================================================================
// Common Types
// ============================================================================

export interface AniListDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface AniListTitle {
  romaji?: string;
  english?: string;
  native?: string;
  userPreferred: string;
}

export interface AniListCoverImage {
  large?: string;
  extraLarge?: string;
  medium?: string;
  color?: string;
}

export interface AniListUser {
  id: number;
  name: string;
  avatar?: {
    medium?: string;
    large?: string;
  };
}

// ============================================================================
// Media Types
// ============================================================================

export type MediaType = 'ANIME' | 'MANGA';
export type MediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | 'MANGA' | 'NOVEL' | 'ONE_SHOT';
export type MediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type MediaListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

export interface AniListMediaListEntry {
  status: MediaListStatus;
  progress: number;
  score: number;
  notes?: string;
  repeat?: number;
  private?: boolean;
  hiddenFromStatusLists?: boolean;
  startedAt?: AniListDate;
  completedAt?: AniListDate;
  customLists?: Record<string, boolean> | string[];
}

export interface AniListNextAiringEpisode {
  episode: number;
  airingAt: number;
  timeUntilAiring: number;
}

export interface AniListMedia {
  id: number;
  title: AniListTitle;
  type: MediaType;
  format?: MediaFormat;
  episodes?: number | null;
  chapters?: number | null;
  duration?: number | null;
  status?: MediaStatus;
  countryOfOrigin?: string;
  nextAiringEpisode?: AniListNextAiringEpisode;
  coverImage: AniListCoverImage;
  genres?: string[];
  siteUrl?: string;
  mediaListEntry?: AniListMediaListEntry | null;
}

// ============================================================================
// MediaList Types
// ============================================================================

export interface AniListMediaListOptions {
  animeList?: {
    customLists?: string[];
  };
  mangaList?: {
    customLists?: string[];
  };
}

export interface AniListViewer {
  id: number;
  name?: string;
  mediaListOptions?: AniListMediaListOptions;
}

// ============================================================================
// Collection Types
// ============================================================================

export interface AniListMediaListItem {
  id: number;
  mediaId: number;
  status: MediaListStatus;
  progress: number;
  progressVolumes?: number;
  score: number;
  repeat: number;
  priority: number;
  private: boolean;
  notes?: string;
  hiddenFromStatusLists: boolean;
  customLists?: Record<string, boolean>;
  startedAt?: AniListDate;
  completedAt?: AniListDate;
  updatedAt: number;
  createdAt: number;
  media: AniListMedia;
  user: AniListUser;
}

export interface AniListMediaListGroup {
  name: string;
  isCustomList: boolean;
  isSplitCompletedList: boolean;
  status?: MediaListStatus;
  entries: AniListMediaListItem[];
}

export interface AniListMediaListCollection {
  lists: AniListMediaListGroup[];
  user: AniListUser;
  hasNextChunk: boolean;
}

// ============================================================================
// Query Response Types
// ============================================================================

/**
 * Response for fetching media with viewer data
 * Used in: AstraRatingModal.fetchAniListData
 */
export interface MediaWithViewerResponse {
  Media: AniListMedia;
  Viewer?: AniListViewer;
}

/**
 * Response for fetching user's media list collection
 * Used in: AstraService.syncWithAniList, CalendarService
 */
export interface MediaListCollectionResponse {
  MediaListCollection: AniListMediaListCollection;
}

/**
 * Response for fetching single media list entry
 * Used in: CalendarService.updateProgress
 */
export interface SaveMediaListEntryResponse {
  SaveMediaListEntry: AniListMediaListItem;
}

/**
 * Response for batched media list queries
 * Used in: SocialService.getFriendActivityBatch
 */
export interface MediaListResponse {
  mediaList: Array<{
    user: AniListUser;
    status: MediaListStatus;
    progress: number;
    score: number;
  }> | null;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Generic GraphQL response wrapper
 */
export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}
