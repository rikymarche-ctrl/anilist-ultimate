/**
 * Event Type Definitions
 * Centralized event names and payload types
 */

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
