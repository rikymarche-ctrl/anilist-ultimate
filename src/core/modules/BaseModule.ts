/**
 * @file BaseModule.ts
 * @description Abstract base class for all feature modules
 *
 * Provides common infrastructure that every module needs:
 *
 *   - MutationObserver management with throttling and suspension
 *   - SPA navigation integration via EventBus (onPageChange)
 *   - Element waiting (waitForElement with timeout)
 *   - EventBus helpers (subscribe/emit)
 *   - Lifecycle management (cleanup/destroy with automatic resource cleanup)
 *
 * Anti-Stuttering Pattern:
 *   MutationObservers that modify the DOM will trigger themselves recursively.
 *   The suspend/resume pattern prevents this:
 *     1. suspendObserver(name) - mark observer as suspended
 *     2. Perform DOM modifications
 *     3. resumeObserver(name) - mark as active (with 50ms delay for DOM settling)
 *   While suspended, the observer callback is silently skipped.
 *
 * All feature modules MUST extend this class and implement:
 *   - init(): Promise<void>  - Module initialization
 *   - getName(): string      - Module identifier for logging
 *
 * @see docs/ARCHITECTURE.md#52-basemodule
 */

import { logger } from '../logger';
import type { IModule } from '../interfaces/IModule';
import { inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { IEventBus, EventSubscription, EventPayload, EventArguments } from '../interfaces/IEventBus';
import { EVENT_TYPES, AppEventMap } from '../events/EventTypes';
import type { PageChangedEvent } from '../events/EventTypes';
import { PERFORMANCE } from '../constants';

export abstract class BaseModule implements IModule {
  protected observers: Map<string, MutationObserver> = new Map();
  private observerTimeouts: Map<string, number> = new Map();
  private suspendedObservers: Set<string> = new Set();
  private eventSubscriptions: EventSubscription[] = [];
  private resumeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private waiters = new Set<() => void>();

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {}

  /**
   * Initialize the module
   */
  public abstract init(): Promise<void>;

  /**
   * Get module name (for identification and logging)
   */
  public abstract getName(): string;

  /**
   * Safe cleanup of common resources (observers, per-page stuff)
   */
  protected cleanup(): void {
    this.resumeTimeouts.forEach(timer => clearTimeout(timer)); this.resumeTimeouts.clear();
    for (const cancel of [...this.waiters]) cancel();
    this.observers.forEach((_observer, name) => {
      this.disconnectObserver(name);
    });
    this.observers.clear();
    this.suspendedObservers.clear();

    this.observerTimeouts.forEach(timeout => window.clearTimeout(timeout));
    this.observerTimeouts.clear();
  }

  /**
   * Full destruction
   */
  public async destroy(): Promise<void> {
    this.cleanup();
    
    // Unsubscribe from all events only on full destruction
    this.eventSubscriptions.forEach(sub => sub.unsubscribe());
    this.eventSubscriptions = [];

  }

  /**
   * Suspend an observer to prevent recursive loops (stuttering)
   */
  protected suspendObserver(name: string): void {
    this.suspendedObservers.add(name);
    logger.debug(`BaseModule: Suspended observer "${name}"`);
  }

  /**
   * Resume a suspended observer
   */
  protected resumeObserver(name: string): void {
    // Delay slightly to ensure browser has processed current mutations
    const previous = this.resumeTimeouts.get(name); if (previous) clearTimeout(previous);
    const observer = this.observers.get(name);
    const timer = setTimeout(() => {
      this.resumeTimeouts.delete(name);
      if (this.observers.get(name) !== observer) return;
      this.suspendedObservers.delete(name);
      logger.debug(`BaseModule: Resumed observer "${name}"`);
    }, 50);
    this.resumeTimeouts.set(name, timer);
  }

  /**
   * Register and manage a Throttled MutationObserver
   */
  protected registerObserver(
    name: string,
    target: Node,
    options: MutationObserverInit,
    callback: MutationCallback,
    throttleMs: number = PERFORMANCE.OBSERVER_THROTTLE_MS
  ): void {
    if (this.observers.has(name)) {
      this.disconnectObserver(name);
    }
    // A replacement observer starts active: drop the suspension and any pending
    // resume that were scheduled for the observer it replaces.
    const pendingResume = this.resumeTimeouts.get(name);
    if (pendingResume !== undefined) {
      clearTimeout(pendingResume);
      this.resumeTimeouts.delete(name);
    }
    this.suspendedObservers.delete(name);

    const observer = new MutationObserver((mutations, obs) => {
      // Skip if suspended
      if (this.suspendedObservers.has(name)) return;
      
      if (this.observerTimeouts.has(name)) return;

      const timeout = window.setTimeout(() => {
        this.observerTimeouts.delete(name);
        // Double check suspension status before callback
        if (!this.suspendedObservers.has(name)) {
          try { Promise.resolve(callback(mutations, obs)).catch(error => logger.error('Module observer callback failed', error)); }
          catch (error) { logger.error('Module observer callback failed', error); }
        }
      }, throttleMs);

      this.observerTimeouts.set(name, timeout);
    });

    observer.observe(target, options);
    this.observers.set(name, observer);
    logger.debug(`BaseModule: Registered observer "${name}"`);
  }

  protected disconnectObserver(name: string): void {
    this.observers.get(name)?.disconnect();
    this.observers.delete(name);

    // Clear pending timeout to prevent memory leak
    const timeout = this.observerTimeouts.get(name);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      this.observerTimeouts.delete(name);
    }
  }

  /**
   * Robust element waiter
   */
  protected waitForElement(selector: string, timeout: number = 10000): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) { resolve(element); return; }

      const start = Date.now();
      const finish = (value: HTMLElement | null) => { clearInterval(interval); this.waiters.delete(cancel); resolve(value); };
      const cancel = () => finish(null);
      const interval = setInterval(() => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) { finish(el); return; }
        if (Date.now() - start > timeout) {
          finish(null);
        }
      }, PERFORMANCE.ELEMENT_WAIT_CHECK_MS);
      this.waiters.add(cancel);
    });
  }

  /**
   * Subscribe to page navigation events
   * @param callback Function to call when page changes
   */
  protected onPageChange(callback: (event?: PageChangedEvent) => void): void {
    const unsubscribe = this.eventBus.on(EVENT_TYPES.PAGE_CHANGED, callback);
    this.eventSubscriptions.push(unsubscribe);
  }

  /**
   * Subscribe to any event via EventBus
   * @param eventType Event type to listen to
   * @param handler Event handler function
   */
  protected subscribe<K extends keyof AppEventMap>(eventType: K, handler: (data?: EventPayload<K>) => void): void {
    const unsubscribe = this.eventBus.on(eventType, handler);
    this.eventSubscriptions.push(unsubscribe);
  }

  /**
   * Emit an event via EventBus
   * @param eventType Event type to emit
   * @param data Event data
   */
  protected emit<K extends keyof AppEventMap>(eventType: K, ...args: EventArguments<NoInfer<K>>): void {
    this.eventBus.emit(eventType, ...args);
  }


}
