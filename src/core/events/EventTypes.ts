/**
 * @file EventTypes.ts
 * @description Centralized event name constants and typed payload definitions
 *
 * Defines all events emitted in the application, organized by domain:
 *   - Module lifecycle (initialized, destroyed, error)
 *   - Calendar (loaded, updated, settings changed)
 *   - Social (friend activity, custom lists)
 *   - Activity (filter changed, search changed)
 *   - Navigation (page changed, URL changed)
 *   - Error (occurred, API error, storage error)
 *   - Config (loaded, updated, feature flag changed)
 *   - Auth (token received, expired, state changed)
 *   - Astra (open dashboard)
 *
 * The AppEventMap interface maps event names to their payload types,
 * enabling type-safe event emission and subscription through the EventBus.
 *
 * @warning The [key: string]: any index signature in AppEventMap defeats type
 *          safety for unregistered events. See docs/BUGS.md#bug-014.
 *
 * @see EventBus.ts for the pub/sub implementation
 */

import { MediaListStatus } from '@/api/AnilistTypes';

/**
 * Application Event Types
 * All events that can be emitted in the application
 */
export const EVENT_TYPES = {
  // ============================================================================
  // Module Lifecycle Events
  // ============================================================================
  MODULE_INITIALIZED: 'module:initialized',
  MODULE_DESTROYED: 'module:destroyed',
  MODULE_ERROR: 'module:error',

  // ============================================================================
  // Calendar Events
  // ============================================================================
  CALENDAR_LOADED: 'calendar:loaded',
  CALENDAR_UPDATED: 'calendar:updated',
  CALENDAR_LOADING: 'calendar:loading',
  CALENDAR_ERROR: 'calendar:error',
  CALENDAR_SETTINGS_CHANGED: 'calendar:settings-changed',
  CALENDAR_DATA_REFRESH: 'calendar:data-refresh',

  // Episode/Progress Events
  PROGRESS_UPDATED: 'calendar:progress-updated',
  EPISODE_MARKED_WATCHED: 'calendar:episode-marked-watched',

  // ============================================================================
  // Social Events
  // ============================================================================
  FRIEND_ACTIVITY_LOADED: 'social:friend-activity-loaded',
  FRIEND_ACTIVITY_UPDATED: 'social:friend-activity-updated',
  CUSTOM_LIST_CREATED: 'social:custom-list-created',
  CUSTOM_LIST_UPDATED: 'social:custom-list-updated',
  CUSTOM_LIST_DELETED: 'social:custom-list-deleted',
  USER_ADDED_TO_LIST: 'social:user-added-to-list',
  USER_REMOVED_FROM_LIST: 'social:user-removed-from-list',

  // ============================================================================
  // Activity Events
  // ============================================================================
  ACTIVITY_FILTER_CHANGED: 'activity:filter-changed',
  ACTIVITY_SEARCH_CHANGED: 'activity:search-changed',
  ACTIVITY_LOADED: 'activity:loaded',

  // ============================================================================
  // Review Events
  // ============================================================================
  REVIEW_LOADED: 'review:loaded',
  REVIEW_RATING_DISPLAYED: 'review:rating-displayed',

  // ============================================================================
  // Notification Events
  // ============================================================================
  NOTIFICATIONS_GROUPED: 'notifications:grouped',
  NOTIFICATIONS_FILTERED: 'notifications:filtered',

  // ============================================================================
  // Theme Events
  // ============================================================================
  THEME_CHANGED: 'theme:changed',
  THEME_DETECTED: 'theme:detected',

  // ============================================================================
  // Navigation Events
  // ============================================================================
  PAGE_CHANGED: 'navigation:page-changed',
  URL_CHANGED: 'navigation:url-changed',
  SPA_NAVIGATION: 'navigation:spa-navigation',

  // ============================================================================
  // Error Events
  // ============================================================================
  ERROR_OCCURRED: 'error:occurred',
  API_ERROR: 'error:api',
  STORAGE_ERROR: 'error:storage',
  MODULE_INITIALIZATION_ERROR: 'error:module-init',

  // ============================================================================
  // Configuration Events
  // ============================================================================
  CONFIG_LOADED: 'config:loaded',
  CONFIG_UPDATED: 'config:updated',
  CONFIG_CHANGED: 'config:changed',
  FEATURE_FLAG_CHANGED: 'config:feature-flag-changed',

  // ============================================================================
  // Authentication Events
  // ============================================================================
  AUTH_TOKEN_RECEIVED: 'auth:token-received',
  AUTH_TOKEN_EXPIRED: 'auth:token-expired',
  AUTH_REQUIRED: 'auth:required',
  USER_AUTHENTICATED: 'auth:user-authenticated',
  USER_LOGGED_OUT: 'auth:user-logged-out',
  AUTH_STATE_CHANGED: 'auth:state-changed',

  // ============================================================================
  // Astra Events
  // ============================================================================
  ASTRA_OPEN: 'astra:open',
  ASTRA_OPEN_MODAL: 'astra:open-modal',
  ASTRA_DATA_UPDATED: 'astra:data-updated',
  ASTRA_SAVE_NOTE: 'astra:save-note',
} as const;

