/**
 * Events Module
 * Barrel export for event bus and event types
 */

export { EventBus } from './EventBus';
export { type IEventBus, type EventHandler, type EventSubscription } from '../interfaces/IEventBus';
export { EVENT_TYPES, type EventType } from './EventTypes';

// Export all event payload types
export type {
  // Module events
  ModuleInitializedEvent,
  ModuleDestroyedEvent,
  ModuleErrorEvent,

  // Calendar events
  CalendarLoadedEvent,
  CalendarUpdatedEvent,
  ProgressUpdatedEvent,
  EpisodeMarkedWatchedEvent,

  // Social events
  FriendActivityLoadedEvent,
  CustomListUpdatedEvent,
  UserListChangeEvent,

  // Activity events
  ActivityFilterChangedEvent,
  ActivitySearchChangedEvent,

  // Theme events
  ThemeChangedEvent,

  // Navigation events
  PageChangedEvent,
  URLChangedEvent,

  // Error events
  ErrorEvent,
  APIErrorEvent,

  // Config events
  ConfigUpdatedEvent,
  FeatureFlagChangedEvent,

  // Auth events
  AuthTokenReceivedEvent,
  UserAuthenticatedEvent,
} from './EventTypes';
