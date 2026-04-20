/**
 * Anilist Ultimate - Main Entry Point
 * Modern TypeScript rewrite
 */

import { log } from '@core/logger';
import { APP_NAME, APP_VERSION, FEATURE_FLAGS } from '@core/constants';
import { storage } from '@core/storage/StorageManager';
import { ThemeManager } from '@core/ThemeManager';
import type { UserPreferences } from '@core/types';

// Styles
import './styles/main.css';

/**
 * Check for OAuth callback and save token
 */
function checkOAuthCallback(): void {
  if (window.location.hash && window.location.hash.includes('access_token')) {
    try {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = params.get('access_token');

      if (accessToken) {
        log.info('OAuth token received via URL callback');
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('jwt', accessToken); // Backup for compatibility
        sessionStorage.setItem('access_token', accessToken);

        // Clean the URL
        history.replaceState(null, document.title, window.location.pathname + window.location.search);
        log.success('Authentication successful!');
      }
    } catch (error) {
      log.error('Failed to process OAuth callback', error);
    }
  }
}

/**
 * Initialize the extension
 */
async function init(): Promise<void> {
  log.group(`${APP_NAME} v${APP_VERSION} - Initializing`, false);

  try {
    // Check for OAuth callback first
    checkOAuthCallback();

    // Initialize Theme Manager early to prevent flash of wrong theme
    ThemeManager.getInstance();

    // Load Global Styles (Main, Comments, FontAwesome)
    loadGlobalStyles();

    // Load user preferences
    const preferences = await loadPreferences();
    log.info('User preferences loaded', preferences);

    // Initialize enabled modules
    const modules = await initializeModules(preferences);

    log.success('Initialization complete');

    // Expose modules for debugging
    if (DEBUG.ENABLED) {
      (window as any).AnilistUltimate.hoverComments = modules.hoverCommentsModule;
    }
  } catch (error) {
    log.error('Initialization failed', error);
  } finally {
    log.groupEnd();
  }
}

/**
 * Load user preferences from storage
 */
async function loadPreferences(): Promise<UserPreferences> {
  const stored = await storage.get<UserPreferences>('user_preferences');

  // Return stored preferences or defaults
  return (
    stored || {
      modules: {
        calendar: true,
        hoverComments: true,
        notificationCleaner: true,
        reviewEnhancer: true,
        friendActivity: false,
        listEditor: false,
        socialActivity: false,
      },
      calendar: {
        startDay: '1',
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
      },
    }
  );
}

/**
 * Initialize enabled modules
 */
async function initializeModules(preferences: UserPreferences): Promise<any> {
  log.info('Initializing modules...');

  // Calendar Module
  if (preferences.modules.calendar && FEATURE_FLAGS.ENABLE_CALENDAR) {
    log.info('📅 Calendar module enabled');
    try {
      const { CalendarModule } = await import('@/modules/calendar/CalendarModule');
      const calendarModule = new CalendarModule();
      await calendarModule.init();
    } catch (error) {
      log.error('Failed to initialize calendar module', error);
    }
  } else {
    log.debug('Calendar module disabled');
  }

  // Hover Comments Module
  let hoverCommentsModuleInstance: any = null;
  if (preferences.modules.hoverComments && FEATURE_FLAGS.ENABLE_HOVER_COMMENTS) {
    log.info('💬 Hover Comments module enabled');
    try {
      const { HoverCommentsModule } = await import('@/modules/social/HoverCommentsModule');
      hoverCommentsModuleInstance = new HoverCommentsModule();
      await hoverCommentsModuleInstance.init();
    } catch (error) {
      log.error('Failed to initialize hover comments module', error);
    }
  }

  // Notification Cleaner Module (Anti-spam)
  if (preferences.modules.notificationCleaner && FEATURE_FLAGS.ENABLE_NOTIFICATION_CLEANER) {
    log.info('🧹 Notification Cleaner module enabled');
    try {
      const { NotificationCleanerModule } = await import('@/modules/notifications/NotificationCleanerModule');
      const notificationCleanerModule = new NotificationCleanerModule();
      await notificationCleanerModule.init();
    } catch (error) {
      log.error('Failed to initialize notification cleaner module', error);
    }
  }

  // Review Enhancer Module
  if (preferences.modules.reviewEnhancer && FEATURE_FLAGS.ENABLE_REVIEW_ENHANCER) {
    log.info('⭐ Review Enhancer module enabled');
    try {
      const { ReviewEnhancerModule } = await import('@/modules/reviews/ReviewEnhancerModule');
      const reviewEnhancerModule = new ReviewEnhancerModule();
      await reviewEnhancerModule.init();
    } catch (error) {
      log.error('Failed to initialize review enhancer module', error);
    }
  }

  return { hoverCommentsModule: hoverCommentsModuleInstance };
}

/**
 * Wait for DOM to be ready
 */
function waitForDOM(): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Check if we're on the correct page
 */
function shouldInitialize(): boolean {
  const hostname = window.location.hostname;
  const isAnilist = hostname === 'anilist.co' || hostname.endsWith('.anilist.co');

  if (!isAnilist) {
    log.debug('Not on Anilist, skipping initialization');
    return false;
  }

  return true;
}

/**
 * Load FontAwesome icons
 */
function loadGlobalStyles(): void {
  if (document.querySelector('link[href*="fontawesome"]')) {
    log.debug('FontAwesome already loaded');
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);

  log.info('FontAwesome loaded');
}

/**
 * Main execution
 */
(async () => {
  try {
    // Wait for DOM
    await waitForDOM();

    // Check if we should initialize
    if (!shouldInitialize()) {
      return;
    }

    // Initialize the extension
    await init();

    // Log successful load
    log.success(`${APP_NAME} v${APP_VERSION} loaded successfully!`);
  } catch (error) {
    log.error('Fatal error during initialization', error);
  }
})();

// Export for debugging
import { DEBUG } from '@core/constants';

if (DEBUG.ENABLED) {
  (window as any).AnilistUltimate = {
    version: APP_VERSION,
    log,
    storage,
  };
}
