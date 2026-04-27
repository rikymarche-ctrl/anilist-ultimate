/**
 * @file types.ts
 * @description Type definitions for the dependency injection system
 *
 * Defines ServiceLifetime enum (Singleton, Transient, Scoped),
 * ServiceRegistration metadata interface, and the Injectable marker.
 * Used by the DI container and module loader for service resolution.
 *
 * @see container.ts
 * @see tokens.ts
 */

/**
 * Service lifetime options
 */
export enum ServiceLifetime {
  /**
   * Single instance shared across the application
   */
  Singleton = 'Singleton',

  /**
   * New instance created for each resolution
   */
  Transient = 'Transient',

  /**
   * Single instance per scope (not implemented yet)
   */
  Scoped = 'Scoped',
}

/**
 * Service registration metadata
 */
export interface ServiceRegistration {
  /**
   * Service token (Symbol)
   */
  token: symbol;

  /**
   * Service implementation class
   */
  implementation: new (...args: any[]) => any;

  /**
   * Service lifetime
   */
  lifetime: ServiceLifetime;

  /**
   * Optional factory function
   */
  factory?: (...args: any[]) => any;
}

/**
 * Injectable class decorator marker
 */
export interface Injectable {
  new (...args: any[]): any;
}
