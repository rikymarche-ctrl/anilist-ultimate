/**
 * @file GlobalEvents.ts
 * @description Supplementary typed event payload interfaces for cross-module communication
 *
 * Provides alternative event payload types and a typed GlobalEventMap
 * used alongside the primary AppEventMap in EventTypes.ts. Includes
 * EventEmitter and EventListener type helpers for type-safe pub/sub.
 *
 * @see EventTypes.ts for the canonical event constants and AppEventMap
 * @see EventBus.ts for the pub/sub implementation
 */

import { EVENT_TYPES } from './EventTypes';

/**
 * Navigation Events
 */
export interface PageChangedEvent {
  path: string;
  previousPath: string;
  timestamp: Date;
}

/**
 * Calendar Events
 */
export interface CalendarLoadedEvent {
  scheduleCount: number;
  progressCount: number;
  timestamp: Date;
}

export interface ProgressUpdatedEvent {
  animeId: number;
  progress: number;
  timestamp: Date;
}

/**
 * Auth Events
 */
export interface AuthStateChangedEvent {
  isAuthenticated: boolean;
  userId?: number;
  timestamp: Date;
}

/**
 * Config Events
 */
export interface ConfigChangedEvent {
  key: string;
  value: any;
  previousValue?: any;
  timestamp: Date;
}

/**
 * Global Event Map
 * Type-safe event payload mapping
 */
export interface GlobalEventMap {
  [EVENT_TYPES.PAGE_CHANGED]: PageChangedEvent;
  [EVENT_TYPES.CALENDAR_LOADED]: CalendarLoadedEvent;
  [EVENT_TYPES.PROGRESS_UPDATED]: ProgressUpdatedEvent;
  [EVENT_TYPES.AUTH_STATE_CHANGED]: AuthStateChangedEvent;
  [EVENT_TYPES.CONFIG_CHANGED]: ConfigChangedEvent;
}

/**
 * Event Emitter Helper
 * Type-safe event emission
 */
export type EventEmitter = <K extends keyof GlobalEventMap>(
  event: K,
  data: GlobalEventMap[K]
) => void;

/**
 * Event Listener Helper
 * Type-safe event listening
 */
export type EventListener = <K extends keyof GlobalEventMap>(
  event: K,
  handler: (data: GlobalEventMap[K]) => void
) => () => void;
