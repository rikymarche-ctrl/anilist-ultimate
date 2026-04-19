/**
 * Logger Utility
 * Consistent logging with styling and levels
 */

import { DEBUG } from './constants';
import type { LogLevel } from './types';

class Logger {
  private enabled: boolean;
  private prefix: string;

  constructor(enabled: boolean = DEBUG.ENABLED) {
    this.enabled = enabled;
    this.prefix = DEBUG.LOG_PREFIX;
  }

  /**
   * Debug level log (verbose)
   */
  debug(message: string, ...data: any[]): void {
    if (!this.enabled) return;
    this.log('debug', message, ...data);
  }

  /**
   * Info level log (general)
   */
  info(message: string, ...data: any[]): void {
    if (!this.enabled) return;
    this.log('info', message, ...data);
  }

  /**
   * Warning level log
   */
  warn(message: string, ...data: any[]): void {
    if (!this.enabled) return;
    this.log('warn', message, ...data);
  }

  /**
   * Error level log
   */
  error(message: string, error?: Error | unknown, ...data: any[]): void {
    this.log('error', message, error, ...data);
  }

  /**
   * Success log (for completions)
   */
  success(message: string, ...data: any[]): void {
    if (!this.enabled) return;
    console.log(`%c${this.prefix} ✓ ${message}`, DEBUG.LOG_STYLES.success, ...data);
  }

  /**
   * Group logs together
   */
  group(label: string, collapsed: boolean = false): void {
    if (!this.enabled) return;
    if (collapsed) {
      console.groupCollapsed(`${this.prefix} ${label}`);
    } else {
      console.group(`${this.prefix} ${label}`);
    }
  }

  /**
   * End log group
   */
  groupEnd(): void {
    if (!this.enabled) return;
    console.groupEnd();
  }

  /**
   * Time a block of code
   */
  time(label: string): void {
    if (!this.enabled) return;
    console.time(`${this.prefix} ${label}`);
  }

  /**
   * End timing
   */
  timeEnd(label: string): void {
    if (!this.enabled) return;
    console.timeEnd(`${this.prefix} ${label}`);
  }

  /**
   * Log a table
   */
  table(data: any): void {
    if (!this.enabled) return;
    console.table(data);
  }

  /**
   * Enable logging
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable logging
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, ...data: any[]): void {
    const style = DEBUG.LOG_STYLES[level === 'debug' ? 'info' : level] || '';
    const icon = this.getIcon(level);

    if (data.length > 0) {
      console.log(`%c${this.prefix} ${icon} ${message}`, style, ...data);
    } else {
      console.log(`%c${this.prefix} ${icon} ${message}`, style);
    }
  }

  /**
   * Get icon for log level
   */
  private getIcon(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return '🔍';
      case 'info':
        return 'ℹ️';
      case 'warn':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return '';
    }
  }
}

// Singleton instance
export const logger = new Logger();

// Export convenience methods
export const log = {
  debug: (msg: string, ...data: any[]) => logger.debug(msg, ...data),
  info: (msg: string, ...data: any[]) => logger.info(msg, ...data),
  warn: (msg: string, ...data: any[]) => logger.warn(msg, ...data),
  error: (msg: string, error?: Error | unknown, ...data: any[]) => logger.error(msg, error, ...data),
  success: (msg: string, ...data: any[]) => logger.success(msg, ...data),
  group: (label: string, collapsed?: boolean) => logger.group(label, collapsed),
  groupEnd: () => logger.groupEnd(),
  time: (label: string) => logger.time(label),
  timeEnd: (label: string) => logger.timeEnd(label),
  table: (data: any) => logger.table(data),
};
