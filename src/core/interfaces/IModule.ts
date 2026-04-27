/**
 * @file IModule.ts
 * @description Contract and metadata types for feature module implementations
 *
 * Defines:
 *   - IModule: init/destroy lifecycle, getName, optional isEnabled
 *   - ModuleMetadata: registration descriptor (name, factory, pageMatch, critical flag)
 *   - ModuleLifecycleHooks: optional before/after init/destroy callbacks
 *
 * All feature modules (CalendarModule, NotificationCleanerModule, etc.)
 * implement IModule via the BaseModule abstract class.
 *
 * @see BaseModule.ts for the abstract base implementation
 * @see ModuleRegistry.ts for the lifecycle manager
 */

export interface IModule {
  /**
   * Initialize the module
   */
  init(): Promise<void>;

  /**
   * Destroy the module (cleanup)
   */
  destroy?(): Promise<void>;

  /**
   * Get module name
   */
  getName(): string;

  /**
   * Get module version (optional)
   */
  getVersion?(): string;

  /**
   * Check if module is enabled (optional)
   */
  isEnabled?(): boolean;
}

/**
 * Module Metadata
 * Information about a module for registration
 */
export interface ModuleMetadata {
  /**
   * Unique module name
   */
  name: string;

  /**
   * Module description
   */
  description?: string;

  /**
   * Whether module is enabled
   */
  enabled: boolean;

  /**
   * Whether module is critical (initialization failure crashes app)
   */
  critical?: boolean;

  /**
   * Page matcher function (return true if module should run on this page)
   */
  pageMatch?: (path: string) => boolean;

  /**
   * Factory function to create module instance
   */
  factory: (container: any) => IModule;

  /**
   * Module dependencies (names of other modules that must initialize first)
   */
  dependencies?: string[];

  /**
   * Module version
   */
  version?: string;
}

/**
 * Module lifecycle hooks
 */
export interface ModuleLifecycleHooks {
  /**
   * Called before module initialization
   */
  beforeInit?(): Promise<void>;

  /**
   * Called after module initialization
   */
  afterInit?(): Promise<void>;

  /**
   * Called before module destruction
   */
  beforeDestroy?(): Promise<void>;

  /**
   * Called after module destruction
   */
  afterDestroy?(): Promise<void>;
}
