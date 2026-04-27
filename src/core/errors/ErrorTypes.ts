/**
 * @file ErrorTypes.ts
 * @description Typed error class hierarchy for structured error handling
 *
 * All custom errors extend AppError, which captures context and
 * originalError for chain-of-cause debugging. Subclasses:
 *   - ModuleError: module lifecycle failures (name, context)
 *   - ApiError: network/GraphQL errors (statusCode, endpoint, retryable check)
 *   - StorageError: chrome.storage failures (operation, key)
 *   - ConfigError: configuration load/merge failures (configKey)
 *   - AuthError: authentication issues (reason enum)
 *   - ValidationError: input validation failures (field, value)
 *
 * @see ErrorHandler.ts for centralized error routing
 * @see docs/ARCHITECTURE.md#error-handling
 */

/**
 * Base Application Error
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly context?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Module-specific errors
 */
export class ModuleError extends AppError {
  constructor(
    public readonly moduleName: string,
    message: string,
    context?: string,
    originalError?: Error
  ) {
    super(message, context, originalError);
    this.name = 'ModuleError';
    Object.setPrototypeOf(this, ModuleError.prototype);
  }
}

/**
 * API/Network errors
 */
export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    public readonly retryCount?: number,
    originalError?: Error
  ) {
    super(message, endpoint, originalError);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    // Retry on 5xx errors or network errors
    return (
      this.statusCode === undefined || // Network error
      (this.statusCode >= 500 && this.statusCode < 600) || // Server error
      this.statusCode === 429 // Rate limit
    );
  }
}

/**
 * Storage operation errors
 */
export class StorageError extends AppError {
  constructor(
    message: string,
    public readonly operation: 'get' | 'set' | 'remove' | 'clear',
    public readonly key?: string,
    originalError?: Error
  ) {
    super(message, `Storage ${operation}${key ? ` for key "${key}"` : ''}`, originalError);
    this.name = 'StorageError';
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends AppError {
  constructor(
    message: string,
    public readonly configKey?: string,
    originalError?: Error
  ) {
    super(message, configKey, originalError);
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

/**
 * Authentication errors
 */
export class AuthError extends AppError {
  constructor(
    message: string,
    public readonly reason: 'token_missing' | 'token_expired' | 'token_invalid' | 'unauthorized',
    originalError?: Error
  ) {
    super(message, reason, originalError);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: any,
    originalError?: Error
  ) {
    super(message, field, originalError);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
