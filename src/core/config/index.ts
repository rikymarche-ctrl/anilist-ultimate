/**
 * Configuration Module
 * Barrel export for configuration management
 */

export { ConfigManager, type IConfigManager } from './ConfigManager';
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
