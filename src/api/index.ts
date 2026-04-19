/**
 * API Module Exports
 */

import { AnilistClient } from './AnilistClient';

// Export a singleton instance
export const anilistClient = new AnilistClient();

// Export the class for testing or custom instances
export { AnilistClient };
