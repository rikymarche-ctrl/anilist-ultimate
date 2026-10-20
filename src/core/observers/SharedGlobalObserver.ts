/**
 * @file SharedGlobalObserver.ts
 * @description Shared MutationObserver for modules that must observe document.body
 *
 * Performance Optimization (BUG-007):
 *   Instead of each module creating its own MutationObserver on document.body,
 *   multiple modules share a single observer to reduce overhead.
 *
 * Usage:
 *   - Modules inject SharedGlobalObserver via DI
 *   - Call register(name, callback, throttleMs) to subscribe
 *   - Call unregister(name) in cleanup/destroy
 *
 * The observer automatically starts when the first callback is registered
 * and stops when the last callback is unregistered.
 *
 * Throttling:
 *   Each callback has its own throttle timeout (default 200ms) to prevent
 *   excessive execution. This maintains the same behavior as BaseModule's
 *   registerObserver() but with a single shared observer.
 *
 * @see docs/PERFORMANCE.md#bug-007
 */

import { singleton } from 'tsyringe';
import { logger } from '@core/logger';
import { PERFORMANCE } from '@core/constants';

type ObserverCallback = (mutations: MutationRecord[], observer: MutationObserver) => unknown;
export type ObserverFilter = (mutations: MutationRecord[]) => boolean;

/** Match changes within a relevant subtree or inserted/removed matching content. */
export function mutationsMatchSelector(selector: string): ObserverFilter {
  const matches = (node: Node, descendants = false): boolean => {
    const element = node instanceof Element ? node : node.parentElement;
    return !!element && (element.matches(selector) || !!element.closest(selector)
      || (descendants && !!element.querySelector(selector)));
  };
  return mutations => mutations.some(mutation => matches(mutation.target)
    || Array.from(mutation.addedNodes).some(node => matches(node, true))
    || Array.from(mutation.removedNodes).some(node => matches(node, true)));
}

/**
 * SharedGlobalObserver - Single MutationObserver shared across modules
 *
 * Used by modules that need to observe document.body for elements that can
 * appear anywhere in the page (media cards, settings links, etc.)
 */
@singleton()
export class SharedGlobalObserver {
  private observer: MutationObserver | null = null;
  private callbacks: Map<string, ObserverCallback> = new Map();
  private throttleTimeouts: Map<string, number> = new Map();
  private isStarted = false;

  /**
   * Register a callback to be called when DOM mutations occur
   *
   * @param name Unique identifier for this callback
   * @param callback Function to call when mutations occur (throttled)
   * @param throttleMs Throttle delay in milliseconds (default: 200ms)
   */
  public register(name: string, callback: ObserverCallback, throttleMs: number = PERFORMANCE.OBSERVER_THROTTLE_MS,
    filter?: ObserverFilter): void {
    if (this.callbacks.has(name)) {
      logger.warn(`SharedGlobalObserver: Callback "${name}" already registered, replacing`);
      this.unregister(name);
    }

    // Wrap callback with throttling
    const throttledCallback: ObserverCallback = (mutations, obs) => {
      if (!this.isStarted || this.observer !== obs || this.callbacks.get(name) !== throttledCallback) return;
      // Check if throttle is active
      if (this.throttleTimeouts.has(name)) {
        return;
      }
      if (filter && !filter(mutations)) return;

      // Set throttle timeout
      const timeout = window.setTimeout(() => {
        if (this.throttleTimeouts.get(name) !== timeout) return;
        this.throttleTimeouts.delete(name);
        if (!this.isStarted || this.observer !== obs || this.callbacks.get(name) !== throttledCallback) return;
        try {
          Promise.resolve(callback(mutations, obs)).catch(error => {
            logger.error('SharedGlobalObserver: Callback error', error);
          });
        } catch (error) {
          logger.error('SharedGlobalObserver: Callback error', error);
        }
      }, throttleMs);

      this.throttleTimeouts.set(name, timeout);
    };

    this.callbacks.set(name, throttledCallback);
    logger.debug(`SharedGlobalObserver: Registered callback "${name}" (${this.callbacks.size} total)`);

    // Start observer if not already started
    if (!this.isStarted) {
      this.start();
    }
  }

  /**
   * Unregister a callback
   *
   * @param name Unique identifier for the callback to remove
   */
  public unregister(name: string): void {
    this.callbacks.delete(name);

    // Clear pending throttle timeout
    const timeout = this.throttleTimeouts.get(name);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      this.throttleTimeouts.delete(name);
    }

    logger.debug(`SharedGlobalObserver: Unregistered callback "${name}" (${this.callbacks.size} remaining)`);

    // Stop observer if no more callbacks
    if (this.callbacks.size === 0 && this.isStarted) {
      this.stop();
    }
  }

  /**
   * Start observing document.body
   */
  private start(): void {
    if (this.isStarted) return;

    this.observer = new MutationObserver((mutations, obs) => {
      if (!this.isStarted || this.observer !== obs) return;
      this.distribute(mutations, obs);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.isStarted = true;
    logger.info(`SharedGlobalObserver: Started observing document.body (${this.callbacks.size} callbacks)`);
  }

  /**
   * Stop observing
   */
  private stop(): void {
    if (!this.isStarted || !this.observer) return;

    this.observer.disconnect();
    this.observer = null;
    this.isStarted = false;

    logger.info('SharedGlobalObserver: Stopped observing');
  }

  /**
   * Distribute mutations to all registered callbacks
   */
  private distribute(mutations: MutationRecord[], obs: MutationObserver): void {
    // Call each registered callback (throttling is handled in the wrapper)
    this.callbacks.forEach((callback) => {
      try {
        callback(mutations, obs);
      } catch (error) {
        logger.error('SharedGlobalObserver: Callback error', error);
      }
    });
  }

  /**
   * Get current status (for debugging)
   */
  public getStatus(): { isStarted: boolean; callbackCount: number; callbacks: string[] } {
    return {
      isStarted: this.isStarted,
      callbackCount: this.callbacks.size,
      callbacks: Array.from(this.callbacks.keys()),
    };
  }

  /**
   * Cleanup all callbacks and stop observer
   * (Called during extension shutdown or testing)
   */
  public destroy(): void {
    // Clear all throttle timeouts
    this.throttleTimeouts.forEach(timeout => window.clearTimeout(timeout));
    this.throttleTimeouts.clear();

    // Clear callbacks
    this.callbacks.clear();

    // Stop observer
    this.stop();

    logger.info('SharedGlobalObserver: Destroyed');
  }
}
