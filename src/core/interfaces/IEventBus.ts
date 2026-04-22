/**
 * Event Bus Interface
 * Contract for event-driven communication
 */

export type EventHandler<T = any> = (data?: T) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe: () => void;
}

export interface IEventBus {
  /**
   * Subscribe to an event
   */
  on<T = any>(event: string, handler: EventHandler<T>): EventSubscription;

  /**
   * Subscribe to an event once
   */
  once<T = any>(event: string, handler: EventHandler<T>): EventSubscription;

  /**
   * Unsubscribe from an event
   */
  off<T = any>(event: string, handler: EventHandler<T>): void;

  /**
   * Emit an event
   */
  emit<T = any>(event: string, data?: T): void;

  /**
   * Clear all handlers for an event
   */
  clear(event?: string): void;

  /**
   * Get number of listeners for an event
   */
  listenerCount(event: string): number;
}
