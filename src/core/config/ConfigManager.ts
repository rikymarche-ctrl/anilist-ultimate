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
import { logger } from '@core/logger';
import { validateConfigPatch } from './ConfigProtocol';

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
  private listeners = new Map<string, Set<(newValue: never, oldValue?: never) => void | Promise<void>>>();

  /**
   * Storage key for configuration
   */
  private readonly STORAGE_KEY = 'anilist_ultimate_config';
  private writes: Promise<void> = Promise.resolve();

  /** Background managers always publish; retired foreground views override this hook. */
  protected canPublish(): boolean { return true; }
  protected clearChangeListeners(): void { this.listeners.clear(); }

  private withWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation, operation);
    this.writes = result.then(() => undefined, () => undefined);
    return result;
  }

  constructor(
    @inject(TOKENS.Storage) private storage: IStorageService,
    @inject(TOKENS.EventBus) private eventBus?: IEventBus
  ) {
    this.config = structuredClone(DEFAULT_CONFIG);
  }

  /**
   * Load configuration from storage
   */
  async load(): Promise<void> {
    return this.withWrite(async () => {
    try {
      const stored = (await this.storage.get(this.STORAGE_KEY)) as Partial<AppConfig> | null;

      this.applyConfigSnapshot(stored ? this.deepMerge(DEFAULT_CONFIG, stored) : DEFAULT_CONFIG);
    } catch (error) {
      logger.error('[ConfigManager] Failed to load configuration', error);
      throw error;
    }
    });
  }

  /**
   * Save configuration to storage
   */
  async save(): Promise<void> {
    return this.withWrite(async () => {
    try {
      if (!(await this.storage.set(this.STORAGE_KEY, this.config))) throw new Error('Configuration storage write failed');
    } catch (error) {
      logger.error('[ConfigManager] Failed to save configuration', error);
      throw error;
    }
    });
  }

  /**
   * Get a configuration value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return structuredClone(this.config[key]);
  }

  /**
   * Set a configuration value
   */
  async set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    validateConfigPatch({ [key]: value });
    return this.withWrite(async () => {
    const oldValue = this.config[key];
    const candidate = { ...this.config, [key]: structuredClone(value) };
    if (!(await this.storage.set(this.STORAGE_KEY, candidate))) throw new Error('Configuration storage write failed');
    if (!this.canPublish()) return;
    this.config = candidate;

    // Notify listeners
    this.notifyListeners(key, value, oldValue);

    // Emit CONFIG_CHANGED event
    if (this.canPublish()) this.eventBus?.emit(EVENT_TYPES.CONFIG_CHANGED, {
      key: key as string,
      value,
      previousValue: oldValue,
      timestamp: new Date(),
    });
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
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG.features, feature) || typeof enabled !== 'boolean') throw new Error('Invalid feature update');
    return this.withWrite(async () => {
    const oldValue = this.config.features[feature];
    const previous = this.config.features;
    const features = { ...previous, [feature]: enabled };
    const candidate = { ...this.config, features };
    if (!(await this.storage.set(this.STORAGE_KEY, candidate))) throw new Error('Configuration storage write failed');
    if (!this.canPublish()) return;
    this.config = candidate;

    // Notify listeners (both specific feature and general features)
    this.notifyListeners(`features.${feature}`, enabled, oldValue);
    this.notifyListeners('features', this.config.features, {
      ...this.config.features,
      [feature]: oldValue,
    });

    // Emit CONFIG_CHANGED event
    if (this.canPublish()) this.eventBus?.emit(EVENT_TYPES.CONFIG_CHANGED, {
      key: `features.${feature}`,
      value: enabled,
      previousValue: oldValue,
      timestamp: new Date(),
    });
    });
  }

  /**
   * Watch for configuration changes
   */
  onChange<K extends keyof AppConfig>(key: K, callback: ConfigChangeCallback<K>): () => void {
    if (!this.canPublish()) return () => {};
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
    return this.withWrite(async () => {
    const oldConfig = { ...this.config };

    // Reset to defaults
    const candidate = structuredClone(DEFAULT_CONFIG);
    if (!(await this.storage.set(this.STORAGE_KEY, candidate))) throw new Error('Configuration storage write failed');
    if (!this.canPublish()) return;
    this.config = candidate;

    // Notify all listeners
    Object.keys(this.config).forEach((key) => {
      const configKey = key as keyof AppConfig;
      this.notifyListeners(configKey, this.config[configKey], oldConfig[configKey]);
    });
    });
  }

  /**
   * Get all configuration
   */
  getAll(): AppConfig {
    return structuredClone(this.config);
  }

  public applyPatch(patch: Partial<AppConfig>): Promise<void> {
    validateConfigPatch(patch);
    return this.withWrite(async () => {
      const candidate = this.deepMerge(this.config, patch);
      if (!(await this.storage.set(this.STORAGE_KEY, candidate))) throw new Error('Configuration storage write failed');
      this.applyConfigSnapshot(candidate);
    });
  }

  protected applyConfigSnapshot(candidate: AppConfig): void {
    if (!this.canPublish()) return;
    const previous = this.config;
    this.config = structuredClone(candidate);
    for (const key of Object.keys(candidate) as (keyof AppConfig)[]) {
      if (!this.canPublish()) return;
      if (JSON.stringify(previous[key]) === JSON.stringify(candidate[key])) continue;
      this.notifyListeners(key, candidate[key], previous[key]);
      if (this.canPublish()) this.eventBus?.emit(EVENT_TYPES.CONFIG_CHANGED, { key, value: structuredClone(candidate[key]), previousValue: structuredClone(previous[key]), timestamp: new Date() });
    }
  }

  /**
   * Notify change listeners
   */
  private notifyListeners<K extends keyof AppConfig>(
    key: K | string,
    newValue: unknown,
    oldValue?: unknown
  ): void {
    if (!this.canPublish()) return;
    const listeners = this.listeners.get(String(key));

    if (listeners && listeners.size > 0) {
      for (const callback of listeners) {
        if (!this.canPublish()) return;
        try {
          // The keyed public subscription retains its exact AppConfig value type.
          const result = callback(structuredClone(newValue) as never, structuredClone(oldValue) as never);
          if (result !== undefined) void Promise.resolve(result).catch(error => logger.error(`[ConfigManager] Listener error for "${String(key)}"`, error));
        } catch (error) {
          logger.error(`[ConfigManager] Listener error for "${String(key)}"`, error);
        }
      }
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<T extends object>(target: T, source: unknown, path = ''): T {
    const result = structuredClone(target);
    if (!this.isPlainObject(source)) return result;
    const values = result as Record<string, unknown>;
    const original = target as Record<string, unknown>;
    for (const [key, sourceValue] of Object.entries(source)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.prototype.hasOwnProperty.call(original, key)) continue;
      const targetValue = original[key];
      const field = path ? `${path}.${key}` : key;
      if (this.isPlainObject(targetValue) && this.isPlainObject(sourceValue)) {
        values[key] = this.deepMerge(targetValue, sourceValue, field);
      } else if (!this.isPlainObject(targetValue) && sourceValue !== undefined) {
        try {
          validateConfigPatch({ [key]: sourceValue }, { [key]: targetValue }, path);
          values[key] = structuredClone(sourceValue);
        } catch {
          logger.warn(`[ConfigManager] Ignoring invalid stored setting: ${field}`);
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
