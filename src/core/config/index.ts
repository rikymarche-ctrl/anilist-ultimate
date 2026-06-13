/**
 * Configuration Module
 * Barrel export for configuration management
 */

export { ConfigManager } from './ConfigManager';
export type { IConfigManager } from '@core/interfaces/IConfigManager';
export { DEFAULT_CONFIG } from './defaults';
export type {
  AppConfig,
  FeatureFlags,
  DebugConfig,
  APIConfig,
  CalendarPreferences,
  CacheConfig,
  ConfigChangeCallback,
} from './types';
