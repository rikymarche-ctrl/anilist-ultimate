/**
 * @file decorators.ts
 * @description TypeScript class decorators for annotating modules with metadata
 *
 * Provides the @Module() decorator that stores ModuleMetadata (name, page
 * matcher, critical flag, dependencies) in a WeakMap-like registry. Used
 * by ModuleLoader and ModuleRegistry to discover and configure modules
 * via reflection.
 *
 * @example
 *   @Module({ name: 'calendar', enabled: true, critical: true })
 *   class CalendarModule implements IModule { ... }
 *
 * @see ModuleLoader.ts
 * @see ModuleRegistry.ts
 */

import type { ModuleMetadata } from '@core/interfaces/IModule';
import type { Injectable } from '@core/di/types';

/**
 * Module decorator metadata storage
 */
const MODULE_METADATA = new WeakMap<Injectable, Partial<ModuleMetadata>>();

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
  return function <T extends Injectable>(target: T): T {
    MODULE_METADATA.set(target, options);
    return target;
  };
}

/**
 * Get module metadata from decorated class
 */
export function getModuleMetadata(target: Injectable): Partial<ModuleMetadata> | undefined {
  return MODULE_METADATA.get(target);
}

/**
 * Check if class has @Module decorator
 */
export function isModule(target: Injectable): boolean {
  return MODULE_METADATA.has(target);
}
