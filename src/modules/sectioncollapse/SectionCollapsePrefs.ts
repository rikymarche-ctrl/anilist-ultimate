/**
 * @file SectionCollapsePrefs.ts
 * @description Which overview sections the viewer has collapsed, by section kind
 * ("characters", "openings", ...), not by media: a kind collapsed on one page stays
 * collapsed on every anime and manga page. Kept in localStorage like the Watch Order
 * preferences, so it survives SPA navigation and reloads without a round trip.
 */

import { mirrorPagePref } from '@core/storage/PagePrefsMirror';

export const COLLAPSE_STORAGE_KEY = 'au-section-collapse';

/** Longest kind accepted from storage; real kinds are short heading slugs. */
const MAX_KIND_LENGTH = 64;
const KIND_PATTERN = /^[a-z0-9-]+$/;

/** Parse the stored list of collapsed kinds; anything malformed is dropped. */
export function parseCollapsed(raw: string | null): ReadonlySet<string> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (kind): kind is string =>
          typeof kind === 'string' && kind.length <= MAX_KIND_LENGTH && KIND_PATTERN.test(kind)
      )
    );
  } catch {
    return new Set();
  }
}

export function loadCollapsed(): ReadonlySet<string> {
  try {
    return parseCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function saveCollapsed(kinds: ReadonlySet<string>): void {
  try {
    const raw = JSON.stringify([...kinds].sort());
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, raw);
    mirrorPagePref(COLLAPSE_STORAGE_KEY, raw);
  } catch {
    /* storage unavailable: the state stays in memory for this page */
  }
}

/** Return a new set with `kind` added (collapsed) or removed (open). */
export function withKind(
  kinds: ReadonlySet<string>,
  kind: string,
  collapsed: boolean
): ReadonlySet<string> {
  const next = new Set(kinds);
  if (collapsed) next.add(kind);
  else next.delete(kind);
  return next;
}

/** Slug of a heading's label: "Status Distribution" → "status-distribution". */
export function kindFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KIND_LENGTH);
}
