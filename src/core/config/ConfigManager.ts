/**
 * @file ConfigManager.ts
 * @description Centralized configuration management with feature flags and persistence
 *
 * Manages the complete application configuration including:
 *   - Feature flags (enable/disable individual modules at runtime)
 *   - API settings (endpoint, timeout, rate limiting)
 *   - OAuth configuration
 *   - Calendar preferences
 *   - Cache durations
 *   - Debug settings
 *
 * Configuration is persisted to chrome.storage.sync and synced across devices.
 * On load, stored config is deep-merged with defaults to handle schema evolution
 * (new keys added in updates are automatically populated from defaults).
 *
 * Change notifications are provided via:
 *   - onChange(key, callback) - per-key listeners
 *   - EventBus CONFIG_CHANGED events - global notification
 *
 * @see types.ts for the AppConfig interface
 * @see defaults.ts for default values
 * @see docs/ARCHITECTURE.md#44-configuration-manager
 */

import { injectable, inject } from 'tsyringe';
import type { AppConfig, ConfigChangeCallback } from './types';
import { DEFAULT_CONFIG } from './defaults';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { EVENT_TYPES } from '@core/events/EventTypes';
// Single source of truth for the contract lives in core/interfaces.
import type { IConfigManager } from '@core/interfaces/IConfigManager';

/**
 * Configuration Manager Implementation
 * Manages application configuration with runtime control and persistence
 */
@injectable()
export class ConfigManager implements IConfigManager {
  /**
   * Current configuration
   */
  private config: AppConfig;

  /**
   * Change listeners
   * Map<configKey, Set<callback>>
   */
  private listeners = new Map<string, Set<ConfigChangeCallback<any>>>();

  /**
   * Storage key for configuration
   */
  private readonly STORAGE_KEY = 'anilist_ultimate_config';

  constructor(
    @inject(TOKENS.Storage) private storage: IStorageService,
    @inject(TOKENS.EventBus) private eventBus?: IEventBus
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load configuration from storage
   */
  async load(): Promise<void> {
    try {
      const stored = (await this.storage.get(this.STORAGE_KEY)) as Partial<AppConfig> | null;

      if (stored) {
        // Merge stored config with defaults (in case new keys were added)
        this.config = this.deepMerge(DEFAULT_CONFIG, stored);
      }
    } catch (error) {
      console.error('[ConfigManager] Failed to load configuration:', error);
      // Use defaults on error
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Save configuration to storage
   */
  async save(): Promise<void> {
    try {
      await this.storage.set(this.STORAGE_KEY, this.config);
    } catch (error) {
      console.error('[ConfigManager] Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Get a configuration value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /**
   * Set a configuration value
   */
  async set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    const oldValue = this.config[key];

    // Update config
    this.config[key] = value;

    // Persist to storage
    await this.save();

    // Notify listeners
    this.notifyListeners(key, value, oldValue);

    // Emit CONFIG_CHANGED event
    this.eventBus?.emit(EVENT_TYPES.CONFIG_CHANGED, {
      key: key as string,
      value,
      previousValue: oldValue,
      timestamp: new Date(),
    });
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
    return this.config.features[feature] ?? false;
  }

  /**
   * Enable/disable a feature
   */
  async setFeature(feature: keyof AppConfig['features'], enabled: boolean): Promise<void> {
    const oldValue = this.config.features[feature];

    // Update feature flag
    this.config.features[feature] = enabled;

    // Persist to storage
    await this.save();

    // Notify listeners (both specific feature and general features)
    this.notifyListeners(`features.${feature}`, enabled, oldValue);
    this.notifyListeners('features', this.config.features, {
      ...this.config.features,
      [feature]: oldValue,
    });

    // Emit CONFIG_CHANGED event
    this.eventBus?.emit(EVENT_TYPES.CONFIG_CHANGED, {
      key: `features.${feature}`,
      value: enabled,
      previousValue: oldValue,
      timestamp: new Date(),
    });
  }

  /**
   * Watch for configuration changes
   */
  onChange<K extends keyof AppConfig>(key: K, callback: ConfigChangeCallback<K>): () => void {
    const keyStr = String(key);

    if (!this.listeners.has(keyStr)) {
      this.listeners.set(keyStr, new Set());
    }

    this.listeners.get(keyStr)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(keyStr)?.delete(callback);
    };
  }

  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    const oldConfig = { ...this.config };

    // Reset to defaults
    this.config = { ...DEFAULT_CONFIG };

    // Persist to storage
    await this.save();

    // Notify all listeners
    Object.keys(this.config).forEach((key) => {
      const configKey = key as keyof AppConfig;
      this.notifyListeners(configKey, this.config[configKey], oldConfig[configKey]);
    });
  }

  /**
   * Get all configuration
   */
  getAll(): AppConfig {
    return { ...this.config };
  }

  /**
   * Notify change listeners
   */
  private notifyListeners<K extends keyof AppConfig>(
    key: K | string,
    newValue: any,
    oldValue?: any
  ): void {
    const listeners = this.listeners.get(String(key));

    if (listeners && listeners.size > 0) {
      listeners.forEach((callback) => {
        try {
          callback(newValue, oldValue);
        } catch (error) {
          console.error(`[ConfigManager] Listener error for "${String(key)}":`, error);
        }
      });
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const targetValue = target[key];
        const sourceValue = source[key];

        if (this.isPlainObject(targetValue) && this.isPlainObject(sourceValue)) {
          result[key] = this.deepMerge(
            targetValue as Record<string, any>,
            sourceValue as Record<string, any>
          ) as T[Extract<keyof T, string>];
        } else if (sourceValue !== undefined) {
          result[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }

    return result;
  }

  /**
   * Check if value is a plain object
   */
  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && value.constructor === Object;
  }
}
