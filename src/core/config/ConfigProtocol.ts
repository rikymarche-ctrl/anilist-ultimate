import { DEFAULT_CONFIG } from './defaults';
import type { AppConfig } from './types';
import type { ConfigManager } from './ConfigManager';

const enums: Record<string, string[]> = {
  'debug.logLevel': ['debug', 'info', 'warn', 'error'], 'calendar.startDay': ['0', '1', '2', '3', '4', '5', '6'],
  'calendar.layoutMode': ['standard', 'compact', 'extended'], 'calendar.timeFormat': ['release', 'countdown'],
  'calendar.titleAlignment': ['left', 'center', 'right'], 'calendar.columnJustify': ['top', 'center', 'bottom'],
};
export function validateConfigPatch(patch: unknown, defaults: unknown = DEFAULT_CONFIG, path = ''): asserts patch is Partial<AppConfig> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || JSON.stringify(patch).length > 32 * 1024) throw new Error('Invalid configuration patch');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unknown configuration key');
    const model = (defaults as Record<string, unknown>)[key];
    const field = path ? `${path}.${key}` : key;
    if (model && typeof model === 'object') validateConfigPatch(value, model, field);
    else if (typeof value !== typeof model || (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
      || (typeof value === 'string' && (value.length > 2048 || (enums[field] && !enums[field].includes(value))
        || (field === 'theme.accentColor' && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))))) throw new Error('Invalid configuration value');
  }
}

export async function dispatchConfigCommand(config: ConfigManager, operation: unknown, value: unknown): Promise<AppConfig> {
  if (!['get', 'patch', 'feature', 'reset'].includes(operation as string)) throw new Error('Unknown configuration operation');
  if (operation === 'patch') validateConfigPatch(value);
  if (operation === 'feature' && (!value || typeof value !== 'object' || Array.isArray(value)
    || !('feature' in value) || typeof value.feature !== 'string' || !Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG.features, value.feature)
    || !('enabled' in value) || typeof value.enabled !== 'boolean')) throw new Error('Invalid feature update');
  await config.load();
  if (operation === 'patch') await config.applyPatch(value as Partial<AppConfig>);
  if (operation === 'reset') await config.reset();
  if (operation === 'feature') {
    const update = value as { feature: keyof AppConfig['features']; enabled: boolean };
    await config.setFeature(update.feature, update.enabled);
  }
  return config.getAll();
}

/** Send only fields that the editing client actually changed. */
export function configDifference(before: unknown, after: unknown): unknown {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return after;
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((before as Record<string, unknown>)?.[key]))
    .map(([key, value]) => [key, configDifference((before as Record<string, unknown>)?.[key], value)]));
}
