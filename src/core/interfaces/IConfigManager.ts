/**
 * @file IConfigManager.ts
 * @description Contract for the application configuration manager
 *
 * Defines typed get/set for AppConfig keys, feature-flag helpers,
 * onChange subscription for reactive config updates, and
 * load/save/reset lifecycle methods.
 *
 * @see ConfigManager.ts for the concrete implementation
 * @see config/types.ts for the AppConfig interface
 */

import type { AppConfig, ConfigChangeCallback } from '@core/config/types';

export interface IConfigManager {
  /**
   * Load configuration from storage
   */
  load(): Promise<void>;

  /**
   * Save configuration to storage
   */
  save(): Promise<void>;

  /**
   * Get a configuration value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K];

  /**
   * Set a configuration value
   */
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void>;

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof AppConfig['features']): boolean;

  /**
   * Enable/disable a feature
   */
  setFeature(feature: keyof AppConfig['features'], enabled: boolean): Promise<void>;

  /**
   * Watch for configuration changes
   */
  onChange<K extends keyof AppConfig>(key: K, callback: ConfigChangeCallback<K>): () => void;

  /**
   * Reset configuration to defaults
   */
  reset(): Promise<void>;

  /**
   * Get all configuration
   */
  getAll(): AppConfig;
}
