/**
 * Modules System
 * Barrel export for module infrastructure
 */

export { ModuleRegistry } from './ModuleRegistry';
export { ModuleLoader } from './ModuleLoader';
export { Module, getModuleMetadata, isModule } from './decorators';

// Re-export BaseModule from existing location
export { BaseModule } from './BaseModule';
