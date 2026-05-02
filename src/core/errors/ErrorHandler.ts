/**
 * @file ErrorHandler.ts
 * @description Centralized error handling, classification, and reporting
 *
 * Provides a single point of error management for the entire extension.
 * All errors flow through this handler, which:
 *   - Classifies errors by severity (Low, Medium, High, Critical)
 *   - Routes to type-specific handlers (API, Module, Storage, Auth, Config, Validation)
 *   - Maintains error history (last 100 errors) for diagnostics
 *   - Emits error events via EventBus for reactive error handling
 *   - Catches unhandled promise rejections and global errors
 *
 * Custom error types (see ErrorTypes.ts):
 *   - ApiError: HTTP/GraphQL failures (statusCode, endpoint, retryCount)
 *   - ModuleError: Module lifecycle failures (moduleName, context)
 *   - StorageError: Chrome storage operations (operation, storageKey)
 *   - ConfigError: Configuration issues (configKey)
 *   - AuthError: Authentication problems (reason)
 *   - ValidationError: Data validation (field, expectedType)
 *
 * @see docs/ARCHITECTURE.md#47-error-handling
 */

import { injectable, inject } from 'tsyringe';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';

import type { ILogger } from '@core/logger';
import {
  ApiError,
  ModuleError,
  StorageError,
  ConfigError,
  AuthError,
  ValidationError,
} from './ErrorTypes';

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

/**
 * Error Handler Interface
 */
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

  /**
   * Get formatted logs for diagnostics
   */
  getExportableLogs(): string;
}

/**
 * Error Handler Implementation
 */
