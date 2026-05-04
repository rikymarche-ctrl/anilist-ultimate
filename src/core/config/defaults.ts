/**
 * @file defaults.ts
 * @description Default application configuration values
 *
 * Provides DEFAULT_CONFIG used when no persisted configuration exists.
 * Includes sensible defaults for all feature flags, API rate limits,
 * OAuth credentials, calendar preferences, and cache durations.
 *
 * @see types.ts for the AppConfig interface
 * @see ConfigManager.ts for deep-merge with stored config
 */

import type { AppConfig } from './types';

/**
 * Default application configuration
 * These values are used when no stored configuration exists
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',

  features: {
    calendar: true,
    hoverComments: true,
    notificationCleaner: true,
    reviewEnhancer: true,
    friendActivity: true,
    listEditor: true,
    socialActivity: true,
    forumEnhancer: true,
    activityScore: true,
    webComponents: true,
    virtualScroll: true,
    mediaMetadata: true,
    mediaMusic: true,
    astra: true,
  },

  debug: {
    enabled: true,
    logLevel: 'info',
  },

  api: {
    endpoint: 'https://graphql.anilist.co',
    timeout: 10000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    rateLimit: {
      maxRequestsPerMinute: 90,
      requestDelayMs: 700,
      maxConcurrent: 2,
    },
  },

  oauth: {
    clientId: '17661',
    redirectUri: 'https://anilist.co/api/v2/oauth/pin',
    authUrl: 'https://anilist.co/api/v2/oauth/authorize',
    responseType: 'token',
  },

  calendar: {
    startDay: '1', // Monday
    hideEmptyDays: false,
    layoutMode: 'standard',
    timeFormat: 'countdown',
    showTime: true,
    showEpisodeNumbers: true,
    titleAlignment: 'center',
    columnJustify: 'top',
    maxCardsPerDay: 0,
    fullWidthImages: false,
    openInNewTab: false,
    socialEnabled: true,
    socialShowAvatars: true,
  },

  cache: {
    scheduleDuration: 30 * 60 * 1000, // 30 minutes
    progressDuration: 5 * 60 * 1000, // 5 minutes
  },
  theme: {
    accentColor: '#8b5cf6',
  },
};
