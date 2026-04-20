/**
 * Base Module Class
 * Centralizes common functionality for all extension modules
 * Includes anti-stuttering logic via observer suspension
 */

import { log } from '../logger';

export abstract class BaseModule {
  protected observers: Map<string, MutationObserver> = new Map();
  protected urlCheckInterval: number | null = null;
  protected lastPath: string = window.location.pathname;
  private observerTimeouts: Map<string, number> = new Map();
  private suspendedObservers: Set<string> = new Set();

  /**
   * Initialize the module
   */
  public abstract init(): Promise<void>;

  /**
   * Safe cleanup of common resources (observers, per-page stuff)
   */
  protected cleanup(): void {
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
  public destroy(): void {
    this.cleanup();
    if (this.urlCheckInterval) {
      window.clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
  }

  /**
   * Suspend an observer to prevent recursive loops (stuttering)
   */
  protected suspendObserver(name: string): void {
    this.suspendedObservers.add(name);
    log.debug(`BaseModule: Suspended observer "${name}"`);
  }

  /**
   * Resume a suspended observer
   */
  protected resumeObserver(name: string): void {
    // Delay slightly to ensure browser has processed current mutations
    setTimeout(() => {
      this.suspendedObservers.delete(name);
      log.debug(`BaseModule: Resumed observer "${name}"`);
    }, 50);
  }

  /**
   * Register and manage a Throttled MutationObserver
   */
  protected registerObserver(
    name: string,
    target: Node,
    options: MutationObserverInit,
    callback: MutationCallback,
    throttleMs: number = 200
  ): void {
    if (this.observers.has(name)) {
      this.disconnectObserver(name);
    }

    const observer = new MutationObserver((mutations, obs) => {
      // Skip if suspended
      if (this.suspendedObservers.has(name)) return;
      
      if (this.observerTimeouts.has(name)) return;

      const timeout = window.setTimeout(() => {
        this.observerTimeouts.delete(name);
        // Double check suspension status before callback
        if (!this.suspendedObservers.has(name)) {
          callback(mutations, obs);
        }
      }, throttleMs);

      this.observerTimeouts.set(name, timeout);
    });

    observer.observe(target, options);
    this.observers.set(name, observer);
    log.debug(`BaseModule: Registered observer "${name}"`);
  }

  private disconnectObserver(name: string): void {
    this.observers.get(name)?.disconnect();
    this.observers.delete(name);
  }

  /**
   * Robust element waiter
   */
  protected waitForElement(selector: string, timeout: number = 10000): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) { resolve(element); return; }

      const start = Date.now();
      const interval = setInterval(() => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) { clearInterval(interval); resolve(el); return; }
        if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, 300);
    });
  }

  /**
   * Centralized URL change detection
   */
  protected watchPageNavigation(callback: (path: string) => void): void {
    if (this.urlCheckInterval) return;

    this.urlCheckInterval = window.setInterval(() => {
      const currentPath = window.location.pathname;
      if (currentPath !== this.lastPath) {
        this.lastPath = currentPath;
        log.debug(`BaseModule: Page changed to "${currentPath}"`);
        callback(currentPath);
      }
    }, 500);
  }
}
