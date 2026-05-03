/**
 * @file setup.ts
 * @description DI Container Configuration and Service Registration
 *
 * This file is the composition root of the application. It registers all
 * services, modules, and infrastructure components in the tsyringe DI container.
 *
 * Registration order matters:
 *   1. Core infrastructure (Logger, Storage, EventBus, Config, ErrorHandler)
 *   2. API layer (AnilistClient)
 *   3. Auth services (AuthTokenService)
 *   4. Theme management
 *   5. Feature services (Calendar, Social, Activity, Notification, Astra)
 *   6. Critical service initialization (Config load, ErrorHandler setup, Toast, Navigation)
 *   7. Module registration in ModuleRegistry
 *
 * Each module is registered with metadata including:
 *   - name: unique identifier
 *   - enabled: feature flag from ConfigManager
 *   - factory: lazy factory function that resolves from DI container
 *   - pageMatch: optional URL matcher to restrict module to specific pages
 *
 * @see docs/ARCHITECTURE.md#41-dependency-injection
 */

import 'reflect-metadata'; // Required for tsyringe
import { container } from '@core/di/container';
import { ReviewService } from './modules/reviews/ReviewService';
import { TOKENS } from '@core/di/tokens';

// Core Infrastructure
import { EventBus } from '@core/events/EventBus';
import { ConfigManager } from '@core/config/ConfigManager';
import { ErrorHandler } from '@core/errors/ErrorHandler';
import { ModuleRegistry } from '@core/modules/ModuleRegistry';
import { NavigationService } from '@core/navigation/NavigationService';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { IConfigManager } from '@core/interfaces/IConfigManager';

// Core Services
import { AnilistClient } from '@/api/AnilistClient';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { StorageManager } from '@core/storage/StorageManager';
import { logger } from '@core/logger';
import { ThemeManager } from '@core/ThemeManager';
import { AuthTokenService } from '@core/auth/AuthTokenService';
import { AuthService } from '@core/auth/AuthService';
import { ToastService } from '@core/services/ToastService';

// Feature Services
import { CalendarService } from '@/modules/calendar/CalendarService';
import { CalendarDomService } from '@/modules/calendar/services/CalendarDomService';
import { CalendarDataService } from '@/modules/calendar/services/CalendarDataService';
import { CalendarSocialService } from '@/modules/calendar/services/CalendarSocialService';
import { SocialService } from '@/modules/social/SocialService';
import { ActivityService } from '@/modules/activity/ActivityService';
import { NotificationFetchService } from '@/modules/notifications/services/NotificationFetchService';
import { NotificationGroupService } from '@/modules/notifications/services/NotificationGroupService';
import { NotificationFilterService } from '@/modules/notifications/services/NotificationFilterService';

// Modules
import { CalendarModule } from '@/modules/calendar/CalendarModule';
import { HoverCommentsModule } from '@/modules/social/HoverCommentsModule';
import { NotificationCleanerModule } from '@/modules/notifications/NotificationCleanerModule';
import { ReviewEnhancerModule } from '@/modules/reviews/ReviewEnhancerModule';
import { ActivityEnhancerModule } from '@/modules/activity/ActivityEnhancerModule';
import { ProfileActivityModule } from '@/modules/activity/ProfileActivityModule';
import { ForumEnhancerModule } from '@/modules/forum/ForumEnhancerModule';
import { ActivityScoreModule } from '@/modules/activity/ActivityScoreModule';
import { SocialActivityModule } from '@/modules/social/SocialActivityModule';
import { SocialEnhancerModule } from '@/modules/social/SocialEnhancerModule';
import { CustomListModule } from '@/modules/social/CustomListModule';
import { MediaSocialEnhancer } from '@/modules/social/MediaSocialEnhancer';
import { MediaMetadataModule } from '@/modules/media/MediaMetadataModule';
import { UserBannerModule } from '@/modules/social/UserBannerModule';
import { AstraModule } from '@/modules/astra/AstraModule';
import { AstraService } from '@/modules/astra/AstraService';
import { AstraStore } from '@/modules/astra/store/AstraStore';
import { AstraJournalService } from '@/modules/astra/services/AstraJournalService';
import { AstraRatingModal } from '@/modules/astra/ui/AstraRatingModal';
import { AstraDashboard } from '@/modules/astra/ui/AstraDashboard';
import type { ModuleMetadata } from '@core/interfaces/IModule';

// Shared Components
import { ActivityFilterBar, ActivityRenderer, CustomListTabManager } from '@/modules/activity/shared';
import { CustomListService } from '@/modules/social/CustomListService';

