/**
 * @file types.ts
 * @description TypeScript interfaces for the application configuration system
 *
 * Defines the full AppConfig shape and its nested sub-interfaces:
 *   - FeatureFlags: runtime-toggleable module switches
 *   - DebugConfig: logging level and enable flag
 *   - APIConfig: endpoint, timeout, retry, and rate-limit settings
 *   - OAuthConfig: AniList OAuth implicit grant parameters
 *   - CalendarPreferences: layout, display, and social settings
 *   - CacheConfig: schedule and progress cache TTLs
 *
 * @see defaults.ts for the DEFAULT_CONFIG values
 * @see ConfigManager.ts for persistence and change notifications
 */

/**
 * Feature Flags - Runtime toggleable features
 */
export interface FeatureFlags {
  calendar: boolean;
  hoverComments: boolean;
  notificationCleaner: boolean;
  reviewEnhancer: boolean;
  friendActivity: boolean;
  listEditor: boolean;
  socialActivity: boolean;
  forumEnhancer: boolean;
  activityScore: boolean;
  webComponents: boolean;
  virtualScroll: boolean;
  mediaMetadata: boolean;
}

/**
 * Debug Configuration
 */
export interface DebugConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * API Configuration
 */
export interface APIConfig {
  endpoint: string;
  timeout: number;
  retryAttempts: number;
  retryDelayMs: number;
  rateLimit: {
    maxRequestsPerMinute: number;
    requestDelayMs: number;
    maxConcurrent: number;
  };
}

/**
 * OAuth Configuration
 */
export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  authUrl: string;
  responseType: string;
}

/**
 * Calendar Preferences
 */
export interface CalendarPreferences {
  startDay: string;
  hideEmptyDays: boolean;
  layoutMode: 'standard' | 'compact' | 'extended';
  timeFormat: 'release' | 'countdown';
  showTime: boolean;
  showEpisodeNumbers: boolean;
  titleAlignment: 'left' | 'center' | 'right';
  columnJustify: 'top' | 'center' | 'bottom';
  maxCardsPerDay: number;
  fullWidthImages: boolean;
  openInNewTab: boolean;
  socialEnabled: boolean;
  socialShowAvatars: boolean;
}

/**
 * Cache Configuration
 */
export interface CacheConfig {
  scheduleDuration: number; // milliseconds
  progressDuration: number; // milliseconds
}

/**
 * Complete Application Configuration
 */
export interface AppConfig {
  version: string;
  features: FeatureFlags;
  debug: DebugConfig;
  api: APIConfig;
  oauth: OAuthConfig;
  calendar: CalendarPreferences;
  cache: CacheConfig;
}

/**
 * Configuration change callback
 */
export type ConfigChangeCallback<K extends keyof AppConfig> = (
  newValue: AppConfig[K],
  oldValue?: AppConfig[K]
) => void;
