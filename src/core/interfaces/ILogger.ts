/**
 * @file ILogger.ts
 * @description Contract for logging services used across the application
 *
 * Defines log levels (debug, info, warn, error, success) plus group,
 * time, and enable/disable lifecycle methods. Implemented by Logger
 * in logger.ts and resolved via DI token TOKENS.Logger.
 *
 * @see logger.ts for the concrete implementation
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface ILogger {
  /**
   * Log debug message
   */
  debug(message: string, ...args: any[]): void;

  /**
   * Log info message
   */
  info(message: string, ...args: any[]): void;

  /**
   * Log warning message
   */
  warn(message: string, ...args: any[]): void;

  /**
   * Log error message
   */
  error(message: string, ...args: any[]): void;

  /**
   * Log success message
   */
  success(message: string, ...args: any[]): void;

  /**
   * Start a console group
   */
  group(label: string): void;

  /**
   * End a console group
   */
  groupEnd(): void;

  /**
   * Start a timer
   */
  time(label: string): void;

  /**
   * End a timer
   */
  timeEnd(label: string): void;

  /**
   * Enable logging
   */
  enable(): void;

  /**
   * Disable logging
   */
  disable(): void;

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean;
}
