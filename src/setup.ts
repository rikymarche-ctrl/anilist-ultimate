/**
 * Service Registration and Setup
 * Configures the DI container with all services
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
import type { IConfigManager } from '@core/interfaces/IConfigManager';

// Core Services
import { AnilistClient } from '@/api/AnilistClient';
import { syncStorage } from '@core/storage/StorageManager';
import { logger } from '@core/logger';
import { ThemeManager } from '@core/ThemeManager';
import { AuthTokenService } from '@core/auth/AuthTokenService';
import { ToastService } from '@core/services/ToastService';

// Feature Services
import { CalendarService } from '@/modules/calendar/CalendarService';
import { CalendarStore } from '@/modules/calendar/CalendarStore';
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
import { ForumEnhancerModule } from '@/modules/forum/ForumEnhancerModule';
import { ActivityScoreModule } from '@/modules/activity/ActivityScoreModule';
import { SocialActivityModule } from '@/modules/social/SocialActivityModule';
import { SocialEnhancerModule } from '@/modules/social/SocialEnhancerModule';
import { CustomListModule } from '@/modules/social/CustomListModule';
import { MediaSocialEnhancer } from '@/modules/social/MediaSocialEnhancer';
import { AstraModule } from '@/modules/astra/AstraModule';
import { AstraService } from '@/modules/astra/AstraService';
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

  // Storage (use existing sync storage instance)
  container.registerInstance(TOKENS.Storage, syncStorage);

  // Event Bus (new instance, singleton via @injectable())
  container.registerSingleton(TOKENS.EventBus, EventBus);

  // Navigation Service (needs event bus and logger)
  container.registerSingleton(TOKENS.NavigationService, NavigationService);

  // Configuration Manager (needs storage and event bus) - REGISTER AS SINGLETON
  container.registerSingleton(TOKENS.Config, ConfigManager);

  // Error Handler (needs logger and event bus)
  container.register(TOKENS.ErrorHandler, {
    useFactory: (c) => {
      const loggerInstance = c.resolve(TOKENS.Logger) as any;
      const eventBus = c.resolve(TOKENS.EventBus) as any;
      return new ErrorHandler(loggerInstance, eventBus);
    },
  });

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

  // ============================================================================
  // Auth
  // ============================================================================

  // AuthTokenService (singleton)
  container.registerSingleton(TOKENS.AuthTokenService, AuthTokenService);

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
  container.registerSingleton(TOKENS.CalendarStore, CalendarStore);
  container.registerSingleton(TOKENS.CalendarDomService, CalendarDomService);
  container.registerSingleton(TOKENS.CalendarDataService, CalendarDataService);
  container.registerSingleton(TOKENS.CalendarSocialService, CalendarSocialService);

  // Social Services
  container.registerSingleton(TOKENS.SocialService, SocialService);

  // Activity Services
  container.registerSingleton(TOKENS.ActivityService, ActivityService);

  // Notification Services
  container.registerSingleton(TOKENS.NotificationFetchService, NotificationFetchService);
  container.registerSingleton(TOKENS.NotificationGroupService, NotificationGroupService);
  container.registerSingleton(TOKENS.NotificationFilterService, NotificationFilterService);

  // Astra Services
  container.registerSingleton(TOKENS.AstraService, AstraService);
  container.registerSingleton(TOKENS.AstraRatingModal, AstraRatingModal);
  container.registerSingleton(TOKENS.AstraDashboard, AstraDashboard);

  // ============================================================================
  // Initialize Critical Services
  // ============================================================================

  // Load configuration
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

  // ============================================================================
  // Register Modules
  // ============================================================================

  const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);

  const modules: ModuleMetadata[] = [
    {
      name: 'calendar',
      description: 'Airing schedule calendar',
      enabled: config.isFeatureEnabled('calendar'),
      factory: () => {
        return new CalendarModule(
          container.resolve(TOKENS.CalendarDomService),
          container.resolve(TOKENS.CalendarDataService),
          container.resolve(TOKENS.CalendarSocialService),
          container.resolve(TOKENS.Config)
        );
      },
      pageMatch: (path) => path === '/' || path === '/home',
    },
    {
      name: 'hoverComments',
      description: 'Hover to see comments on activity feed',
      enabled: config.isFeatureEnabled('hoverComments'),
      factory: () => {
        return new HoverCommentsModule(
          container.resolve(TOKENS.ApiClient),
          container.resolve(TOKENS.Logger)
        );
      },
    },

    {
      name: 'notificationCleaner',
      description: 'Enhanced notification management',
      enabled: config.isFeatureEnabled('notificationCleaner'),
      factory: () => {
        return new NotificationCleanerModule(
          container.resolve(TOKENS.NotificationFetchService),
          container.resolve(TOKENS.NotificationGroupService),
          container.resolve(TOKENS.NotificationFilterService)
        );
      },
      pageMatch: (path) => path.startsWith('/notifications'),
    },
    {
      name: 'reviewEnhancer',
      description: 'Show review ratings on cards',
      enabled: config.isFeatureEnabled('reviewEnhancer'),
      factory: () => {
        return new ReviewEnhancerModule(
          container.resolve(TOKENS.ReviewService)
        );
      },
    },
    {
      name: 'activityEnhancer',
      description: 'Enhanced activity feed',
      enabled: config.isFeatureEnabled('socialActivity'),
      factory: () => {
        // Create shared components
        const filterBar = new ActivityFilterBar();
        const rendererComponent = new ActivityRenderer(logger);
        const tabManager = new CustomListTabManager(logger, CustomListService.getInstance());

        // Create module with injected dependencies
        return new ActivityEnhancerModule(
          logger,
          filterBar,
          rendererComponent,
          tabManager,
          CustomListService.getInstance()
        );
      },
    },
    {
      name: 'forumEnhancer',
      description: 'Enhanced forum features',
      enabled: config.isFeatureEnabled('forumEnhancer'),
      factory: () => new ForumEnhancerModule(),
    },
    {
      name: 'activityScore',
      description: 'Show scores in activity feed',
      enabled: config.isFeatureEnabled('activityScore'),
      factory: () => new ActivityScoreModule(),
    },
    {
      name: 'socialActivity',
      description: 'Social activity sidebar',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => new SocialActivityModule(),
    },
    {
      name: 'socialEnhancer',
      description: 'Social features enhancer',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => new SocialEnhancerModule(),
    },
    {
      name: 'customList',
      description: 'Custom list management',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => new CustomListModule(),
    },
    {
      name: 'mediaSocialEnhancer',
      description: 'Media page social enhancements',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => {
        // Create shared components
        const filterBar = new ActivityFilterBar();
        const rendererComponent = new ActivityRenderer(logger);
        const tabManager = new CustomListTabManager(logger, CustomListService.getInstance());

        // Create module with injected dependencies
        return new MediaSocialEnhancer(
          logger,
          filterBar,
          rendererComponent,
          tabManager,
          CustomListService.getInstance()
        );
      },
    },
    {
      name: 'astra',
      description: 'Advanced scoring system (Astra)',
      enabled: true, // Always enabled for now
      factory: () => new AstraModule(
        container.resolve(TOKENS.AstraService),
        container.resolve(TOKENS.AstraDashboard)
      ),
      pageMatch: (path) => path === '/' || path === '/home' || path.includes('/user/') || path.includes('/astra'),
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
