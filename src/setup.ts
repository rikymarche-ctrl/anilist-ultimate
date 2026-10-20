import { logger } from '@core/logger';
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
import { AnilistClientProxy } from '@/api/AnilistClientProxy';
import { AuthStateClient } from '@core/auth/AuthStateClient';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { StorageManager } from '@core/storage/StorageManager';
import { ThemeManager } from '@core/ThemeManager';
import { AuthTokenService } from '@core/auth/AuthTokenService';
import { AuthService } from '@core/auth/AuthService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { PreferencesService } from '@core/services/PreferencesService';
import { ToastService } from '@core/services/ToastService';
import { NativeUiSyncService } from '@core/services/NativeUiSyncService';
import { SyncQueueService } from '@core/services/SyncQueueService';
import { SyncQueueClient } from '@core/services/SyncQueueClient';

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
import {
  FollowingProgressModule,
  isFollowingProgressRoute,
} from '@/modules/social/FollowingProgressModule';
import {
  FollowingGroupsModule,
  isFollowingGroupsPageRoute,
} from '@/modules/social/FollowingGroupsModule';
import { NotificationCleanerModule } from '@/modules/notifications/NotificationCleanerModule';
import { ReviewEnhancerModule } from '@/modules/reviews/ReviewEnhancerModule';
import { ActivityEnhancerModule } from '@/modules/activity/ActivityEnhancerModule';
import { ProfileActivityModule } from '@/modules/activity/ProfileActivityModule';
import { ForumEnhancerModule } from '@/modules/forum/ForumEnhancerModule';
import { ActivityScoreModule, isActivityScoreRoute } from '@/modules/activity/ActivityScoreModule';
import { SocialActivityModule } from '@/modules/social/SocialActivityModule';
import { SocialEnhancerModule } from '@/modules/social/SocialEnhancerModule';
import { CustomListModule, isCustomListSettingsPath } from '@/modules/social/CustomListModule';
import { BulkEditorModule } from '@/modules/bulk/BulkEditorModule';
import { BulkEditorService, bulkRoute } from '@/modules/bulk/BulkEditorService';
import { MediaSocialEnhancer } from '@/modules/social/MediaSocialEnhancer';
import { UserSocialStatsModule } from '@/modules/social/UserSocialStatsModule';
import { MediaMetadataModule } from '@/modules/media/MediaMetadataModule';
import { UserBannerModule } from '@/modules/social/UserBannerModule';
import { SocialSidebar } from '@/modules/social/components/SocialSidebar';
import { CommentService } from '@/modules/social/CommentService';
import { CommentTooltip } from '@/modules/social/CommentTooltip';
import { CommentReader } from '@/modules/social/CommentReader';
import { AstraModule } from '@/modules/astra/AstraModule';
import { AstraService } from '@/modules/astra/AstraService';
import { AstraDashboardStore } from '@/modules/astra/store/AstraDashboardStore';
import { AstraRepository } from '@/modules/astra/store/AstraRepository';
import { AstraRepositoryClient } from '@/modules/astra/store/AstraRepositoryClient';
import { AstraRepositoryHost } from '@/modules/astra/store/AstraRepositoryHost';
import { ConfigClient } from '@core/config/ConfigClient';
import { AstraSyncService } from '@/modules/astra/services/AstraSyncService';
import { AstraFilterService } from '@/modules/astra/services/AstraFilterService';
import { AstraStatsService } from '@/modules/astra/services/AstraStatsService';
import { AstraJournalService } from '@/modules/astra/services/AstraJournalService';
import { SeasonalWrappedService } from '@/modules/astra/services/SeasonalWrappedService';
import { YearReviewService } from '@/modules/astra/services/year/YearReviewService';
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
import { ActivityCardStrategy } from '@/modules/astra/strategies/ActivityCardStrategy';
import { AstraEnhancementService } from './modules/astra/services/AstraEnhancementService';
import { AstraNavigationService } from './modules/astra/services/AstraNavigationService';
import { AstraRoutingService } from './modules/astra/services/AstraRoutingService';
import { AstraPillManager } from './modules/astra/services/AstraPillManager';
import { AstraUIBridge } from './modules/astra/services/AstraUIBridge';
import { AstraParserService } from '@/modules/astra/services/AstraParserService';
import { AstraSyncManager } from '@/modules/astra/services/AstraSyncManager';
import { MediaMusicModule } from '@/modules/media/MediaMusicModule';
import { PageStateRestoreModule } from '@/modules/restore/PageStateRestoreModule';
import { PageStateStore } from '@/modules/restore/PageStateStore';
import { PageStateRestorer } from '@/modules/restore/PageStateRestorer';
import { isRestorablePath } from '@/modules/restore/PageStateRoutes';
import type { ModuleMetadata } from '@core/interfaces/IModule';

