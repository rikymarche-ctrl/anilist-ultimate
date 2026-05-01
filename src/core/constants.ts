/**
 * @file constants.ts
 * @description Global constants for the entire extension
 *
 * Contains:
 *   - App metadata (name, version)
 *   - Storage key definitions (prefixed to avoid collisions)
 *   - API configuration (endpoint, rate limits, timeouts)
 *   - OAuth configuration (client ID, redirect URI)
 *   - Time constants (cache durations, update intervals)
 *   - Calendar defaults (day names, default preferences)
 *   - UI constants (CSS classes, selectors, z-index stack)
 *   - Animation/performance tuning values
 *   - Debug configuration
 *
 * All constants are defined as `as const` for type safety and immutability.
 * Feature flags have been migrated to ConfigManager (see src/core/config/).
 */

export const APP_NAME = 'Anilist Ultimate';
export const APP_VERSION = '2.0.0';

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_PREFIX = 'anilist_ultimate_';

export const STORAGE_KEYS = {
  USER_PREFERENCES: `${STORAGE_PREFIX}user_preferences`,
  MODULE_CONFIG: `${STORAGE_PREFIX}module_config`,
  CALENDAR_PREFS: `${STORAGE_PREFIX}calendar_prefs`,
  CACHE_SCHEDULE: `${STORAGE_PREFIX}cache_schedule`,
  CACHE_PROGRESS: `${STORAGE_PREFIX}cache_progress`,
  CACHE_NOTIFICATIONS: `${STORAGE_PREFIX}cache_notifications`,
  ACCESS_TOKEN: `${STORAGE_PREFIX}access_token`,
  LAST_SYNC: `${STORAGE_PREFIX}last_sync`,
} as const;

// ============================================================================
// API Configuration
// ============================================================================

export const API_CONFIG = {
  ENDPOINT: 'https://graphql.anilist.co',
  RATE_LIMIT: {
    MAX_REQUESTS_PER_MINUTE: 90,
    REQUEST_DELAY_MS: 700,
    MAX_CONCURRENT: 2,
  },
  TIMEOUT_MS: 10000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const;

// ============================================================================
// OAuth Configuration
// ============================================================================
// NOTE: OAuth flow migrato a chrome.identity (background.ts).
//       Questi valori sono mantenuti per reference, ma il flusso OAuth
//       non li usa più direttamente dal content script.

export const OAUTH_CONFIG = {
  CLIENT_ID: '17661', // Anilist OAuth Client ID (public)
  AUTH_URL: 'https://anilist.co/api/v2/oauth/authorize',
} as const;

// ============================================================================
// Time Constants
// ============================================================================

export const TIME = {
  MINUTE_MS: 60 * 1000,
  HOUR_MS: 60 * 60 * 1000,
  DAY_MS: 24 * 60 * 60 * 1000,
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,

  // Cache durations
  CACHE_SCHEDULE_DURATION: 30 * 60 * 1000, // 30 minutes
  CACHE_PROGRESS_DURATION: 5 * 60 * 1000,  // 5 minutes

  // Update intervals
  COUNTDOWN_UPDATE_INTERVAL: 60 * 1000,    // 1 minute
  SCHEDULE_REFRESH_INTERVAL: 30 * 60 * 1000, // 30 minutes
} as const;

// ============================================================================
// Calendar Configuration
// ============================================================================

export const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const ABBREVIATED_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Media constants
export const MEDIA = {
  DEFAULT_EPISODE_DURATION_MINUTES: 24,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
} as const;

export const DEFAULT_CALENDAR_PREFERENCES = {
  startDay: '1' as const, // Monday
  hideEmptyDays: false,
  layoutMode: 'standard' as const,
  timeFormat: 'release' as const,
  showTime: true,
  showEpisodeNumbers: true,
  titleAlignment: 'center' as const,
  columnJustify: 'top' as const,
  maxCardsPerDay: 0,
  fullWidthImages: false,
  openInNewTab: false,
  socialEnabled: true,
  socialShowAvatars: true,
  showEmptyToday: true,
};

// ============================================================================
// UI Constants
// ============================================================================

export const CSS_CLASSES = {
  CONTAINER: 'anilist-ultimate-container',
  CALENDAR: 'anilist-calendar',
  CALENDAR_GRID: 'anilist-calendar-grid',
  CALENDAR_DAY: 'anilist-calendar-day',
  ANIME_CARD: 'anime-card',
  LOADING: 'loading',
  ERROR: 'error',
  HIDDEN: 'hidden',
  THEME_LIGHT: 'theme-light',
  THEME_DARK: 'theme-dark',
  THEME_CONTRAST: 'theme-contrast',
} as const;

// ============================================================================
// UI Layout Constants
// ============================================================================

export const UI_SPACING = {
  // Tooltip offsets
  TOOLTIP_OFFSET_X: 16,
  TOOLTIP_OFFSET_Y: 14,

  // Positioning
  OFFSCREEN_POSITION: -9999,

  // Z-index stack (centralized to avoid conflicts)
  Z_INDEX: {
    BASE: 1,
    DROPDOWN: 100,
    STICKY: 500,
    MODAL_BACKDROP: 1000,
    MODAL: 1001,
    CUSTOM_LIST_MENU: 1002,
    TOOLTIP: 2000,
    TOAST: 3000,
  },
} as const;

export const SELECTORS = {
  // Anilist DOM selectors
  AIRING_SECTION: '.home .section:has(.section-header:contains("Airing"))',
  SECTION_HEADER: '.section-header',
  MEDIA_CARD: '.media-preview-card, .media-card',
  COVER_IMAGE: '.cover',

  // Our selectors
  CALENDAR_CONTAINER: `#${CSS_CLASSES.CALENDAR}`,
  SETTINGS_BUTTON: '.settings-button',
} as const;

// ============================================================================
// Animation & Performance
// ============================================================================

export const ANIMATION = {
  TRANSITION_DURATION: 200,
  DEBOUNCE_DELAY: 300,
  THROTTLE_DELAY: 100,
  FADE_IN_DURATION: 200,
} as const;

export const PERFORMANCE = {
  LAZY_LOAD_THRESHOLD: '50px',
  VIRTUAL_SCROLL_THRESHOLD: 50, // Number of items before enabling virtual scroll
  IMAGE_LOAD_TIMEOUT: 5000,

  // Observer throttling
  OBSERVER_THROTTLE_MS: 200,
  OBSERVER_THROTTLE_FAST_MS: 100,

  // Polling intervals
  HOVER_COMMENTS_POLL_MS: 3000,
  URL_CHECK_INTERVAL_MS: 500,
  ELEMENT_WAIT_CHECK_MS: 300,

  // GraphQL batching
  GRAPHQL_CHUNK_SIZE_SOCIAL: 10,
  GRAPHQL_CHUNK_SIZE_ACTIVITY: 25,
  BATCH_DELAY_MS: 500,
} as const;

// ============================================================================
// Debug Configuration
// ============================================================================

export const DEBUG = {
  ENABLED: true, // Set to false in production build
  LOG_PREFIX: '[Anilist Ultimate]',
  LOG_STYLES: {
    info: 'color: #4A9EFF; font-weight: bold',
    warn: 'color: #FFB84D; font-weight: bold',
    error: 'color: #FF4D4D; font-weight: bold',
    success: 'color: #4DFF88; font-weight: bold',
  },
} as const;

// Note: Feature flags have been migrated to ConfigManager (see src/core/config/)