/**
 * Event type definitions - allows type-safe event emissions
 */
export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// ============================================================================
// Event Payload Types
// ============================================================================

/**
 * Module Lifecycle Event Payloads
 */
export interface ModuleInitializedEvent {
  moduleName: string;
  timestamp: Date;
}

export interface ModuleDestroyedEvent {
  moduleName: string;
  timestamp: Date;
}

export interface ModuleErrorEvent {
  moduleName: string;
  error: Error;
  context?: string;
}

/**
 * Calendar Event Payloads
 */
export interface CalendarLoadedEvent {
  entries: any[];
  timestamp: Date;
  entryCount: number;
}

export interface CalendarUpdatedEvent {
  entries: any[];
  timestamp: Date;
}

export interface ProgressUpdatedEvent {
  mediaId: number;
  progress: number;
  previousProgress: number;
  userId: number;
  status?: MediaListStatus;
}

export interface EpisodeMarkedWatchedEvent {
  mediaId: number;
  episodeNumber: number;
  userId: number;
  timestamp: Date;
}

/**
 * Social Event Payloads
 */
export interface FriendActivityLoadedEvent {
  mediaId: number;
  activities: any[];
  count: number;
}

export interface CustomListUpdatedEvent {
  listName: string;
  userIds: number[];
  action: 'created' | 'updated' | 'deleted';
}

export interface UserListChangeEvent {
  userId: number;
  userName: string;
  listName: string;
  action: 'added' | 'removed';
}

/**
 * Activity Event Payloads
 */
export interface ActivityFilterChangedEvent {
  filters: Set<string>;
  previousFilters: Set<string>;
}

export interface ActivitySearchChangedEvent {
  query: string;
  previousQuery: string;
}

/**
 * Theme Event Payloads
 */
export interface ThemeChangedEvent {
  theme: 'light' | 'dark' | 'contrast';
  previousTheme?: 'light' | 'dark' | 'contrast';
}

/**
 * Navigation Event Payloads
 */
export interface PageChangedEvent {
  path: string;
  previousPath: string;
  timestamp: Date;
}

export interface URLChangedEvent {
  url: string;
  previousUrl: string;
}

/**
 * Error Event Payloads
 */
export interface ErrorEvent {
  error: Error;
  context: string;
  module?: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface APIErrorEvent extends ErrorEvent {
  statusCode?: number;
  endpoint?: string;
  retryCount?: number;
}

/**
 * Configuration Event Payloads
 */
export interface ConfigUpdatedEvent {
  key: string;
  value: any;
  previousValue?: any;
}

export interface FeatureFlagChangedEvent {
  feature: string;
  enabled: boolean;
  previousValue: boolean;
}

/**
 * Authentication Event Payloads
 */
export interface AuthTokenReceivedEvent {
  token: string;
  timestamp: Date;
}

export interface UserAuthenticatedEvent {
  userId: number;
  userName: string;
  timestamp: Date;
}

export interface AstraSaveNoteEvent {
  mediaId: number;
  episode: number;
  notes: string;
}

/**
 * AppEventMap - Centralized mapping of events to payloads
 */
export interface AppEventMap {
  [EVENT_TYPES.MODULE_INITIALIZED]: ModuleInitializedEvent;
  [EVENT_TYPES.MODULE_DESTROYED]: ModuleDestroyedEvent;
  [EVENT_TYPES.MODULE_ERROR]: ModuleErrorEvent;

