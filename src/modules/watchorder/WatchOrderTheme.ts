/**
 * @file WatchOrderTheme.ts
 * @description Shared visual vocabulary of the Watch Order section: one colour per relation
 * kind (used by the list badges, the map edges and the map legend alike), labels and icons.
 */

import type { FranchiseGraph } from './WatchOrderGraph';
import { storyOrder } from './WatchOrderGraph';

/** Branch relations as normalised by the graph (PARENT becomes SIDE_STORY). */
export type BranchKind = 'SIDE_STORY' | 'SPIN_OFF' | 'ALTERNATIVE' | 'SUMMARY';
/** How a title hangs off the franchise: the main line, or one of the branch kinds. */
export type TitleKind = 'MAIN' | BranchKind;

export const BRANCH_KINDS: readonly BranchKind[] = [
  'SIDE_STORY',
  'SPIN_OFF',
  'ALTERNATIVE',
  'SUMMARY',
];

/** Literal colours: SVG presentation attributes cannot read CSS variables. */
export const KIND_COLOR: Record<TitleKind, string> = {
  MAIN: '#3db4f2', // AniList blue
  SIDE_STORY: '#b48cf2',
  SPIN_OFF: '#f79a63',
  ALTERNATIVE: '#e85d75',
  SUMMARY: '#8b98a8',
};

export const KIND_LABEL: Record<TitleKind, string> = {
  MAIN: 'Main story',
  SIDE_STORY: 'Side story',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Alternative',
  SUMMARY: 'Recap',
};

export function isBranchKind(value: unknown): value is BranchKind {
  return BRANCH_KINDS.includes(value as BranchKind);
}

/** Kind of every title: main line, or the relation it branches off with. */
export function titleKinds(graph: FranchiseGraph): Map<number, TitleKind> {
  const kinds = new Map<number, TitleKind>();
  for (const entry of storyOrder(graph)) {
    const relation = entry.relation;
    kinds.set(
      entry.node.id,
      entry.placement === 'chain' ? 'MAIN' : isBranchKind(relation) ? relation : 'SIDE_STORY'
    );
  }
  return kinds;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 24×24 stroke icons (Lucide-style geometry, drawn here so nothing is fetched). */
const ICONS = {
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  shrink: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  calendar: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  map: 'M6 5a2 2 0 1 0 0 .01M18 19a2 2 0 1 0 0 .01M6 7v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3M18 5a2 2 0 1 0 0 .01M18 7v10',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  cards: 'M4 5h16v5H4zM4 14h16v5H4z',
  posters: 'M4 4h7v16H4zM13 4h7v16h-7z',
  eyeOff:
    'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.5 8 3 10.2 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  // A four-pointed sparkle with a small companion star.
  sparkle:
    'M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
  close: 'M6 6l12 12M18 6L6 18',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'au-wo-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
