/**
 * @file IErrorHandler.ts
 * @description Contract for centralized error handling and global listeners
 *
 * Defines handle(), async wrapper, and global handler setup methods.
 *
 * @see ErrorHandler.ts for the concrete implementation
 * @see ErrorTypes.ts for the error class hierarchy
 */

import type { ErrorSeverity } from '@core/errors/ErrorHandler';

export interface IErrorHandler {
  /**
   * Handle an error
   */
  handle(error: Error, context?: string, severity?: ErrorSeverity): void;

  /**
   * Wrap an async function with error handling
   */
  wrap<T extends (...args: any[]) => Promise<any>>(fn: T, context?: string): T;

  /**
   * Setup global error listeners
   */
  setupGlobalHandlers(): void;
}
