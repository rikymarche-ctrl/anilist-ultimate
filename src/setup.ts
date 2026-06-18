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
import { CacheFactory } from '@core/cache/CacheFactory';
import { PreferencesService } from '@core/services/PreferencesService';
import { ToastService } from '@core/services/ToastService';
import { NativeUiSyncService } from '@core/services/NativeUiSyncService';
import { SyncQueueService } from '@core/services/SyncQueueService';

// Feature Services
import { CalendarStore } from '@/modules/calendar/CalendarStore';
import { CalendarService } from '@/modules/calendar/CalendarService';
import { CalendarDomService } from '@/modules/calendar/services/CalendarDomService';
import { CalendarDataService } from '@/modules/calendar/services/CalendarDataService';
import { CalendarSocialService } from '@/modules/calendar/services/CalendarSocialService';
import { SocialService } from '@/modules/social/SocialService';
import { SocialRenderer } from '@/modules/social/SocialRenderer';
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
import { UserSocialStatsModule } from '@/modules/social/UserSocialStatsModule';
import { MediaMetadataModule } from '@/modules/media/MediaMetadataModule';
import { UserBannerModule } from '@/modules/social/UserBannerModule';
import { SocialSidebar } from '@/modules/social/components/SocialSidebar';
import { CommentTooltip } from '@/modules/social/CommentTooltip';
import { AstraModule } from '@/modules/astra/AstraModule';
import { AstraService } from '@/modules/astra/AstraService';
import { AstraDashboardStore } from '@/modules/astra/store/AstraDashboardStore';
import { AstraRepository } from '@/modules/astra/store/AstraRepository';
import { AstraSyncService } from '@/modules/astra/services/AstraSyncService';
import { AstraFilterService } from '@/modules/astra/services/AstraFilterService';
import { AstraStatsService } from '@/modules/astra/services/AstraStatsService';
import { AstraJournalService } from '@/modules/astra/services/AstraJournalService';
import { AstraRatingService } from '@/modules/astra/services/AstraRatingService';
import { AstraRatingModal } from '@/modules/astra/ui/AstraRatingModal';
import { AstraRatingHeader } from '@/modules/astra/ui/components/AstraRatingHeader';
import { AstraDashboard } from '@/modules/astra/ui/AstraDashboard';
import { AstraFilterBar } from '@/modules/astra/ui/components/AstraFilterBar';
import { AstraWorkTable } from '@/modules/astra/ui/components/AstraWorkTable';
import { AstraSettingsView } from '@/modules/astra/ui/components/AstraSettingsView';
import { PillUIBuilder } from '@/modules/astra/ui/PillUIBuilder';
import { HomeProgressStrategy } from '@/modules/astra/strategies/HomeProgressStrategy';
import { UserListStrategy } from '@/modules/astra/strategies/UserListStrategy';
import { AstraEnhancementService } from './modules/astra/services/AstraEnhancementService';
import { AstraNavigationService } from './modules/astra/services/AstraNavigationService';
import { AstraRoutingService } from './modules/astra/services/AstraRoutingService';
import { AstraPillManager } from './modules/astra/services/AstraPillManager';
import { AstraUIBridge } from './modules/astra/services/AstraUIBridge';
import { AstraParserService } from '@/modules/astra/services/AstraParserService';
import { AstraSyncManager } from '@/modules/astra/services/AstraSyncManager';
import { MediaMusicModule } from '@/modules/media/MediaMusicModule';
import type { ModuleMetadata } from '@core/interfaces/IModule';

// Shared Components
import {
  ActivityFilterBar,
  ActivityRenderer,
  CustomListTabManager,
} from '@/modules/activity/shared';
import { CustomListService } from '@/modules/social/CustomListService';
import { SocialMaskingService } from '@core/services/SocialMaskingService';

/**
 * Setup the DI container with all services.
 *
 * @param isBackground Set to true if running in Service Worker context (no DOM)
 */
