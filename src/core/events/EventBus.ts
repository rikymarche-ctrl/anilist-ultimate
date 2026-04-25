/**
 * Event Bus - Pub/Sub Pattern for Decoupled Communication
 * Enables modules to communicate without direct dependencies
 */

import { injectable } from 'tsyringe';
import { IEventBus, EventHandler, EventSubscription } from '../interfaces/IEventBus';
import { AppEventMap } from './EventTypes';

/**
 * Event Bus Implementation
 * Lightweight pub/sub system for decoupled module communication
 */
@injectable()
export class EventBus implements IEventBus {
  /**
   * Event handlers registry
   * Map<eventName, Set<handler>>
   */
  private handlers = new Map<string, Set<EventHandler<any>>>();

  /**
   * Debug mode - log all events
   */
  private debugMode = false;

  /**
   * Enable debug logging
   */
  enableDebug(): void {
    this.debugMode = true;
  }

  /**
   * Disable debug logging
   */
  disableDebug(): void {
    this.debugMode = false;
  }

  /**
   * Subscribe to an event
   */
  on<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): EventSubscription;
  on(event: string, handler: EventHandler<any>): EventSubscription;
  on(event: string, handler: EventHandler<any>): EventSubscription {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)!.add(handler);

    if (this.debugMode) {
      console.log(`[EventBus] Subscribed to "${event}" (${this.listenerCount(event)} listeners)`);
    }

    // Return unsubscribe function
    return {
      unsubscribe: () => this.off(event, handler),
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first emit)
   */
  once<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): EventSubscription;
  once(event: string, handler: EventHandler<any>): EventSubscription;
  once(event: string, handler: EventHandler<any>): EventSubscription {
    const wrapper: EventHandler<any> = (data) => {
      this.off(event, wrapper);
      return handler(data);
    };

    return this.on(event, wrapper);
  }


  /**
   * Unsubscribe from an event
   */
  off<K extends keyof AppEventMap>(event: K, handler: EventHandler<AppEventMap[K]>): void;
  off(event: string, handler: EventHandler<any>): void;
  off(event: string, handler: EventHandler<any>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);

      if (this.debugMode) {
        console.log(`[EventBus] Unsubscribed from "${event}" (${this.listenerCount(event)} listeners)`);
      }

      // Clean up empty handler sets
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Emit an event
   */
  emit<K extends keyof AppEventMap>(event: K, data?: AppEventMap[K]): void;
  emit(event: string, data?: any): void;
  emit(event: string, data?: any): void {
    const handlers = this.handlers.get(event);

    if (this.debugMode) {
      console.log(`[EventBus] Emitting "${event}"`, data);
    }

    if (!handlers || handlers.size === 0) {
      if (this.debugMode) {
        console.log(`[EventBus] No listeners for "${event}"`);
      }
      return;
    }

    // Call handlers asynchronously to avoid blocking
    handlers.forEach((handler) => {
      try {
        Promise.resolve(handler(data)).catch((error) => {
          console.error(`[EventBus] Handler error for "${event}":`, error);
        });
      } catch (error) {
        console.error(`[EventBus] Handler error for "${event}":`, error);
      }
    });
  }

  /**
   * Clear all handlers for an event (or all events if no event specified)
   */
  clear(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      if (this.debugMode) {
        console.log(`[EventBus] Cleared all handlers for "${event}"`);
      }
    } else {
      this.handlers.clear();
      if (this.debugMode) {
        console.log('[EventBus] Cleared all handlers');
      }
    }
  }

  /**
   * Get number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Get all registered events
   */
  getEvents(): string[] {
    return Array.from(this.handlers.keys());
  }
}
