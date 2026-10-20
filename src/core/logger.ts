/**
 * @file logger.ts
 * @description Styled console logging utility with level-based filtering
 *
 * Provides a Logger class implementing ILogger, plus a singleton `logger`
 * instance used throughout the codebase.
 *
 * Log Levels (ascending severity):
 *   debug → info → warn → error
 *
 * Features:
 *   - Styled output with prefix and icons per level
 *   - Group/table/time helpers for structured diagnostics
 *   - Runtime enable/disable toggle
 *   - Error-level logs always emitted (bypass enabled flag)
 *
 * @see docs/ARCHITECTURE.md#logging
 */

import { injectable } from 'tsyringe';
import { DEBUG } from './constants';
import type { LogLevel } from './types';
import type { ILogger } from './interfaces/ILogger';
import { diagnosticText, diagnosticValue } from './errors/DiagnosticPrivacy';

/**
 * Logger - Styled console logging with levels
 * Implements ILogger interface for dependency injection
 */
@injectable()
class Logger implements ILogger {
  private enabled: boolean;
  private prefix: string;

  constructor(enabled: boolean = DEBUG.ENABLED) {
    this.enabled = enabled;
    this.prefix = DEBUG.LOG_PREFIX;
  }

  /**
   * Debug level log (verbose)
   */
  debug(message: string, ...data: unknown[]): void {
    if (!this.enabled) return;
    this.log('debug', message, ...data);
  }

  /**
   * Info level log (general)
   */
  info(message: string, ...data: unknown[]): void {
    if (!this.enabled) return;
    this.log('info', message, ...data);
  }

  /**
   * Warning level log
   */
  warn(message: string, ...data: unknown[]): void {
    if (!this.enabled) return;
    this.log('warn', message, ...data);
  }

  /**
   * Error level log
   */
  error(message: string, error?: Error | unknown, ...data: unknown[]): void {
    this.log('error', message, error, ...data);
  }

  /**
   * Success log (for completions)
   */
  success(message: string, ...data: unknown[]): void {
    if (!this.enabled) return;
    console.log(`%c${this.prefix} ✓ ${diagnosticText(message)}`, DEBUG.LOG_STYLES.success, ...(import.meta.env.DEV ? data.map(value => diagnosticValue(value)) : []));
  }

  /**
   * Group logs together
   */
  group(label: string, collapsed: boolean = false): void {
    if (!this.enabled) return;
    if (collapsed) {
      console.groupCollapsed(`${this.prefix} ${diagnosticText(label)}`);
    } else {
      console.group(`${this.prefix} ${diagnosticText(label)}`);
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
    console.time(`${this.prefix} ${diagnosticText(label)}`);
  }

  /**
   * End timing
   */
  timeEnd(label: string): void {
    if (!this.enabled) return;
    console.timeEnd(`${this.prefix} ${diagnosticText(label)}`);
  }

  /**
   * Log a table
   */
  table(data: unknown): void {
    if (!this.enabled || !import.meta.env.DEV) return;
    console.table(diagnosticValue(data));
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
  private log(level: LogLevel, message: string, ...data: unknown[]): void {
    const style = DEBUG.LOG_STYLES[level === 'debug' ? 'info' : level] || '';
    const icon = this.getIcon(level);

    // Error objects from GraphQL can include request headers, tokens and notes.
    // Production diagnostics keep the contextual message without payloads.
    if (data.length > 0 && import.meta.env.DEV) {
      console.log(`%c${this.prefix} ${icon} ${diagnosticText(message)}`, style, ...data.map(value => diagnosticValue(value)));
    } else {
      console.log(`%c${this.prefix} ${icon} ${diagnosticText(message)}`, style);
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

export const logger = new Logger();
