/**
 * @file AstraConstants.ts
 * @description Constants and utility functions for the Astra module.
 */

import type { AstraSection, AstraSettings } from '../AstraInterfaces';

export const DEFAULT_SECTIONS: AstraSection[] = [
  { id: 'story', name: 'Story', weight: 3, subSections: [] },
  { id: 'characters', name: 'Characters', weight: 2.5, subSections: [] },
  { id: 'visuals', name: 'Visuals', weight: 1.5, subSections: [] },
  {
    id: 'sound',
    name: 'Sound',
    weight: 1,
    subSections: [
      { id: 'intro', name: 'Intro', weight: 1 },
      { id: 'outro', name: 'Outro', weight: 1 },
      { id: 'all', name: 'All', weight: 10 }
    ]
  },
  { id: 'enjoyment', name: 'Enjoyment', weight: 1.75, subSections: [] },
  { id: 'consistency', name: 'Consistency', weight: 0.75, subSections: [] },
  { id: 'finale', name: 'Finale', weight: 0.5, subSections: [] },
];

export const DEFAULT_SETTINGS: AstraSettings = {
  enableSeriesFinale: true,
  finaleWeightMultiplier: 2,
  autoSync: true,
  appendAstraToComment: false,
};

/**
 * Generate a cryptographically random UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: Manual UUID v4 implementation using crypto.getRandomValues for better entropy
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
