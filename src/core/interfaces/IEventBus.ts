/**
 * @file IEventBus.ts
 * @description Contract for the application-wide publish/subscribe event system
 *
 * Provides typed on/once/off/emit methods with AppEventMap type safety,
 * plus clear() and listenerCount() for management. Overloaded signatures
 * support both typed keys and dynamic string events.
 *
 * @see EventBus.ts for the concrete implementation
 * @see EventTypes.ts for the event-to-payload map
 */

import type { AppEventMap } from '../events/EventTypes';

export type EventPayload<K extends string> = K extends keyof AppEventMap ? AppEventMap[K] : unknown;
export type EventArguments<K extends string> = undefined extends EventPayload<K>
  ? [data?: EventPayload<K>]
  : [data: EventPayload<K>];
export type EventHandler<T = unknown> = (data?: T) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe: () => void;
}

export interface IEventBus {
  /**
   * Subscribe to an event
   */
  on<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): EventSubscription;

  /**
   * Subscribe to an event once
   */
  once<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): EventSubscription;

  /**
   * Unsubscribe from an event
   */
  off<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): void;

  /**
   * Emit an event
   */
  emit<K extends string>(event: K, ...args: EventArguments<NoInfer<K>>): void;

  /**
   * Clear all handlers for an event
   */
  clear(event?: string): void;

  /**
   * Get number of listeners for an event
   */
  listenerCount(event: string): number;
}
