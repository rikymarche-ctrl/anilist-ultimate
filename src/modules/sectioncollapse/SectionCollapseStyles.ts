/**
 * @file SectionCollapseStyles.ts
 * @description Styles of the section chevrons. Colours come only from AniList's
 * r,g,b theme variables so the chevron follows dark, light and high-contrast themes;
 * the heading keeps its own size and spacing (the chevron sits inline before its text).
 */

const STYLE_ID = 'au-section-collapse-styles';

export const ATTR_HEAD = 'data-au-sc-head';
export const ATTR_COLLAPSED = 'data-au-collapsed';
export const ATTR_CLICKABLE = 'data-au-sc-clickable';
export const TOGGLE_CLASS = 'au-sc-toggle';

const CSS = `
.${TOGGLE_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1em;
  height: 1em;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: none;
  color: rgb(var(--color-text-lighter));
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease;
}
.${TOGGLE_CLASS}:hover { color: rgb(var(--color-blue)); }
.${TOGGLE_CLASS}:focus-visible {
  outline: 2px solid rgb(var(--color-blue));
  outline-offset: 2px;
}
.${TOGGLE_CLASS} svg {
  width: 0.8em;
  height: 0.8em;
  transition: transform 0.15s ease;
}
/* Flex trims the whitespace AniList leaves before its heading text (newline + tabs
   before "Staff"), so every label starts at the same offset after the chevron. */
/* column-gap stands in for the trimmed spaces (chevron → label, "Threads" → "Create New Thread"). */
[${ATTR_HEAD}] { display: flex; align-items: center; column-gap: 0.3em; }
[${ATTR_COLLAPSED}] > [${ATTR_HEAD}] .${TOGGLE_CLASS} svg { transform: rotate(-90deg); }
/* Collapsed, the heading's own bottom margin would add up inside grid rows and
   Recommendations (15px); without it every collapsed row is 16px + the section's 30px. */
[${ATTR_COLLAPSED}] > [${ATTR_HEAD}] { margin-bottom: 0 !important; }
[${ATTR_COLLAPSED}] > :not([${ATTR_HEAD}]) { display: none !important; }
[${ATTR_HEAD}][${ATTR_CLICKABLE}] { cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .${TOGGLE_CLASS}, .${TOGGLE_CLASS} svg { transition: none; }
}
`;

export function ensureSectionCollapseStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}

export function removeSectionCollapseStyles(doc: Document = document): void {
  doc.getElementById(STYLE_ID)?.remove();
}
