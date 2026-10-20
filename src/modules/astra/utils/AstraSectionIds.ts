/**
 * @file AstraSectionIds.ts
 * @description Collision-free ids for Astra scoring sections and sub-sections.
 *
 * Section ids and sub-section score keys (`${sectionId}_${subId}`) share one namespace inside
 * `season.scores`, so a new id must avoid both. Ids are slugs of the display name; a numeric
 * suffix (`_2`, `_3`, ...) resolves collisions.
 */

import type { AstraSection } from '../AstraInterfaces';

/** Keys that the backup validator refuses, so they can never become a section id. */
const UNSAFE_IDS = new Set(['__proto__', 'prototype', 'constructor']);

/** Score key under which a sub-section is stored for its parent section. */
export function subSectionKey(sectionId: string, subId: string): string {
  return `${sectionId}_${subId}`;
}

/** Every key a new top-level section must avoid: existing section ids and composite sub-section keys. */
export function reservedSectionKeys(sections: readonly AstraSection[]): Set<string> {
  const keys = new Set<string>();
  for (const section of sections) {
    keys.add(section.id);
    for (const sub of section.subSections ?? []) keys.add(subSectionKey(section.id, sub.id));
  }
  return keys;
}

/** Slug of a display name: lower case, whitespace as underscores, never empty. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_') || 'section';
}

/**
 * Returns an id for `name` that collides with nothing in `taken`.
 *
 * - Top-level sections (no `parentId`): the id must not be in `taken`, which must contain every
 *   existing section id and composite sub-section key (see `reservedSectionKeys`).
 * - Sub-sections (`parentId` set): the composite key `${parentId}_${id}` must not be in `taken`,
 *   and the bare id must not repeat a sibling id.
 */
export function uniqueSectionId(
  name: string,
  taken: ReadonlySet<string>,
  scope: { parentId?: string; siblingIds?: ReadonlySet<string> } = {}
): string {
  const base = slugify(name);
  const isFree = (id: string): boolean => {
    if (UNSAFE_IDS.has(id)) return false;
    if (scope.parentId === undefined) return !taken.has(id);
    return !taken.has(subSectionKey(scope.parentId, id)) && !(scope.siblingIds?.has(id) ?? false);
  };
  let candidate = base;
  for (let suffix = 2; !isFree(candidate); suffix++) candidate = `${base}_${suffix}`;
  return candidate;
}
