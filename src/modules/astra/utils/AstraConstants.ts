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
 * Metadata markers for parsing and injection
 */
export const ASTRA_MARKERS = {
  HEADER: '─── [ ASTRA REVIEW ] ───',
  FOOTER: '──────────────────',
  ANCHOR: 'Astra Review',
  LABELS: {
    BREAKDOWN: 'BREAKDOWN:',
    JOURNAL: 'JOURNAL:',
    NOTES: 'NOTES:',
    RATING: 'Rating:',
    OVERALL: 'OVERALL SCORE:'
  }
};

/**
 * Generate a cryptographically random UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
