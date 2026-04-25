/**
 * Event Bus Interface
 * Contract for event-driven communication
 */

import type { AppEventMap } from '../events/EventTypes';

export type EventHandler<T = any> = (data?: T) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe: () => void;
}

export interface IEventBus {
  /**
   * Subscribe to an event
   */
  on<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): EventSubscription;
  on(event: string, handler: EventHandler<any>): EventSubscription;

  /**
   * Subscribe to an event once
   */
  once<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): EventSubscription;
  once(event: string, handler: EventHandler<any>): EventSubscription;

  /**
   * Unsubscribe from an event
   */
  off<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): void;
  off(event: string, handler: EventHandler<any>): void;

  /**
   * Emit an event
   */
  emit<K extends keyof AppEventMap>(event: K, data?: AppEventMap[K]): void;
  emit(event: string, data?: any): void;

  /**
   * Clear all handlers for an event
   */
  clear(event?: string): void;

  /**
   * Get number of listeners for an event
   */
  listenerCount(event: string): number;
}
