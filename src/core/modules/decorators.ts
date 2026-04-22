/**
 * Module Decorators
 * TypeScript decorators for module metadata
 */

import type { ModuleMetadata } from '@core/interfaces/IModule';

/**
 * Module decorator metadata storage
 */
const MODULE_METADATA = new Map<Function, Partial<ModuleMetadata>>();

/**
 * Module decorator options
 */
export interface ModuleDecoratorOptions {
  name?: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  critical?: boolean;
  pageMatch?: ModuleMetadata['pageMatch'];
  dependencies?: string[];
}

/**
 * @Module decorator
 * Marks a class as a module and stores metadata
 *
 * @example
 * ```typescript
 * @Module({
 *   name: 'calendar',
 *   enabled: true,
 *   pageMatch: (path) => path === '/home'
 * })
 * class CalendarModule implements IModule {
 *   // ...
 * }
 * ```
 */
export function Module(options: ModuleDecoratorOptions = {}) {
  return function (target: any) {
    MODULE_METADATA.set(target, options);
    return target;
  };
}

/**
 * Get module metadata from decorated class
 */
export function getModuleMetadata(target: Function): Partial<ModuleMetadata> | undefined {
  return MODULE_METADATA.get(target);
}

/**
 * Check if class has @Module decorator
 */
export function isModule(target: Function): boolean {
  return MODULE_METADATA.has(target);
}