/**
 * Setup the DI container with all services
 */
export async function setupDI(): Promise<void> {
  console.log('[Setup] Configuring DI container...');

  // ============================================================================
  // Core Infrastructure
  // ============================================================================

  // Logger (singleton instance)
  container.registerInstance(TOKENS.Logger, logger);

  // Storage (Sync: config, preferences)
  container.register(TOKENS.Storage, {
    useFactory: (c) => new StorageManager(
      'sync',
      c.resolve(TOKENS.Logger),
      c.resolve(TOKENS.ErrorHandler)
    )
  });

  // Storage (Local: heavy data, Astra)
  container.register(TOKENS.LocalStorage, {
    useFactory: (c) => new StorageManager(
      'local',
      c.resolve(TOKENS.Logger),
      c.resolve(TOKENS.ErrorHandler)
    )
  });

  // Event Bus (new instance, singleton via @injectable())
  container.registerSingleton(TOKENS.EventBus, EventBus);

  // Navigation Service (needs event bus and logger)
  container.registerSingleton(TOKENS.NavigationService, NavigationService);

  // Shared Global Observer (performance optimization for modules observing document.body)
  container.registerSingleton(TOKENS.SharedGlobalObserver, SharedGlobalObserver);

  // Configuration Manager (needs storage and event bus) - REGISTER AS SINGLETON
  container.registerSingleton(TOKENS.Config, ConfigManager);

  // Error Handler (needs logger and event bus)
  container.registerSingleton(TOKENS.ErrorHandler, ErrorHandler);

  // Toast Service (needs event bus)
  container.registerSingleton(TOKENS.ReviewService, ReviewService);
  container.registerSingleton(TOKENS.ToastService, ToastService);

  // Module Registry (needs logger and event bus) - REGISTER AS SINGLETON
  container.registerSingleton(TOKENS.ModuleRegistry, ModuleRegistry);

  // ============================================================================
  // API Client
  // ============================================================================

  // AnilistClient (singleton via @injectable())
  container.registerSingleton(TOKENS.ApiClient, AnilistClient);

  // GraphQLBatcher (singleton - batches multiple queries into one HTTP request)
  container.registerSingleton(TOKENS.GraphQLBatcher, GraphQLBatcher);

  // ============================================================================
  // Auth
  // ============================================================================

  // AuthTokenService (singleton)
  container.registerSingleton(TOKENS.AuthTokenService, AuthTokenService);
  container.registerSingleton(TOKENS.AuthService, AuthService);

  // ============================================================================
  // Theme
  // ============================================================================

  // ThemeManager (singleton via @singleton() decorator)
  container.registerSingleton(TOKENS.ThemeManager, ThemeManager);

  // ============================================================================
  // Feature Services
  // ============================================================================

  // Calendar Services
  container.registerSingleton(TOKENS.CalendarService, CalendarService);
  container.registerSingleton(TOKENS.CalendarDomService, CalendarDomService);
  container.registerSingleton(TOKENS.CalendarDataService, CalendarDataService);
  container.registerSingleton(TOKENS.CalendarSocialService, CalendarSocialService);

  // Social Services
  container.registerSingleton(TOKENS.SocialService, SocialService);
  container.registerSingleton(TOKENS.CustomListService, CustomListService);

  // Activity Services
  container.registerSingleton(TOKENS.ActivityService, ActivityService);
  container.registerSingleton(TOKENS.ActivityFilterBar, ActivityFilterBar);
  container.registerSingleton(TOKENS.ActivityRenderer, ActivityRenderer);
  container.registerSingleton(TOKENS.ActivityTabManager, CustomListTabManager);

  // Notification Services
  container.registerSingleton(TOKENS.NotificationFetchService, NotificationFetchService);
  container.registerSingleton(TOKENS.NotificationGroupService, NotificationGroupService);
  container.registerSingleton(TOKENS.NotificationFilterService, NotificationFilterService);

  // Astra Services
  container.registerSingleton(TOKENS.AstraService, AstraService);
  container.registerSingleton(TOKENS.AstraStore, AstraStore);
  container.registerSingleton(TOKENS.AstraJournalService, AstraJournalService);
  container.registerSingleton(TOKENS.AstraRatingModal, AstraRatingModal);
  container.registerSingleton(TOKENS.AstraDashboard, AstraDashboard);

  // ============================================================================
  // Initialize Critical Services
  // ============================================================================

  // Load configuration
  const config = container.resolve<IConfigManager>(TOKENS.Config);
  await config.load();
  console.log('[Setup] Configuration loaded');

  // Setup error handler
  const errorHandler = container.resolve<ErrorHandler>(TOKENS.ErrorHandler);
  errorHandler.setupGlobalHandlers();
  console.log('[Setup] Error handler initialized');

  // Initialize Toast Service
  const toastService = container.resolve<ToastService>(TOKENS.ToastService);
  toastService.init();
  console.log('[Setup] Toast service initialized');

  // Start navigation service
  const navigationService = container.resolve<NavigationService>(TOKENS.NavigationService);
  navigationService.start();
  console.log('[Setup] Navigation service started');

  // Initialize AuthTokenService (load token from chrome.storage.local)
  const authTokenService = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
  await authTokenService.initialize();
  console.log('[Setup] Auth token service initialized');

  // ============================================================================
  // Register Modules
  // ============================================================================

  const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);

  const modules: ModuleMetadata[] = [
    {
      name: 'calendar',
      description: 'Airing schedule calendar',
      enabled: config.isFeatureEnabled('calendar'),
      factory: () => container.resolve(CalendarModule),
      pageMatch: (path) => path === '/' || path === '/home',
    },
    {
      name: 'hoverComments',
      description: 'Hover to see comments on activity feed',
      enabled: config.isFeatureEnabled('hoverComments'),
      factory: () => container.resolve(HoverCommentsModule),
    },

    {
      name: 'notificationCleaner',
      description: 'Enhanced notification management',
      enabled: config.isFeatureEnabled('notificationCleaner'),
      factory: () => container.resolve(NotificationCleanerModule),
      pageMatch: (path) => path.startsWith('/notifications'),
    },
    {
      name: 'reviewEnhancer',
      description: 'Show review ratings on cards',
      enabled: config.isFeatureEnabled('reviewEnhancer'),
      factory: () => container.resolve(ReviewEnhancerModule),
    },
    {
      name: 'activityEnhancer',
      description: 'Enhanced activity feed',
      enabled: config.isFeatureEnabled('socialActivity'),
      factory: () => container.resolve(ActivityEnhancerModule),
    },
    {
      name: 'forumEnhancer',
      description: 'Enhanced forum features',
      enabled: config.isFeatureEnabled('forumEnhancer'),
      factory: () => container.resolve(ForumEnhancerModule),
    },
    {
      name: 'activityScore',
      description: 'Show scores in activity feed',
      enabled: config.isFeatureEnabled('activityScore'),
      factory: () => container.resolve(ActivityScoreModule),
    },
    {
      name: 'socialActivity',
      description: 'Social activity sidebar',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(SocialActivityModule),
    },
    {
      name: 'socialEnhancer',
      description: 'Social features enhancer',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(SocialEnhancerModule),
    },
    {
      name: 'customList',
      description: 'Custom list management',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(CustomListModule),
    },
    {
      name: 'mediaSocialEnhancer',
      description: 'Media page social enhancements',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(MediaSocialEnhancer),
    },
    {
      name: 'userBanner',
      description: 'User profile banner actions',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(UserBannerModule),
      pageMatch: (path) => path.startsWith('/user/'),
    },
    {
      name: 'astra',
      description: 'Advanced scoring system (Astra)',
      enabled: config.isFeatureEnabled('astra'),
      factory: () => container.resolve(AstraModule),
      pageMatch: (path) => path === '/' || path === '/home' || path.includes('/user/') || path.includes('/astra') || /^\/(anime|manga)\/\d+/.test(path),
    },
    {
      name: 'mediaMetadata',
      description: 'External media metadata (MAL, Reddit)',
      enabled: config.isFeatureEnabled('mediaMetadata'),
      factory: () => container.resolve(MediaMetadataModule),
      pageMatch: (path) => /^\/(anime|manga)\/\d+/.test(path),
    },
    {
      name: 'profileActivity',
      description: 'Activity filtering on user profile',
      enabled: config.isFeatureEnabled('socialActivity'),
      factory: () => container.resolve(ProfileActivityModule),
      pageMatch: (path) => path.startsWith('/user/') && !path.includes('/animelist') && !path.includes('/mangalist'),
    },
  ];

  registry.registerAll(modules);
  console.log(`[Setup] Registered ${modules.length} modules`);

  console.log('[Setup] DI container configured successfully');
}

/**
 * Get a service from the container (convenience function)
 */
export function getService<T>(token: symbol): T {
  return container.resolve<T>(token);
}
