/**
 * Dependency Injection Module
 * Barrel export for DI infrastructure
 */

export { container, clearContainer, resetContainer } from './container';
export { TOKENS } from './tokens';
export { ServiceLifetime, type ServiceRegistration, type Injectable } from './types';

// Re-export tsyringe decorators and utilities
export { injectable, inject, singleton, scoped, autoInjectable } from 'tsyringe';
