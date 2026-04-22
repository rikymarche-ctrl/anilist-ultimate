/**
 * Logger Interface
 * Contract for logging services
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