  [EVENT_TYPES.CALENDAR_LOADED]: CalendarLoadedEvent;
  [EVENT_TYPES.CALENDAR_UPDATED]: CalendarUpdatedEvent;
  [EVENT_TYPES.CALENDAR_LOADING]: undefined;
  [EVENT_TYPES.CALENDAR_ERROR]: { error: any };
  [EVENT_TYPES.CALENDAR_SETTINGS_CHANGED]: any;
  [EVENT_TYPES.CALENDAR_DATA_REFRESH]: undefined;

  [EVENT_TYPES.PROGRESS_UPDATED]: ProgressUpdatedEvent;
  [EVENT_TYPES.EPISODE_MARKED_WATCHED]: EpisodeMarkedWatchedEvent;

  [EVENT_TYPES.FRIEND_ACTIVITY_LOADED]: FriendActivityLoadedEvent;
  [EVENT_TYPES.FRIEND_ACTIVITY_UPDATED]: FriendActivityLoadedEvent;
  [EVENT_TYPES.CUSTOM_LIST_CREATED]: CustomListUpdatedEvent;
  [EVENT_TYPES.CUSTOM_LIST_UPDATED]: CustomListUpdatedEvent;
  [EVENT_TYPES.CUSTOM_LIST_DELETED]: { listName: string };
  [EVENT_TYPES.USER_ADDED_TO_LIST]: UserListChangeEvent;
  [EVENT_TYPES.USER_REMOVED_FROM_LIST]: UserListChangeEvent;

  [EVENT_TYPES.ACTIVITY_FILTER_CHANGED]: ActivityFilterChangedEvent;
  [EVENT_TYPES.ACTIVITY_SEARCH_CHANGED]: ActivitySearchChangedEvent;
  [EVENT_TYPES.ACTIVITY_LOADED]: { count: number };

  [EVENT_TYPES.REVIEW_LOADED]: { id: number; score: number };
  [EVENT_TYPES.REVIEW_RATING_DISPLAYED]: { id: number };

  [EVENT_TYPES.NOTIFICATIONS_GROUPED]: { count: number };
  [EVENT_TYPES.NOTIFICATIONS_FILTERED]: { query: string; results: number };

  [EVENT_TYPES.THEME_CHANGED]: ThemeChangedEvent;
  [EVENT_TYPES.THEME_DETECTED]: { theme: string };

  [EVENT_TYPES.PAGE_CHANGED]: PageChangedEvent;
  [EVENT_TYPES.URL_CHANGED]: URLChangedEvent;
  [EVENT_TYPES.SPA_NAVIGATION]: { path: string };

  [EVENT_TYPES.ERROR_OCCURRED]: ErrorEvent;
  [EVENT_TYPES.API_ERROR]: APIErrorEvent;
  [EVENT_TYPES.STORAGE_ERROR]: { error: any; key?: string };
  [EVENT_TYPES.MODULE_INITIALIZATION_ERROR]: { moduleName: string; error: any };

  [EVENT_TYPES.CONFIG_LOADED]: { config: any };
  [EVENT_TYPES.CONFIG_UPDATED]: ConfigUpdatedEvent;
  [EVENT_TYPES.CONFIG_CHANGED]: { key: string; value: any };
  [EVENT_TYPES.FEATURE_FLAG_CHANGED]: FeatureFlagChangedEvent;

  [EVENT_TYPES.AUTH_TOKEN_RECEIVED]: AuthTokenReceivedEvent;
  [EVENT_TYPES.AUTH_TOKEN_EXPIRED]: undefined;
  [EVENT_TYPES.AUTH_REQUIRED]: undefined;
  [EVENT_TYPES.USER_AUTHENTICATED]: UserAuthenticatedEvent;
  [EVENT_TYPES.USER_LOGGED_OUT]: undefined;
  [EVENT_TYPES.AUTH_STATE_CHANGED]: { isAuthenticated: boolean; userId?: number; timestamp: Date };

  [EVENT_TYPES.ASTRA_OPEN]: undefined;
  [EVENT_TYPES.ASTRA_OPEN_MODAL]: { mediaId: number };
  [EVENT_TYPES.ASTRA_DATA_UPDATED]: { mediaId?: number; timestamp: Date };
  [EVENT_TYPES.ASTRA_SAVE_NOTE]: AstraSaveNoteEvent;
}
