/**
 * @file tokens.ts
 * @description Dependency Injection token registry
 *
 * All DI tokens are Symbol-based to avoid string collisions.
 * Symbol.for() is used (instead of Symbol()) to allow cross-module
 * token sharing, since Symbol.for() returns the same symbol for
 * the same key globally.
 *
 * Token naming convention:
 *   - Core infrastructure: PascalCase matching interface name
 *   - Feature services: PascalCase matching class name
 *   - Modules: PascalCase matching module class name
 *
 * When adding a new service:
 *   1. Add a token here
 *   2. Register in setup.ts
 *   3. Inject via @inject(TOKENS.YourService)
 *
 * @see setup.ts for registration
 * @see docs/ARCHITECTURE.md#41-dependency-injection
 */
export const TOKENS = {
  // Core Infrastructure
  Logger: Symbol.for('ILogger'),
  Storage: Symbol.for('IStorageService'),
  LocalStorage: Symbol.for('ILocalStorageService'),
  EventBus: Symbol.for('IEventBus'),
  Config: Symbol.for('IConfigManager'),
  ErrorHandler: Symbol.for('IErrorHandler'),
  Cache: Symbol.for('ICacheService'),
  ToastService: Symbol.for('ToastService'),
  ReviewService: Symbol.for('ReviewService'),
  NavigationService: Symbol.for('NavigationService'),
  SharedGlobalObserver: Symbol.for('SharedGlobalObserver'),
  NativeUiSyncService: Symbol.for('NativeUiSyncService'),

  // API Layer
  ApiClient: Symbol.for('IApiClient'),
  GraphQLBatcher: Symbol.for('GraphQLBatcher'),

  // Auth
  AuthTokenService: Symbol.for('AuthTokenService'),
  AuthService: Symbol.for('AuthService'),

  // Theme
  ThemeManager: Symbol.for('ThemeManager'),

  // Calendar Module Services
  CalendarService: Symbol.for('CalendarService'),
  CalendarStore: Symbol.for('CalendarStore'),
  CalendarDataService: Symbol.for('CalendarDataService'),
  CalendarDomService: Symbol.for('CalendarDomService'),
  CalendarSocialService: Symbol.for('CalendarSocialService'),

  // Social Module Services
  SocialService: Symbol.for('SocialService'),
  CustomListService: Symbol.for('CustomListService'),
  SocialMaskingService: Symbol.for('SocialMaskingService'),
  CommentService: Symbol.for('CommentService'),

  // Activity Module Services
  ActivityService: Symbol.for('ActivityService'),
  ActivityFilterBar: Symbol.for('ActivityFilterBar'),
  ActivityRenderer: Symbol.for('ActivityRenderer'),
  ActivityTabManager: Symbol.for('ActivityTabManager'),

  // Review Module Services

  // Notification Module Services
  NotificationFetchService: Symbol.for('NotificationFetchService'),
  NotificationGroupService: Symbol.for('NotificationGroupService'),
  NotificationFilterService: Symbol.for('NotificationFilterService'),

  // Module System
  ModuleRegistry: Symbol.for('ModuleRegistry'),
  ModuleLoader: Symbol.for('ModuleLoader'),

  // Astra Module Services
  AstraService: Symbol.for('AstraService'),
  AstraStore: Symbol.for('AstraStore'),
  AstraJournalService: Symbol.for('AstraJournalService'),
  AstraRatingModal: Symbol.for('AstraRatingModal'),
  AstraDashboard: Symbol.for('AstraDashboard'),
  AstraDashboardV2: Symbol.for('AstraDashboardV2'),
  MediaMusicModule: Symbol.for('MediaMusicModule'),
} as const;

/**
 * Type helper to get token type
 */
export type TokenType = typeof TOKENS[keyof typeof TOKENS];
