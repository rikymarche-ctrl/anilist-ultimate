/**
 * @file AstraTableColumns.ts
 * @description Column sizing for the Astra dashboard table/list layouts.
 * Header and rows are separate CSS grids, so every track must be deterministic:
 * each section track gets a fixed width derived from its uppercase header label.
 */

import type { AstraSection } from '../../AstraInterfaces';

/** Narrowest section track: fits a "10.0" score plus cell padding. */
const SECTION_COL_MIN_PX = 96;
/** Widest section track; longer labels are ellipsized (full name stays in the tooltip). */
const SECTION_COL_MAX_PX = 168;
/** Approximate advance of an 11px / weight-800 uppercase glyph with 0.1em letter-spacing. */
const HEADER_CHAR_PX = 8.6;
/** Header cell padding (2 × 10px) plus the sort arrow and its gap. */
const HEADER_CHROME_PX = 34;

/** Width in px of the grid track for a section column titled `name`. */
export function sectionColumnWidth(name: string): number {
  const estimated = Math.ceil((name?.trim().length ?? 0) * HEADER_CHAR_PX + HEADER_CHROME_PX);
  return Math.min(SECTION_COL_MAX_PX, Math.max(SECTION_COL_MIN_PX, estimated));
}

/**
 * Inline style declaring `--astra-dynamic-cols` with one track per section.
 * Returns '' without sections so the CSS `var(--astra-dynamic-cols, )` fallback
 * keeps the grid template valid (`repeat(0, …)` would invalidate it).
 */
export function sectionColumnsStyle(sections: readonly Pick<AstraSection, 'name'>[]): string {
  if (sections.length === 0) return '';
  const tracks = sections.map((section) => `${sectionColumnWidth(section.name)}px`).join(' ');
  return `--astra-dynamic-cols: ${tracks}`;
}
