/**
 * @file types.ts
 * @description Central type definitions shared across the entire application
 *
 * Organized by domain:
 *   - Anime & Media types (AnimeEntry, FriendActivity, MediaProgress)
 *   - Calendar types (CalendarState, CalendarPreferences, layout modes)
 *   - Module configuration (ModuleConfig, UserPreferences)
 *   - Storage types (StorageArea, StorageItem)
 *   - API types (GraphQLResponse, AiringScheduleResponse, MediaListResponse)
 *   - UI Component types (ComponentProps, CardOptions)
 *   - Theme types (Theme, ThemeState)
 *   - Logger types (LogLevel, LoggerConfig)
 *   - Score types (ScoreFormat)
 *   - Social types (SocialActivityDetailed, SocialFilter)
 *
 * @see docs/ARCHITECTURE.md#type-system
 */

// ============================================================================
// Anime & Media Types
// ============================================================================

export interface AnimeEntry {
  id: number;
  mediaId: number;
  title: string;
  cleanTitle: string;
  episode: number;
  airingAt: Date;
  timeUntilAiring: number;
  coverImage: string;
  siteUrl: string;
  progress: number;
  totalEpisodes: number | null;
  dayOfWeek: string;
  friendActivity?: FriendActivity[];
}

export interface FriendActivity {
  id: number;
  status: MediaListStatus;
  progress: number;
  score: number;
  user: {
    id: number;
    name: string;
    avatar: {
      medium: string;
    };
  };
}

export interface MediaProgress {
  mediaId: number;
  progress: number;
  status: MediaListStatus;
}

import { MediaListStatus } from '@/api/AnilistTypes';
import type { MediaType } from '@/api/AnilistTypes';
export { MediaListStatus };
export type { MediaType };

// ============================================================================
// Calendar Types
// ============================================================================

export type LayoutMode = 'standard' | 'compact' | 'extended';

export type TimeFormat = 'release' | 'countdown';

export type TitleAlignment = 'left' | 'center';

export type ColumnJustify = 'top' | 'center';

export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export type StartDayOption = 'today' | '0' | '1' | '2' | '3' | '4' | '5' | '6';

export interface CalendarState {
  entries: AnimeEntry[];
  loading: boolean;
  error: Error | null;
  lastUpdate: Date | null;
}

export interface CalendarPreferences {
  startDay: StartDayOption;
  hideEmptyDays: boolean;
  layoutMode: LayoutMode;
  timeFormat: TimeFormat;
  showTime: boolean;
  showEpisodeNumbers: boolean;
  titleAlignment: TitleAlignment;
  columnJustify: ColumnJustify;
  maxCardsPerDay: number;
  fullWidthImages: boolean;
  openInNewTab: boolean;
  socialEnabled: boolean;
  socialShowAvatars: boolean;
  showEmptyToday: boolean;
}

// ============================================================================
// Module Configuration
// ============================================================================

export interface ModuleConfig {
  calendar: boolean;
  hoverComments: boolean;
  notificationCleaner: boolean;
  reviewEnhancer: boolean;
  friendActivity: boolean;
  listEditor: boolean;
  socialActivity: boolean;
  forumEnhancer: boolean;
  activityScore: boolean;
}

export interface UserPreferences {
  modules: ModuleConfig;
  calendar: CalendarPreferences;
}

// ============================================================================
// Storage Types
// ============================================================================

export type StorageArea = 'sync' | 'local';

export interface StorageItem<T> {
  key: string;
  value: T;
  timestamp?: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface GraphQLResponse<T> {
  data: T;
  errors?: GraphQLError[];
}

export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
  extensions?: Record<string, any>;
}

export interface AiringScheduleResponse {
  Page: {
    airingSchedules: Array<{
      id: number;
      airingAt: number;
      episode: number;
      mediaId: number;
      media: {
        id: number;
        title: {
          romaji: string;
          english: string | null;
          native: string;
        };
        coverImage: {
          large: string;
          medium: string;
        };
        siteUrl: string;
      };
    }>;
  };
}

export interface MediaListResponse {
  MediaListCollection: {
    lists: Array<{
      entries: Array<{
        id: number;
        mediaId: number;
        progress: number;
        status: MediaListStatus;
        media: {
          id: number;
          title: {
            romaji: string;
            english: string | null;
            native: string;
          };
          coverImage: {
            large: string;
            medium: string;
            color: string | null;
          };
          siteUrl: string;
          format: string;
          status: string;
          episodes: number | null;
          nextAiringEpisode: {
            airingAt: number;
            timeUntilAiring: number;
            episode: number;
          } | null;
        };
      }>;
    }>;
  };
}

// ============================================================================
// UI Component Types
// ============================================================================

export interface ComponentProps {
  className?: string;
  id?: string;
  [key: string]: any;
}

export interface CardOptions {
  layoutMode: LayoutMode;
  showTime: boolean;
  showEpisodeNumbers: boolean;
  timeFormat: TimeFormat;
  fullWidthImages: boolean;
  titleAlignment: TitleAlignment;
  columnJustify: ColumnJustify;
  maxCardsPerDay: number;
  openInNewTab: boolean;
  astraEnabled: boolean;
  onMarkWatched?: (mediaId: number) => void;
  onClick?: (mediaId: number) => void;
}

// ============================================================================
// Theme Types
// ============================================================================

export type Theme = 'light' | 'dark' | 'contrast';

export interface ThemeState {
  current: Theme;
  isHighContrast: boolean;
}

// ============================================================================
// Logger Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
  prefix: string;
}
import { ScoreFormat } from '@/api/AnilistTypes';
export type { ScoreFormat };

export interface SocialActivityDetailed {
  id: number;
  status: MediaListStatus;
  progress: number;
  score: number;
  notes: string | null;
  updatedAt: number;
  user: {
    id: number;
    name: string;
    avatar: {
      medium: string;
    };
    mediaListOptions: {
      scoreFormat: ScoreFormat;
    };
  };
}

export type SocialFilter = 'following' | 'global' | 'self' | 'friends';
