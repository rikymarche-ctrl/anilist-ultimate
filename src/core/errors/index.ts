/**
 * Errors Module
 * Barrel export for error handling
 */

export { ErrorHandler, ErrorSeverity, type IErrorHandler } from './ErrorHandler';
export {
  AppError,
  ModuleError,
  ApiError,
  StorageError,
  ConfigError,
  AuthError,
  ValidationError,
} from './ErrorTypes';
