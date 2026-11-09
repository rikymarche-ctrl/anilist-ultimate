/**
 * @file AstraThemeScores.ts
 * @description Opt-in link between Astra sections and per-song OP/ED ratings.
 *
 * A section or sub-section with `source: 'OP' | 'ED'` takes the mean of the rated
 * openings or endings. The value is written into the season scores, so the calculator,
 * summaries and AniList sync keep working unchanged.
 */

import type { AstraScoreSource, AstraSection, AstraSettings } from '../AstraInterfaces';

export interface LinkedScoreKey {
  /** Key in AstraSeason.scores: the section id, or `${section}_${sub}` for a sub-section. */
  key: string;
  source: AstraScoreSource;
}

export function linkedScoreKeys(sections: readonly AstraSection[]): LinkedScoreKey[] {
  return sections.flatMap((section) =>
    section.subSections?.length
      ? section.subSections
          .filter((sub) => sub.source)
          .map((sub) => ({ key: `${section.id}_${sub.id}`, source: sub.source! }))
      : section.source
        ? [{ key: section.id, source: section.source }]
        : []
  );
}

/** Returns new scores with linked keys set to the averages, or null when nothing changes. */
export function applyLinkedThemeScores(
  scores: Readonly<Record<string, number | null>>,
  sections: readonly AstraSection[],
  averages: Readonly<Record<AstraScoreSource, number | null>>
): Record<string, number | null> | null {
  const links = linkedScoreKeys(sections);
  if (!links.some((link) => (scores[link.key] ?? null) !== averages[link.source])) return null;
  return {
    ...scores,
    ...Object.fromEntries(links.map((link) => [link.key, averages[link.source]])),
  };
}

/** The "Rate openings and endings" preference; older data without it follows the existing links. */
export function songRatingsEnabled(
  settings: Pick<AstraSettings, 'songRatings'>,
  sections: readonly AstraSection[]
): boolean {
  return settings.songRatings ?? linkedScoreKeys(sections).length > 0;
}

/**
 * Per kind: 'linked' fills a section, 'uncounted' is rated without touching the score,
 * 'unset' was never chosen (the anime page asks to choose).
 */
export type SongKindState = 'linked' | 'uncounted' | 'unset';

export function songKindStates(
  settings: Pick<AstraSettings, 'songRatingsUncounted'>,
  sections: readonly AstraSection[]
): Record<AstraScoreSource, SongKindState> {
  const links = linkedScoreKeys(sections);
  const state = (kind: AstraScoreSource): SongKindState =>
    links.some((link) => link.source === kind)
      ? 'linked'
      : settings.songRatingsUncounted?.includes(kind)
        ? 'uncounted'
        : 'unset';
  return { OP: state('OP'), ED: state('ED') };
}