export async function setupDI(isBackground = false): Promise<void> {
  console.log(`[Setup] Configuring DI container (Background: ${isBackground})...`);

  // ============================================================================
  // Core Infrastructure
  // ============================================================================

  // Logger (singleton instance)
  container.registerInstance(TOKENS.Logger, logger);

  // Storage (Sync: config, preferences)
  container.register(TOKENS.Storage, {
    useFactory: (c) =>
      new StorageManager('sync', c.resolve(TOKENS.Logger), c.resolve(TOKENS.ErrorHandler)),
  });

  // Storage (Local: heavy data, Astra)
  container.register(TOKENS.LocalStorage, {
    useFactory: (c) =>
      new StorageManager('local', c.resolve(TOKENS.Logger), c.resolve(TOKENS.ErrorHandler)),
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

  container.registerSingleton(TOKENS.ModuleRegistry, ModuleRegistry);
  container.registerSingleton(CacheFactory);
  container.registerSingleton(CalendarStore);
  container.register(TOKENS.CalendarStore, { useToken: CalendarStore });

  // Native UI Sync Service
  container.registerSingleton(TOKENS.NativeUiSyncService, NativeUiSyncService);
  container.registerSingleton(TOKENS.PreferencesService, PreferencesService);
  container.registerSingleton(TOKENS.SocialMaskingService, SocialMaskingService);
  container.registerSingleton(TOKENS.SyncQueue, SyncQueueService);

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
  container.registerSingleton(CalendarService);
  container.register(TOKENS.CalendarService, { useToken: CalendarService });

  container.registerSingleton(CalendarDomService);
  container.register(TOKENS.CalendarDomService, { useToken: CalendarDomService });

  container.registerSingleton(CalendarDataService);
  container.register(TOKENS.CalendarDataService, { useToken: CalendarDataService });

  container.registerSingleton(CalendarSocialService);
  container.register(TOKENS.CalendarSocialService, { useToken: CalendarSocialService });

  // Social Services
  container.registerSingleton(TOKENS.SocialService, SocialService);
  container.registerSingleton(TOKENS.SocialRenderer, SocialRenderer);
  container.registerSingleton(TOKENS.CustomListService, CustomListService);
  container.registerSingleton(SocialSidebar);
  container.registerSingleton(CommentTooltip);

  // Activity Services
  container.registerSingleton(TOKENS.ActivityService, ActivityService);
  container.registerSingleton(TOKENS.ActivityFilterBar, ActivityFilterBar);
  container.registerSingleton(TOKENS.ActivityRenderer, ActivityRenderer);
  container.registerSingleton(TOKENS.ActivityTabManager, CustomListTabManager);

  // Notification Services
  container.registerSingleton(TOKENS.NotificationFetchService, NotificationFetchService);
  container.registerSingleton(TOKENS.NotificationGroupService, NotificationGroupService);
  container.registerSingleton(TOKENS.NotificationFilterService, NotificationFilterService);

  // Astra Core
  container.registerSingleton(AstraRepository);
  container.registerSingleton(AstraSyncService);
  container.registerSingleton(AstraService);
  container.register(TOKENS.AstraService, { useToken: AstraService });

  container.registerSingleton(AstraDashboardStore);
  container.register(TOKENS.AstraStore, { useToken: AstraDashboardStore });

  container.registerSingleton(AstraFilterService);
  container.register(TOKENS.AstraFilterService, { useToken: AstraFilterService });

  container.registerSingleton(AstraStatsService);
  container.register(TOKENS.AstraStatsService, { useToken: AstraStatsService });

  container.registerSingleton(AstraJournalService);
  container.register(TOKENS.AstraJournalService, { useToken: AstraJournalService });

  container.registerSingleton(AstraRatingService);
  container.register(TOKENS.IAstraRatingService, { useToken: AstraRatingService });

  container.registerSingleton(AstraParserService);
  container.register(TOKENS.AstraParserService, { useToken: AstraParserService });

  container.registerSingleton(AstraSyncManager);
  container.register(TOKENS.AstraSyncManager, { useToken: AstraSyncManager });

  container.registerSingleton(AstraRatingModal);

  container.registerSingleton(AstraRatingHeader);
  container.registerSingleton(AstraFilterBar);
  container.registerSingleton(AstraWorkTable);
  container.registerSingleton(AstraSettingsView);

  container.registerSingleton(AstraDashboard);
  container.register(TOKENS.AstraDashboard, { useToken: AstraDashboard });

  container.registerSingleton(PillUIBuilder);
  container.register(TOKENS.AstraPillBuilder, { useToken: PillUIBuilder });

  container.registerSingleton(AstraEnhancementService);
  container.register(TOKENS.AstraEnhancementService, { useToken: AstraEnhancementService });

  container.registerSingleton(AstraNavigationService);
  container.register(TOKENS.AstraNavigationService, { useToken: AstraNavigationService });

  container.registerSingleton(AstraUIBridge);
  container.registerSingleton(AstraRoutingService);
  container.registerSingleton(AstraPillManager);

  // Explicitly register AstraModule
  container.registerSingleton(AstraModule);

  // Register Astra Strategies
  container.registerSingleton(HomeProgressStrategy);
  container.registerSingleton(UserListStrategy);

  container.register(TOKENS.AstraStrategies, {
    useFactory: (c) => [c.resolve(HomeProgressStrategy), c.resolve(UserListStrategy)],
  });
  console.log('[Setup] Astra strategies registered');

  container.registerSingleton(TOKENS.MediaMusicModule, MediaMusicModule);

  // ============================================================================
  // Initialize Critical Services
  // ============================================================================

  // Initialize AuthTokenService (CRITICAL: must be first)
  const authTokenService = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
  await authTokenService.initialize();

  // Load configuration
  const config = container.resolve<IConfigManager>(TOKENS.Config);
  await config.load();

  const errorHandler = container.resolve<ErrorHandler>(TOKENS.ErrorHandler);
  errorHandler.setupGlobalHandlers();

  // Start navigation service (Background can use it for path logic, but no DOM listeners)
  const navigationService = container.resolve<NavigationService>(TOKENS.NavigationService);
  if (!isBackground) {
    navigationService.start();
    console.log('[Setup] Navigation service started');
  }

  // ============================================================================
  // Initialize UI-only Services
  // ============================================================================
  if (!isBackground) {
    // Initialize Theme manager
    container.resolve(ThemeManager);

    // Initialize Toast Service
    const toastService = container.resolve<ToastService>(TOKENS.ToastService);
    toastService.init();
    console.log('[Setup] Toast service initialized');

    // Initialize Native UI Sync Service
    const syncService = container.resolve<NativeUiSyncService>(TOKENS.NativeUiSyncService);
    syncService.init();
    console.log('[Setup] Native UI sync service initialized');

    // Initialize Social Masking Service
    const maskingService = container.resolve<SocialMaskingService>(TOKENS.SocialMaskingService);
    maskingService.init();
    console.log('[Setup] Social masking service initialized');
  }

  // Activate Astra Journal listeners
  container.resolve(TOKENS.AstraJournalService);

  // ============================================================================
  // Register Modules
  // ============================================================================

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
      pageMatch: (path) =>
        path === '/' ||
        path === '/home' ||
        path.startsWith('/user/') ||
        path.startsWith('/activity/') ||
        /^\/(anime|manga)\/\d+/.test(path),
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
      pageMatch: (path) =>
        path === '/' ||
        path === '/home' ||
        path.includes('/reviews') ||
        /^\/(anime|manga)\/\d+/.test(path),
    },
    {
      name: 'activityEnhancer',
      description: 'Enhanced activity feed',
      enabled: config.isFeatureEnabled('socialActivity'),
      factory: () => container.resolve(ActivityEnhancerModule),
      pageMatch: (path) =>
        path === '/' ||
        path === '/home' ||
        path.startsWith('/user/') ||
        path.startsWith('/activity/'),
    },
    {
      name: 'forumEnhancer',
      description: 'Enhanced forum features',
      enabled: config.isFeatureEnabled('forumEnhancer'),
      factory: () => container.resolve(ForumEnhancerModule),
      pageMatch: (path) => path.startsWith('/forum'),
    },
    {
      name: 'activityScore',
      description: 'Show scores in activity feed',
      enabled: config.isFeatureEnabled('activityScore'),
      factory: () => container.resolve(ActivityScoreModule),
      pageMatch: (path) =>
        path === '/' ||
        path === '/home' ||
        path.startsWith('/user/') ||
        path.startsWith('/activity/'),
    },
    {
      name: 'socialActivity',
      description: 'Social activity sidebar',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(SocialActivityModule),
      pageMatch: (path) => path === '/' || path === '/home',
    },
    {
      name: 'socialEnhancer',
      description: 'Social features enhancer',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(SocialEnhancerModule),
      pageMatch: (path) => path === '/' || path === '/home' || path.startsWith('/user/'),
    },
    {
      name: 'customList',
      description: 'Custom list management',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(CustomListModule),
      pageMatch: (path) => path === '/' || path === '/home' || path.startsWith('/user/'),
    },
    {
      name: 'mediaSocialEnhancer',
      description: 'Media page social enhancements',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(MediaSocialEnhancer),
      pageMatch: (path) => /^\/(anime|manga)\/\d+/.test(path),
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
      enabled: true,
      factory: () => container.resolve(AstraModule),
      pageMatch: () => true, // Global module (Navigation & Multi-page enhancements)
    },
    {
      name: 'mediaMetadata',
      description: 'External media metadata (MAL, Reddit)',
      enabled: config.isFeatureEnabled('mediaMetadata'),
      factory: () => container.resolve(MediaMetadataModule),
      pageMatch: (path) => /^\/(anime|manga)\/\d+/.test(path),
    },
    {
      name: 'userSocialStats',
      description: 'Follower and following counts on profiles',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: () => container.resolve(UserSocialStatsModule),
      pageMatch: (path) => path.startsWith('/user/'),
    },
    {
      name: 'profileActivity',
      description: 'Activity filtering on user profile',
      enabled: config.isFeatureEnabled('socialActivity'),
      factory: () => container.resolve(ProfileActivityModule),
      pageMatch: (path) =>
        path.startsWith('/user/') && !path.includes('/animelist') && !path.includes('/mangalist'),
    },
    {
      name: 'mediaMusic',
      description: 'Inject openings and endings into media pages',
      enabled: config.isFeatureEnabled('astra'), // Use astra flag for now or add a new one
      factory: () => container.resolve(MediaMusicModule),
      pageMatch: (path) => /^\/anime\/\d+/.test(path),
    },
  ];

  if (!isBackground) {
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);
    registry.registerAll(modules);
    console.log(`[Setup] Registered ${modules.length} modules`);
  }

  console.log('[Setup] DI container configured successfully');
}

/**
 * Get a service from the container (convenience function)
 */
export function getService<T>(token: symbol): T {
  return container.resolve<T>(token);
}
