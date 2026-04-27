/**
 * @file container.ts
 * @description Global tsyringe DI container instance and test utilities
 *
 * Re-exports the tsyringe container singleton used by setup.ts to register
 * all services. Also exposes clearContainer() and resetContainer() for
 * unit test isolation.
 *
 * @see setup.ts for the composition root
 * @see tokens.ts for service identifiers
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
