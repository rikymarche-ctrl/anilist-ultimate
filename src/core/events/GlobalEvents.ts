/**
 * Global Application Events
 * Centralizes all event definitions for event-driven architecture
 * Eliminates direct module-to-module coupling
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
