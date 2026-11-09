/**
 * @file OverviewPlacement.ts
 * @description Where the extension's sections go in AniList's `.overview`, and keeping
 * them there. AniList (Vue) reuses `.overview` across SPA navigations and inserts its
 * own sections relative to its own elements, so a section placed once can end up
 * elsewhere (e.g. Relations created after Watch Order was mounted lands below it).
 * Modules call `ensurePlaced` on every mount check; it moves the section only when it
 * is out of place, so it never feeds the mutation observer in a loop.
 *
 * Order: Relations → Watch Order → Characters → Openings/Endings → Staff.
 */

export interface Placement {
  anchor: Element;
  position: 'before' | 'after';
}

/** A direct child of `.overview` by class, else the parent of the h2 with that label. */
export function findOverviewSection(overview: Element, cls: string, label: string): Element | null {
  const direct = overview.querySelector(`:scope > .${cls}`);
  if (direct) return direct;
  const wanted = label.toLowerCase();
  const heading = Array.from(overview.querySelectorAll('h2, .section-header')).find(
    (h) => h.textContent?.trim().toLowerCase() === wanted
  );
  return heading?.closest('.section') ?? heading?.parentElement ?? null;
}

/** Watch Order: right after Relations, else before the first of Openings/Characters/Staff. */
export function watchOrderPlacement(overview: Element): Placement | null {
  const relations = findOverviewSection(overview, 'relations', 'Relations');
  if (relations) return { anchor: relations, position: 'after' };
  const next =
    overview.querySelector(':scope > .characters, :scope > .au-music-section, :scope > .staff') ??
    findOverviewSection(overview, 'characters', 'Characters') ??
    findOverviewSection(overview, 'staff', 'Staff');
  return next ? { anchor: next, position: 'before' } : null;
}

/** Openings/Endings: right after Characters, else right before Staff. */
export function musicPlacement(overview: Element): Placement | null {
  const characters = findOverviewSection(overview, 'characters', 'Characters');
  if (characters) return { anchor: characters, position: 'after' };
  const staff = findOverviewSection(overview, 'staff', 'Staff');
  return staff ? { anchor: staff, position: 'before' } : null;
}

/**
 * Put `section` at `placement` (or at the end of `overview` without one).
 * Returns true when it had to move.
 */
export function ensurePlaced(
  section: Element,
  overview: Element,
  placement: Placement | null
): boolean {
  if (placement && placement.anchor !== section && placement.anchor.parentElement) {
    const { anchor, position } = placement;
    if (position === 'after') {
      if (anchor.nextElementSibling === section) return false;
      anchor.after(section);
    } else {
      if (anchor.previousElementSibling === section) return false;
      anchor.before(section);
    }
    return true;
  }
  if (section.parentElement === overview) return false;
  overview.append(section);
  return true;
}
