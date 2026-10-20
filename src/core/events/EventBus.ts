/**
 * @file EventBus.ts
 * @description Centralized Pub/Sub Event Bus for module communication
 *
 * Provides type-safe event emission and subscription via AppEventMap.
 * All modules communicate through this bus to avoid direct dependencies.
 *
 * Features:
 *   - Type-safe events (event name -> payload type mapping)
 *   - Async error handling (handler errors don't crash emitters)
 *   - once() for single-fire subscriptions
 *   - Debug mode for event tracing
 *   - Automatic cleanup of empty handler sets
 *   - Error events re-emitted to 'error:occurred' for centralized handling
 *
 * Usage:
 *   eventBus.on('navigation:page-changed', (data) => { ... });
 *   eventBus.emit('navigation:page-changed', { path: '/home', ... });
 *
 * @see EventTypes.ts for all event definitions and payload types
 * @see docs/ARCHITECTURE.md#42-event-bus
 */

import { injectable } from 'tsyringe';
import { IEventBus, EventHandler, EventSubscription, EventPayload, EventArguments } from '../interfaces/IEventBus';
import { logger } from '../logger';

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
  private handlers = new Map<string, Set<EventHandler<never>>>();

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
  on<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): EventSubscription {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)!.add(handler);

    if (this.debugMode) {
      logger.debug(`[EventBus] Subscribed to "${event}" (${this.listenerCount(event)} listeners)`);
    }

    // Return unsubscribe function
    return {
      unsubscribe: () => this.off(event, handler),
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first emit)
   */
  once<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): EventSubscription {
    const wrapper: EventHandler<EventPayload<NoInfer<K>>> = (data) => {
      this.off(event, wrapper);
      return handler(data);
    };

    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends string>(event: K, handler: EventHandler<EventPayload<NoInfer<K>>>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);

      if (this.debugMode) {
        logger.debug(
          `[EventBus] Unsubscribed from "${event}" (${this.listenerCount(event)} listeners)`
        );
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
  emit<K extends string>(event: K, ...args: EventArguments<NoInfer<K>>): void {
    const [data] = args;
    const handlers = this.handlers.get(event);

    if (this.debugMode) {
      logger.debug(`[EventBus] Emitting "${event}"`);
    }

    if (!handlers || handlers.size === 0) {
      if (this.debugMode) {
        logger.debug(`[EventBus] No listeners for "${event}"`);
      }
      return;
    }

    // Note: errors are caught and logged. A throwing handler must NOT crash the
    // emit or prevent the remaining handlers from running. Snapshot the set so
    // unsubscribes during emit (e.g. once()) don't skip handlers.
    [...handlers].forEach((handler) => {
      try {
        // Registry erases each payload type; the public API preserves the
        // event/payload relationship. Dispatch is the single erasure boundary.
        const result = handler(data as never);
        // Async handlers: catch their rejections too.
        if (result !== undefined) {
          // Promise.resolve also assimilates promises from other realms.
          void Promise.resolve(result).catch(error => this.handleHandlerError(event, error));
        }
      } catch (error) {
        // Synchronous handler throw.
        this.handleHandlerError(event, error);
      }
    });
  }

  /**
   * Centralized handling of an error thrown/rejected by an event handler.
   */
  private handleHandlerError(event: string, error: unknown): void {
    logger.error(`[EventBus] Handler error for event "${event}"`, {
      event,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Emit error event for centralized error handling (avoid infinite loop).
    if (event !== 'error:occurred') {
      this.emit('error:occurred', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: `EventBus handler for ${event}`,
        severity: 'high' as const,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Clear all handlers for an event (or all events if no event specified)
   */
  clear(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      if (this.debugMode) {
        logger.debug(`[EventBus] Cleared all handlers for "${event}"`);
      }
    } else {
      this.handlers.clear();
      if (this.debugMode) {
        logger.debug('[EventBus] Cleared all handlers');
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