@injectable()
export class ErrorHandler implements IErrorHandler {
  private errorCount = 0;
  private errorHistory: Array<{ error: Error; context?: string; timestamp: Date; severity: ErrorSeverity }> = [];
  private readonly MAX_ERROR_HISTORY = 100;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    // Logger and EventBus will be injected via DI
  }

  /**
   * Handle an error
   */
  handle(error: Error, context?: string, severity: ErrorSeverity = ErrorSeverity.Medium): void {
    this.errorCount++;

    // Add to error history
    this.errorHistory.push({
      error,
      context,
      timestamp: new Date(),
      severity,
    });

    // Keep history size limited
    if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
      this.errorHistory.shift();
    }

    // Log error with context
    const errorMessage = context ? `[${context}] ${error.message}` : error.message;

    switch (severity) {
      case ErrorSeverity.Critical:
        this.logger.error(`🔴 CRITICAL: ${errorMessage}`, error);
        break;
      case ErrorSeverity.High:
        this.logger.error(`🔴 ${errorMessage}`, error);
        break;
      case ErrorSeverity.Medium:
        this.logger.warn(`🟡 ${errorMessage}`, error);
        break;
      case ErrorSeverity.Low:
        this.logger.debug(`🔵 ${errorMessage}`, error);
        break;
    }

    // Emit error event
    this.eventBus.emit(EVENT_TYPES.ERROR_OCCURRED, {
      error,
      context: context || 'unknown',
      timestamp: new Date(),
      severity,
    });

    // Handle specific error types
    if (error instanceof ApiError) {
      this.handleApiError(error);
    } else if (error instanceof ModuleError) {
      this.handleModuleError(error);
    } else if (error instanceof StorageError) {
      this.handleStorageError(error);
    } else if (error instanceof AuthError) {
      this.handleAuthError(error);
    } else if (error instanceof ConfigError) {
      this.handleConfigError(error);
    } else if (error instanceof ValidationError) {
      this.handleValidationError(error);
    }
  }

  /**
   * Wrap an async function with error handling
   */
  wrap<T extends (...args: any[]) => Promise<any>>(fn: T, context?: string): T {
    return (async (...args: any[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handle(error as Error, context, ErrorSeverity.Medium);
        throw error;
      }
    }) as T;
  }

  /**
   * Setup global error listeners
   */
  setupGlobalHandlers(): void {
    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason));

      this.handle(error, 'Unhandled Promise Rejection', ErrorSeverity.High);
    });

    // Catch global errors
    window.addEventListener('error', (event) => {
      const error = event.error || new Error(event.message);
      this.handle(error, 'Global Error', ErrorSeverity.High);
    });

    this.logger.debug('[ErrorHandler] Global error handlers setup');
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalErrors: number;
    recentErrors: number;
    errorHistory: Array<{ error: Error; context?: string; timestamp: Date }>;
  } {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentErrors = this.errorHistory.filter(
      (entry) => entry.timestamp > oneHourAgo
    ).length;

    return {
      totalErrors: this.errorCount,
      recentErrors,
      errorHistory: [...this.errorHistory],
    };
  }

  /**
   * Get formatted logs for diagnostics
   */
  public getExportableLogs(): string {
    const lines = [
      `Astra Ultimate - Error Diagnostics Report`,
      `Generated: ${new Date().toISOString()}`,
      `Total Errors since start: ${this.errorCount}`,
      `-------------------------------------------`,
      '',
    ];

    [...this.errorHistory].reverse().forEach((entry, i) => {
      lines.push(`[${i + 1}] ${entry.timestamp.toISOString()} | ${entry.severity.toUpperCase()}`);
      lines.push(`Context: ${entry.context || 'N/A'}`);
      lines.push(`Message: ${entry.error.message}`);
      if (entry.error.stack) {
        lines.push(`Stack: ${entry.error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
      lines.push('---');
    });

    return lines.join('\n');
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
    this.logger.debug('[ErrorHandler] Error history cleared');
  }

  // ============================================================================
  // Specific Error Handlers
  // ============================================================================

  /**
   * Handle API errors
   */
  private handleApiError(error: ApiError): void {
    this.eventBus.emit(EVENT_TYPES.API_ERROR, {
      error,
      context: error.endpoint || 'unknown',
      statusCode: error.statusCode,
      timestamp: new Date(),
      severity: this.getApiErrorSeverity(error),
    });

    // Rate limit errors
    if (error.statusCode === 429) {
      this.logger.warn('Rate limit exceeded, backing off...');
    }

    // Authentication errors
    if (error.statusCode === 401 || error.statusCode === 403) {
      this.eventBus.emit(EVENT_TYPES.AUTH_REQUIRED);
    }
  }

  /**
   * Handle module errors
   */
  private handleModuleError(error: ModuleError): void {
    this.eventBus.emit(EVENT_TYPES.MODULE_INITIALIZATION_ERROR, {
      error,
      module: error.moduleName,
      context: error.context || 'unknown',
      timestamp: new Date(),
      severity: ErrorSeverity.High,
    });

    this.logger.error(`Module "${error.moduleName}" error:`, error);
  }

  /**
   * Handle storage errors
   */
  private handleStorageError(error: StorageError): void {
    this.eventBus.emit(EVENT_TYPES.STORAGE_ERROR, {
      error,
      context: error.context || 'unknown',
      timestamp: new Date(),
      severity: ErrorSeverity.Medium,
    });

    this.logger.error(`Storage operation "${error.operation}" failed:`, error);
  }

  /**
   * Handle authentication errors
   */
  private handleAuthError(error: AuthError): void {
    this.eventBus.emit(EVENT_TYPES.AUTH_REQUIRED);
    this.logger.warn(`Authentication error (${error.reason}):`, error.message);
  }

  /**
   * Handle configuration errors
   */
  private handleConfigError(error: ConfigError): void {
    this.logger.error(`Configuration error${error.configKey ? ` for "${error.configKey}"` : ''}:`, error);
  }

  /**
   * Handle validation errors
   */
  private handleValidationError(error: ValidationError): void {
    this.logger.warn(`Validation error${error.field ? ` for field "${error.field}"` : ''}:`, error.message);
  }

  /**
   * Determine API error severity based on status code
   */
  private getApiErrorSeverity(error: ApiError): ErrorSeverity {
    if (!error.statusCode) {
      return ErrorSeverity.High; // Network error
    }

    if (error.statusCode >= 500) {
      return ErrorSeverity.High; // Server error
    }

    if (error.statusCode === 429) {
      return ErrorSeverity.Medium; // Rate limit
    }

    if (error.statusCode === 401 || error.statusCode === 403) {
      return ErrorSeverity.Medium; // Auth error
    }

    return ErrorSeverity.Low; // Client error
  }
}
