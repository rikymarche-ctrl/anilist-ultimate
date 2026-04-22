/**
 * Dependency Injection Tokens
 * Symbol-based tokens for service registration and resolution
 */

/**
 * DI Tokens for all services in the application
 * Using Symbol.for() allows for cross-module token sharing
 */
export const TOKENS = {
  // Core Infrastructure
  Logger: Symbol.for('ILogger'),
  Storage: Symbol.for('IStorageService'),
  EventBus: Symbol.for('IEventBus'),
  Config: Symbol.for('IConfigManager'),
  ErrorHandler: Symbol.for('IErrorHandler'),
  NavigationService: Symbol.for('NavigationService'),

  // API Layer
  ApiClient: Symbol.for('IApiClient'),

  // Auth
  AuthTokenService: Symbol.for('AuthTokenService'),

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
  BestFriendService: Symbol.for('BestFriendService'),
  CommentService: Symbol.for('CommentService'),

  // Activity Module Services
  ActivityService: Symbol.for('ActivityService'),
  ActivityFilterBar: Symbol.for('ActivityFilterBar'),
  ActivityRenderer: Symbol.for('ActivityRenderer'),
  ActivityTabManager: Symbol.for('ActivityTabManager'),

  // Review Module Services
  ReviewService: Symbol.for('ReviewService'),

  // Notification Module Services
  NotificationFetchService: Symbol.for('NotificationFetchService'),
  NotificationGroupService: Symbol.for('NotificationGroupService'),
  NotificationFilterService: Symbol.for('NotificationFilterService'),

  // Module System
  ModuleRegistry: Symbol.for('ModuleRegistry'),
  ModuleLoader: Symbol.for('ModuleLoader'),
} as const;

/**
 * Type helper to get token type
 */
export type TokenType = typeof TOKENS[keyof typeof TOKENS];
