/**
 * Anilist Ultimate - Main Entry Point
 * Modern TypeScript rewrite - Stabilized Static Version
 */

import { log } from '@core/logger';
import { APP_VERSION, FEATURE_FLAGS, DEBUG } from '@core/constants';
import { storage } from '@core/storage/StorageManager';
import { ThemeManager } from '@core/ThemeManager';
import type { UserPreferences } from '@core/types';

// Static Module Imports (Eliminating dynamic import failures in content script)
import { CalendarModule } from '@/modules/calendar/CalendarModule';
import { HoverCommentsModule } from '@/modules/social/HoverCommentsModule';
import { NotificationCleanerModule } from '@/modules/notifications/NotificationCleanerModule';
import { ReviewEnhancerModule } from '@/modules/reviews/ReviewEnhancerModule';
import { ActivityEnhancerModule } from '@/modules/activity/ActivityEnhancerModule';
import { ForumEnhancerModule } from '@/modules/forum/ForumEnhancerModule';
import { ActivityScoreModule } from '@/modules/activity/ActivityScoreModule';
import { SocialActivityModule } from '@/modules/social/SocialActivityModule';
import { SocialEnhancerModule } from './modules/social/SocialEnhancerModule';

// Styles
import './styles/main.css';
import './styles/social-activity.css';

/**
 * Initialize the global debug object
 */
function setupDebugExposure(): void {
  try {
    (window as any).AnilistUltimate = {
      version: APP_VERSION,
      log,
      storage,
      modules: {}
    };
  } catch (e) {
    // Silent fail if window access restricted
  }
}

/**
 * Check for OAuth callback and save token
 */
function checkOAuthCallback(): void {
  if (window.location.hash && window.location.hash.includes('access_token')) {
    try {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = params.get('access_token');
      if (accessToken) {
        log.info('OAuth token received');
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('jwt', accessToken);
        history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
    } catch (error) {
      log.error('OAuth processing failed', error);
    }
  }
}

/**
 * Initialize the extension
 */
async function init(): Promise<void> {
  console.log(`[Anilist Ultimate] Starting v${APP_VERSION}...`);

  try {
    setupDebugExposure();
    checkOAuthCallback();
    ThemeManager.getInstance();
    
    // Load FA icons manually if needed
    if (!document.querySelector('link[href*="fontawesome"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }

    const preferences = await loadPreferences();
    log.debug('Preferences', preferences);

    // Initialize modules synchronously
    await initializeModules(preferences);

    log.success('Extension fully loaded');
  } catch (error) {
    console.error('[Anilist Ultimate] Fatal Error:', error);
  }
}

/**
 * Load preferences
 */
async function loadPreferences(): Promise<UserPreferences> {
  const stored = await storage.get<UserPreferences>('user_preferences');
  return stored || {
    modules: {
      calendar: true,
      hoverComments: true,
      notificationCleaner: true,
      reviewEnhancer: true,
      friendActivity: true,
      listEditor: true,
      socialActivity: true,
      forumEnhancer: true,
      activityScore: true,
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
      socialEnabled: true,
      socialShowAvatars: true,
    },
  };
}

/**
 * Initialize modules
 */
async function initializeModules(preferences: UserPreferences): Promise<void> {
  const instances: any = {};

  // Calendar
  if (preferences.modules.calendar && FEATURE_FLAGS.ENABLE_CALENDAR) {
    try {
      instances.calendar = new CalendarModule();
      await instances.calendar.init();
    } catch (e) { log.error('Module Error: Calendar', e); }
  }

  // Hover Comments
  if (preferences.modules.hoverComments && FEATURE_FLAGS.ENABLE_HOVER_COMMENTS) {
    try {
      instances.hoverComments = new HoverCommentsModule();
      await instances.hoverComments.init();
    } catch (e) { log.error('Module Error: HoverComments', e); }
  }

  // Notification Cleaner
  if (preferences.modules.notificationCleaner && FEATURE_FLAGS.ENABLE_NOTIFICATION_CLEANER) {
    try {
      instances.notifications = new NotificationCleanerModule();
      await instances.notifications.init();
    } catch (e) { log.error('Module Error: Notifications', e); }
  }

  // Review Enhancer
  if (preferences.modules.reviewEnhancer && FEATURE_FLAGS.ENABLE_REVIEW_ENHANCER) {
    try {
      instances.reviews = new ReviewEnhancerModule();
      await instances.reviews.init();
    } catch (e) { log.error('Module Error: Reviews', e); }
  }

  // Activity Enhancer
  if (preferences.modules.socialActivity && FEATURE_FLAGS.ENABLE_SOCIAL_ACTIVITY) {
    try {
      instances.activity = new ActivityEnhancerModule();
      await instances.activity.init();
    } catch (e) { log.error('Module Error: Activity', e); }
  }

  // Forum Enhancer
  if (preferences.modules.forumEnhancer && FEATURE_FLAGS.ENABLE_FORUM_ENHANCER) {
    try {
      instances.forum = new ForumEnhancerModule();
      await instances.forum.init();
    } catch (e) { log.error('Module Error: Forum', e); }
  }

  // Activity Score
  if (preferences.modules.activityScore && FEATURE_FLAGS.ENABLE_ACTIVITY_SCORE) {
    try {
      instances.activityScore = new ActivityScoreModule();
      await instances.activityScore.init();
    } catch (e) { log.error('Module Error: ActivityScore', e); }
  }

  // Social Activity (Sidebar & Avatars)
  if (preferences.modules.friendActivity && FEATURE_FLAGS.ENABLE_FRIEND_ACTIVITY) {
    try {
      instances.socialActivity = new SocialActivityModule();
      await instances.socialActivity.init();
      await new SocialEnhancerModule().init();
    } catch (e) { log.error('Module Error: SocialActivity', e); }
  }

  // Exposure
  if (DEBUG.ENABLED && (window as any).AnilistUltimate) {
    (window as any).AnilistUltimate.modules = instances;
  }
}

// Global start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
