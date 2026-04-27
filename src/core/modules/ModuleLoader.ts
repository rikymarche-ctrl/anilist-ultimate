/**
 * @file ModuleLoader.ts
 * @description Utility helpers for creating ModuleMetadata registrations
 *
 * Provides static factory methods used in setup.ts to declaratively
 * register modules with the ModuleRegistry:
 *   - createMetadata(): fill defaults on partial metadata
 *   - pageMatches(): exact/prefix path matcher factory
 *   - pageMatchesRegex(): regex-based path matcher factory
 *   - fromConfig(): metadata with feature-flag gating
 *   - batchCreate(): bulk registration helper
 *
 * @see ModuleRegistry.ts for the module lifecycle manager
 * @see setup.ts for usage examples
 */

import type { ModuleMetadata } from '@core/interfaces/IModule';
import type { IConfigManager } from '@core/interfaces/IConfigManager';

/**
 * Module loader helper functions
 */
export class ModuleLoader {
  /**
   * Create module metadata with defaults
   */
  static createMetadata(
    partial: Partial<ModuleMetadata> & Pick<ModuleMetadata, 'name' | 'factory'>
  ): ModuleMetadata {
    return {
      enabled: true,
      critical: false,
      ...partial,
    };
  }

  /**
   * Create page matcher for specific paths
   */
  static pageMatches(...paths: string[]): (path: string) => boolean {
    return (currentPath: string) => {
      return paths.some((path) => {
        // Exact match
        if (currentPath === path) return true;

        // Starts with match (for nested routes)
        if (path.endsWith('/*') && currentPath.startsWith(path.slice(0, -2))) {
          return true;
        }

        return false;
      });
    };
  }

  /**
   * Create page matcher using regex
   */
  static pageMatchesRegex(pattern: RegExp): (path: string) => boolean {
    return (currentPath: string) => pattern.test(currentPath);
  }

  /**
   * Create module metadata from config
   */
  static fromConfig(
    name: string,
    factory: ModuleMetadata['factory'],
    config: IConfigManager,
    options?: {
      featureFlag?: string;
      pageMatch?: ModuleMetadata['pageMatch'];
      critical?: boolean;
      dependencies?: string[];
    }
  ): ModuleMetadata {
    const enabled = options?.featureFlag
      ? config.isFeatureEnabled(options.featureFlag as any)
      : true;

    return {
      name,
      factory,
      enabled,
      critical: options?.critical ?? false,
      pageMatch: options?.pageMatch,
      dependencies: options?.dependencies,
    };
  }

  /**
   * Batch create module metadata
   */
  static batchCreate(
    modules: Array<Partial<ModuleMetadata> & Pick<ModuleMetadata, 'name' | 'factory'>>
  ): ModuleMetadata[] {
    return modules.map((module) => ModuleLoader.createMetadata(module));
  }
}
