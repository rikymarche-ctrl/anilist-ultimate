/**
 * Module Registry
 * Centralized module registration and initialization
 * Eliminates repetitive module initialization code
 */

import { injectable, inject } from 'tsyringe';
import type { IModule, ModuleMetadata } from '@core/interfaces/IModule';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

/**
 * Module Registry
 * Manages module registration, initialization, and lifecycle
 */
@injectable()
export class ModuleRegistry {
  /**
   * Registered modules metadata
   */
  private modules = new Map<string, ModuleMetadata>();

  /**
   * Initialized module instances
   */
  private instances = new Map<string, IModule>();

  /**
   * Module initialization status
   */
  private initStatus = new Map<string, 'pending' | 'initializing' | 'initialized' | 'failed'>();

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    // Logger and EventBus will be injected via DI
  }

  /**
   * Register a module
   */
  register(metadata: ModuleMetadata): void {
    if (this.modules.has(metadata.name)) {
      this.logger.warn(`Module "${metadata.name}" already registered, overwriting`);
    }

    this.modules.set(metadata.name, metadata);
    this.initStatus.set(metadata.name, 'pending');

    this.logger.debug(`Module registered: ${metadata.name}`, {
      enabled: metadata.enabled,
      critical: metadata.critical,
      version: metadata.version,
    });
  }

  /**
   * Register multiple modules at once
   */
  registerAll(modules: ModuleMetadata[]): void {
    modules.forEach((metadata) => this.register(metadata));
  }

  /**
   * Initialize a specific module
   */
  async initModule(name: string): Promise<boolean> {
    const metadata = this.modules.get(name);

    if (!metadata) {
      this.logger.error(`Module "${name}" not registered`);
      return false;
    }

    // Check if already initialized
    const status = this.initStatus.get(name);
    if (status === 'initialized') {
      this.logger.debug(`Module "${name}" already initialized`);
      return true;
    }

    if (status === 'initializing') {
      this.logger.warn(`Module "${name}" is currently initializing`);
      return false;
    }

    // Check if enabled
    if (!metadata.enabled) {
      this.logger.debug(`Module "${name}" is disabled, skipping`);
      return false;
    }

    // Check page matcher
    if (metadata.pageMatch && !metadata.pageMatch(window.location.pathname)) {
      this.logger.debug(`Module "${name}" - page doesn't match, skipping`);
      return false;
    }

    // Check dependencies
    if (metadata.dependencies && metadata.dependencies.length > 0) {
      const unmetDependencies = metadata.dependencies.filter(
        (dep) => this.initStatus.get(dep) !== 'initialized'
      );

      if (unmetDependencies.length > 0) {
        this.logger.warn(
          `Module "${name}" has unmet dependencies: ${unmetDependencies.join(', ')}`
        );
        return false;
      }
    }

    // Initialize module
    this.initStatus.set(name, 'initializing');

    try {
      this.logger.info(`Initializing module: ${name}`);

      // Create instance using factory
      const instance = metadata.factory(null); // Container will be injected via DI

      // Initialize
      await instance.init();

      // Store instance
      this.instances.set(name, instance);
      this.initStatus.set(name, 'initialized');

      // Emit event
      this.eventBus.emit(EVENT_TYPES.MODULE_INITIALIZED, {
        moduleName: name,
        timestamp: new Date(),
      });

      this.logger.success(`Module initialized: ${name}`);
      return true;
    } catch (error) {
      this.logger.error(`Module initialization failed: ${name}`, error);
      this.initStatus.set(name, 'failed');

      // Emit error event
      this.eventBus.emit(EVENT_TYPES.MODULE_ERROR, {
        moduleName: name,
        error: error as Error,
        context: 'initialization',
      });

      // Re-throw if critical
      if (metadata.critical) {
        throw error;
      }

      return false;
    }
  }

  /**
   * Initialize all registered modules
   */
  async initAll(): Promise<void> {
    const moduleNames = Array.from(this.modules.keys());

    this.logger.group(`Initializing ${moduleNames.length} modules`);

    // Initialize critical modules first (sequentially)
    const criticalModules = moduleNames.filter((name) => this.modules.get(name)?.critical);
    for (const name of criticalModules) {
      await this.initModule(name);
    }

    // Initialize non-critical modules (in parallel)
    const nonCriticalModules = moduleNames.filter((name) => !this.modules.get(name)?.critical);
    await Promise.allSettled(
      nonCriticalModules.map((name) => this.initModule(name))
    );

    this.logger.groupEnd();

    // Log summary
    const initialized = Array.from(this.initStatus.values()).filter(
      (status) => status === 'initialized'
    ).length;
    const failed = Array.from(this.initStatus.values()).filter(
      (status) => status === 'failed'
    ).length;

    this.logger.info(
      `Module initialization complete: ${initialized} initialized, ${failed} failed`
    );
  }

  /**
   * Get module instance
   */
  getInstance<T extends IModule>(name: string): T | undefined {
    return this.instances.get(name) as T;
  }

  /**
   * Get all module instances
   */
  getAllInstances(): Map<string, IModule> {
    return new Map(this.instances);
  }

  /**
   * Check if module is initialized
   */
  isInitialized(name: string): boolean {
    return this.initStatus.get(name) === 'initialized';
  }

  /**
   * Get module status
   */
  getStatus(name: string): 'pending' | 'initializing' | 'initialized' | 'failed' | 'not-registered' {
    if (!this.modules.has(name)) {
      return 'not-registered';
    }
    return this.initStatus.get(name) || 'pending';
  }

  /**
   * Destroy a module
   */
  async destroyModule(name: string): Promise<void> {
    const instance = this.instances.get(name);

    if (!instance) {
      this.logger.warn(`Module "${name}" not initialized, cannot destroy`);
      return;
    }

    try {
      this.logger.info(`Destroying module: ${name}`);

      if (instance.destroy) {
        await instance.destroy();
      }

      this.instances.delete(name);
      this.initStatus.set(name, 'pending');

      this.eventBus.emit(EVENT_TYPES.MODULE_DESTROYED, {
        moduleName: name,
        timestamp: new Date(),
      });

      this.logger.success(`Module destroyed: ${name}`);
    } catch (error) {
      this.logger.error(`Module destruction failed: ${name}`, error);
      throw error;
    }
  }

  /**
   * Destroy all modules
   */
  async destroyAll(): Promise<void> {
    this.logger.info('Destroying all modules');

    const moduleNames = Array.from(this.instances.keys());

    // Destroy in reverse order (last initialized, first destroyed)
    for (const name of moduleNames.reverse()) {
      try {
        await this.destroyModule(name);
      } catch (error) {
        this.logger.error(`Failed to destroy module "${name}"`, error);
      }
    }

    this.logger.success('All modules destroyed');
  }

  /**
   * Get initialization summary
   */
  getSummary(): {
    total: number;
    initialized: number;
    pending: number;
    failed: number;
    disabled: number;
  } {
    const statuses = Array.from(this.initStatus.values());
    const disabledModules = Array.from(this.modules.values()).filter(
      (m) => !m.enabled
    ).length;

    return {
      total: this.modules.size,
      initialized: statuses.filter((s) => s === 'initialized').length,
      pending: statuses.filter((s) => s === 'pending').length,
      failed: statuses.filter((s) => s === 'failed').length,
      disabled: disabledModules,
    };
  }
}
