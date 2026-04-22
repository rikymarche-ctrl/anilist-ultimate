/**
 * Dependency Injection Container
 * Centralized tsyringe container setup and exports
 */

import { container as tsyringeContainer } from 'tsyringe';

/**
 * Global DI container instance
 * All services are registered here
 */
export const container = tsyringeContainer;

/**
 * Clear all registered services (useful for testing)
 */
export function clearContainer(): void {
  container.clearInstances();
}

/**
 * Reset container to initial state
 */
export function resetContainer(): void {
  container.reset();
}