// Shared Components
import {
  ActivityFilterBar,
  ActivityRenderer,
  CustomListTabManager,
} from '@/modules/activity/shared';
import { CustomListClient } from '@/modules/social/CustomListClient';
import { CustomListHost } from '@/modules/social/CustomListHost';
import { FriendAlertsHost } from '@/modules/notifications/FriendAlertsHost';
import { FriendAlertsModule } from '@/modules/notifications/FriendAlertsModule';
import { SocialMaskingService } from '@core/services/SocialMaskingService';

/**
 * Setup the DI container with all services.
 *
 * @param isBackground Set to true if running in Service Worker context (no DOM)
 * @param storageReady Optional access-level barrier before reading durable data.
 * Registrations and global error listeners run synchronously before this barrier
 * so MV3 can restore its listeners during initial script evaluation.
 */
export async function setupDI(isBackground = false, storageReady?: Promise<void>): Promise<void> {
  logger.debug(`[Setup] Configuring DI container (Background: ${isBackground})...`);

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

  // Error Handler (needs logger and event bus)
  container.registerSingleton(TOKENS.ErrorHandler, ErrorHandler);

  // Configuration Manager (foreground storage construction needs the error handler above).
  if (isBackground) container.registerSingleton(TOKENS.Config, ConfigManager);
  else {
    container.registerSingleton(TOKENS.Config, ConfigClient);
    // Construct in the document owner before a feature borrows this Disposable.
    container.resolve(TOKENS.Config);
  }

  // Toast Service (needs event bus)
  container.registerSingleton(TOKENS.ReviewService, ReviewService);
  container.registerSingleton(TOKENS.ToastService, ToastService);

  container.registerSingleton(TOKENS.ModuleRegistry, ModuleRegistry);
  container.registerSingleton(CacheFactory);
  // The document owns shared caches; a feature scope must only borrow them.
  // Construction subscribes without reading storage before its access barrier.
  container.resolve(CacheFactory);
  container.registerSingleton(CalendarStore);
  container.register(TOKENS.CalendarStore, { useToken: CalendarStore });

  // Native UI Sync Service
  container.registerSingleton(TOKENS.NativeUiSyncService, NativeUiSyncService);
  container.registerSingleton(TOKENS.PreferencesService, PreferencesService);
  container.registerSingleton(TOKENS.SocialMaskingService, SocialMaskingService);
  if (isBackground) {
    container.register(TOKENS.AstraEntryDeletionCleanup, {
      useValue: async (mediaId: number, sessionId: string) => {
        await container.resolve(AstraRepositoryHost).dispatch('deleteWork', [mediaId], sessionId);
      },
    });
    container.register(TOKENS.AstraNotesSyncPolicy, {
      useValue: async (mediaId: number, updatedAt: number, sessionId: string) => {
        const host = container.resolve(AstraRepositoryHost);
        const snapshot = (await host.dispatch('getSnapshot', [], sessionId)) as {
          settings: { appendAstraToComment: boolean };
        };
        if (!snapshot.settings.appendAstraToComment) return false;
        const current = (await host.dispatch('getFullWork', [mediaId], sessionId)) as
          | { updatedAt: number }
          | undefined;
        return current?.updatedAt === updatedAt;
      },
    });
    container.registerSingleton(TOKENS.SyncQueue, SyncQueueService);
  } else container.registerSingleton(TOKENS.SyncQueue, SyncQueueClient);

  // ============================================================================
  // API Client
  // ============================================================================

  // AnilistClient (singleton via @injectable())
  if (isBackground) container.registerSingleton(TOKENS.ApiClient, AnilistClient);
  else container.registerSingleton(TOKENS.ApiClient, AnilistClientProxy);

  // GraphQLBatcher (singleton - batches multiple queries into one HTTP request)
  container.registerSingleton(TOKENS.GraphQLBatcher, GraphQLBatcher);

  // ============================================================================
  // Auth
  // ============================================================================

  // AuthTokenService (singleton)
  if (isBackground) {
    container.registerSingleton(TOKENS.AuthTokenService, AuthTokenService);
    // A feature may borrow this Disposable while the storage barrier is pending.
    container.resolve(TOKENS.AuthTokenService);
  } else {
    container.registerSingleton(TOKENS.AuthTokenService, AuthStateClient);
    container.resolve(TOKENS.AuthTokenService);
  }
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
  container.register(TOKENS.ComponentScope, { useFactory: (scope) => scope });
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
  container.registerSingleton(BulkEditorService);
  container.registerSingleton(TOKENS.SocialRenderer, SocialRenderer);
  if (isBackground) {
    container.registerSingleton(CustomListHost);
    container.registerSingleton(FriendAlertsHost);
  } else {
    container.registerSingleton(TOKENS.CustomListService, CustomListClient);
    // Construct in the document owner before a feature scope can borrow this singleton.
    container.resolve<CustomListClient>(TOKENS.CustomListService);
  }
  container.registerSingleton(SocialSidebar);
  container.registerSingleton(CommentService);
  container.registerSingleton(CommentTooltip);
  container.registerSingleton(CommentReader);

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
  if (!isBackground) {
    container.registerSingleton(AstraRepositoryClient);
    container.register(AstraRepository, { useToken: AstraRepositoryClient });
    // Install its listeners in the document owner without reading storage yet.
    container.resolve(AstraRepositoryClient);
  }
  if (isBackground) container.registerSingleton(AstraRepositoryHost);
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
  container.registerSingleton(SeasonalWrappedService);
  container.registerSingleton(YearReviewService);
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
  container.registerSingleton(ActivityCardStrategy);

  container.register(TOKENS.AstraStrategies, {
    useFactory: (c) => [
      c.resolve(HomeProgressStrategy),
      c.resolve(UserListStrategy),
      c.resolve(ActivityCardStrategy),
    ],
  });
  logger.debug('[Setup] Astra strategies registered');

  container.registerSingleton(TOKENS.MediaMusicModule, MediaMusicModule);

  // Page State Restore Services (tab-scoped snapshots, replayed on Back)
  container.registerSingleton(TOKENS.PageStateStore, PageStateStore);
  container.registerSingleton(TOKENS.PageStateRestorer, PageStateRestorer);

  // ============================================================================
  // Initialize Critical Services
  // ============================================================================

  const errorHandler = container.resolve<ErrorHandler>(TOKENS.ErrorHandler);
  errorHandler.setupGlobalHandlers();
  // Preferences are document-owned; construct after their API dependencies exist.
  if (!isBackground) container.resolve(TOKENS.PreferencesService);
  await storageReady;

  // Initialize AuthTokenService before reading account-dependent data
  const authTokenService = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
  // Corrupt account metadata stays unavailable without blocking explicit login;
  // access-level and storage I/O failures still reject background startup.
  await authTokenService.ensureInitialized();
  if (isBackground) await container.resolve(AstraRepositoryHost).initialize();

  // Load configuration
  const config = container.resolve<IConfigManager>(TOKENS.Config);
  await config.load();

  // Start navigation service (Background can use it for path logic, but no DOM listeners)
  const navigationService = container.resolve<NavigationService>(TOKENS.NavigationService);
  if (!isBackground) {
    navigationService.start();
    logger.debug('[Setup] Navigation service started');
  }

  // ============================================================================
  // Initialize UI-only Services
  // ============================================================================
  if (!isBackground) {
    // The document owns Disposable Astra singletons. Feature scopes only borrow
    // them after this storage/auth/config barrier, and activate them on init.
    container.resolve(AstraDashboard).deactivate();
    container.resolve(AstraNavigationService).deactivate();
    container.resolve(AstraUIBridge);

    // Initialize Theme manager
    container.resolve(ThemeManager);

    // Initialize Toast Service
    const toastService = container.resolve<ToastService>(TOKENS.ToastService);
    toastService.init();
    logger.debug('[Setup] Toast service initialized');

    // Initialize Native UI Sync Service
    const syncService = container.resolve<NativeUiSyncService>(TOKENS.NativeUiSyncService);
    syncService.init();
    logger.debug('[Setup] Native UI sync service initialized');

    // Initialize Social Masking Service
    const maskingService = container.resolve<SocialMaskingService>(TOKENS.SocialMaskingService);
    maskingService.init();
    logger.debug('[Setup] Social masking service initialized');
  }

  // Activate Astra Journal listeners
  if (!isBackground) container.resolve(TOKENS.AstraJournalService);

  // ============================================================================
  // Register Modules
  // ============================================================================

  const modules: ModuleMetadata[] = [
    {
      name: 'friendAlerts',
      description: 'Local alerts for friend activity on watched titles',
      // Keep the settings listener alive so existing tabs can toggle the feature.
      // UI resources and background requests are gated by the friendAlerts flag.
      enabled: true,
      factory: (scope) => scope.resolve(FriendAlertsModule),
      pageMatch: () => true,
    },
    {
      name: 'bulkEditor',
      description: 'Bulk edit your own anime and manga lists',
      enabled: config.isFeatureEnabled('listEditor'),
      factory: (scope) => scope.resolve(BulkEditorModule),
      pageMatch: (path) => bulkRoute(path) !== null,
    },
    {
      name: 'followingProgress',
      description: 'Watched episodes in native Following rows',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: (scope) => scope.resolve(FollowingProgressModule),
      pageMatch: isFollowingProgressRoute,
    },
    {
      name: 'followingGroups',
      description: 'Custom groups in the Social tab Following column',
      enabled: config.isFeatureEnabled('friendActivity'),
      factory: (scope) => scope.resolve(FollowingGroupsModule),
      pageMatch: isFollowingGroupsPageRoute,
    },
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
      pageMatch: isActivityScoreRoute,
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
      factory: (scope) => scope.resolve(CustomListModule),
      pageMatch: isCustomListSettingsPath,
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
      enabled: config.isFeatureEnabled('mediaMusic'),
      factory: () => container.resolve(MediaMusicModule),
      pageMatch: (path) => /^\/anime\/\d+/.test(path),
    },
    {
      name: 'pageRestore',
      description: 'Restore loaded content, list filters and scroll position on Back',
      enabled: config.isFeatureEnabled('pageRestore'),
      factory: (scope) => scope.resolve(PageStateRestoreModule),
      // Any page may load content on scroll, so it runs everywhere; pages without
      // growing content never produce a snapshot.
      pageMatch: isRestorablePath,
    },
  ];

  if (!isBackground) {
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);
    registry.registerAll(modules);
    logger.debug(`[Setup] Registered ${modules.length} modules`);
  }

  logger.debug('[Setup] DI container configured successfully');
}

/**
 * Get a service from the container (convenience function)
 */
export function getService<T>(token: symbol): T {
  return container.resolve<T>(token);
}
