/**
 * @file MediaListFilterControls.ts
 * @description Read and re-apply AniList media list filters through the page's own controls
 *
 * AniList keeps media list filters (Format, Status, Genres & Tags, Country, Year,
 * Sort, the text filter and the list view) only in Vue component state; only the
 * "Lists" section is mirrored into the URL path (and therefore restored by AniList
 * itself). Component state is not reachable from the extension's isolated world,
 * so this driver works on the rendered Element UI controls instead:
 *
 *   - Selects: options are rendered (hidden) inside each `.el-select` until the
 *     dropdown is first opened, so clicking the `li.el-select-dropdown__item`
 *     with the wanted label selects it without opening anything.
 *   - Text filter: setting the value and dispatching `input` drives `v-model`.
 *   - Year slider: a click on the runway at the value's position (the slider's
 *     own click-to-seek), cleared through the header's reset icon.
 *   - List view: a plain click on the view switch.
 *
 * Values are matched by visible label, the same text the reader records, so the
 * driver needs no knowledge of AniList's internal enum values.
 *
 * @see PageStateTypes.ts for MediaListFilterState
 */

import { logger } from '@core/logger';
import type { MediaListFilterState, RestoreRunControl } from './PageStateTypes';

const SELECTORS = {
  root: '.medialist .filters-wrap',
  group: '.filter-group',
  groupHeader: '.group-header',
  select: '.el-select',
  selectInput: 'input.el-input__inner',
  selectTags: '.el-select__tags',
  selectTag: '.el-select__tags .el-tag',
  selectTagText: '.el-select__tags-text',
  selectTagClose: '.el-tag__close',
  selectClear: '.el-select__caret.el-icon-circle-close',
  selectHoverTarget: '.el-input',
  option: 'li.el-select-dropdown__item',
  openDropdowns: 'body > .el-select-dropdown',
  titleInput: '.entry-filter input.el-input__inner',
  slider: '.el-slider',
  sliderRunway: '.el-slider__runway',
  yearValue: '.group-header .value',
  yearClear: '.group-header .value .el-icon-circle-close',
  viewSwitch: '.medialist .theme-switch > span',
} as const;

const GROUPS = { filters: 'Filters', year: 'Year', sort: 'Sort' } as const;
type SingleSelectField = 'format' | 'status' | 'country';
const SINGLE_SELECT_PLACEHOLDERS: Record<SingleSelectField, string> = {
  format: 'Format',
  status: 'Status',
  country: 'Country',
};
/** AniList's year slider minimum doubles as "no year filter". */
const DEFAULT_YEAR_MIN = 1950;
/** Tag options load asynchronously after the sidebar renders. */
const OPTION_WAIT_MS = 3000;

const text = (node: Node | null | undefined): string => node?.textContent?.trim() ?? '';

function findGroup(root: ParentNode, name: string): HTMLElement | null {
  const groups = Array.from(root.querySelectorAll<HTMLElement>(SELECTORS.group));
  return (
    groups.find((group) => text(group.querySelector(SELECTORS.groupHeader)?.firstChild) === name) ??
    null
  );
}

function findSingleSelect(root: ParentNode, field: SingleSelectField): HTMLElement | null {
  const group = findGroup(root, GROUPS.filters);
  const selects = Array.from(group?.querySelectorAll<HTMLElement>(SELECTORS.select) ?? []);
  const placeholder = SINGLE_SELECT_PLACEHOLDERS[field];
  return (
    selects.find(
      (select) =>
        !select.querySelector(SELECTORS.selectTags) &&
        select.querySelector(SELECTORS.selectInput)?.getAttribute('placeholder') === placeholder
    ) ?? null
  );
}

function findGenreSelect(root: ParentNode): HTMLElement | null {
  const group = findGroup(root, GROUPS.filters);
  return (
    Array.from(group?.querySelectorAll<HTMLElement>(SELECTORS.select) ?? []).find(
      (select) => !!select.querySelector(SELECTORS.selectTags)
    ) ?? null
  );
}

function findSortSelect(root: ParentNode): HTMLElement | null {
  return findGroup(root, GROUPS.sort)?.querySelector<HTMLElement>(SELECTORS.select) ?? null;
}

function readSingle(select: HTMLElement | null): string | null {
  return select?.querySelector<HTMLInputElement>(SELECTORS.selectInput)?.value.trim() || null;
}

function selectedTags(select: HTMLElement | null): HTMLElement[] {
  return Array.from(select?.querySelectorAll<HTMLElement>(SELECTORS.selectTag) ?? []);
}

function readYear(root: ParentNode): number | null {
  const value = Number.parseInt(
    text(findGroup(root, GROUPS.year)?.querySelector(SELECTORS.yearValue)),
    10
  );
  return Number.isInteger(value) && value !== DEFAULT_YEAR_MIN ? value : null;
}

function readView(doc: Document): number | null {
  const index = Array.from(doc.querySelectorAll(SELECTORS.viewSwitch)).findIndex((entry) =>
    entry.classList.contains('active')
  );
  return index >= 0 ? index : null;
}

/**
 * Read the media list filters currently shown by AniList.
 * @returns null when the filter sidebar is not rendered
 */
export function readMediaListFilters(doc: Document = document): MediaListFilterState | null {
  const root = doc.querySelector<HTMLElement>(SELECTORS.root);
  if (!root) return null;
  return {
    view: readView(doc),
    title: root.querySelector<HTMLInputElement>(SELECTORS.titleInput)?.value ?? '',
    format: readSingle(findSingleSelect(root, 'format')),
    status: readSingle(findSingleSelect(root, 'status')),
    genres: selectedTags(findGenreSelect(root))
      .map((tag) => text(tag.querySelector(SELECTORS.selectTagText)))
      .filter(Boolean),
    country: readSingle(findSingleSelect(root, 'country')),
    year: readYear(root),
    sort: readSingle(findSortSelect(root)),
  };
}

/** Option with the given label: inside the select, or in its open dropdown once Element UI moved it to <body>. */
function findOption(select: HTMLElement, label: string, doc: Document): HTMLElement | null {
  const matches = (option: HTMLElement) => text(option) === label;
  const own = Array.from(select.querySelectorAll<HTMLElement>(SELECTORS.option)).find(matches);
  if (own) return own;
  const open = Array.from(doc.querySelectorAll<HTMLElement>(SELECTORS.openDropdowns)).filter(
    (dropdown) => dropdown.style.display !== 'none'
  );
  return (
    open
      .flatMap((dropdown) => Array.from(dropdown.querySelectorAll<HTMLElement>(SELECTORS.option)))
      .find(matches) ?? null
  );
}

async function chooseOption(
  select: HTMLElement,
  label: string,
  control: RestoreRunControl,
  doc: Document
): Promise<boolean> {
  let option = findOption(select, label, doc);
  if (!option) {
    // Options already moved to <body>: open this select so its dropdown is the visible one.
    select.click();
    await control.settle();
    option = findOption(select, label, doc);
  }
  if (!option || control.aborted) return false;
  option.click();
  await control.settle();
  return true;
}

async function clearSingle(select: HTMLElement, control: RestoreRunControl): Promise<void> {
  // Element UI only renders the clear icon while the input is hovered.
  const hoverTarget = select.querySelector<HTMLElement>(SELECTORS.selectHoverTarget) ?? select;
  hoverTarget.dispatchEvent(new MouseEvent('mouseenter'));
  await control.settle();
  select.querySelector<HTMLElement>(SELECTORS.selectClear)?.click();
  hoverTarget.dispatchEvent(new MouseEvent('mouseleave'));
  await control.settle();
}

async function applySingle(
  select: HTMLElement | null,
  label: string | null,
  control: RestoreRunControl,
  doc: Document
): Promise<void> {
  if (!select || control.aborted || readSingle(select) === label) return;
  if (label === null) await clearSingle(select, control);
  else if (!(await chooseOption(select, label, control, doc)))
    logger.debug(`[PageState] List filter option not found: ${label}`);
}

async function applyGenres(
  select: HTMLElement | null,
  genres: readonly string[],
  control: RestoreRunControl,
  doc: Document
): Promise<void> {
  if (!select) return;
  const wanted = new Set(genres);
  for (const tag of selectedTags(select)) {
    if (control.aborted) return;
    if (!wanted.has(text(tag.querySelector(SELECTORS.selectTagText))))
      tag.querySelector<HTMLElement>(SELECTORS.selectTagClose)?.click();
  }
  for (const genre of genres) {
    if (control.aborted) return;
    const selected = selectedTags(select).some(
      (tag) => text(tag.querySelector(SELECTORS.selectTagText)) === genre
    );
    if (selected) continue;
    // Genres render immediately; tags arrive with a later request.
    if (!(await control.waitUntil(() => !!findOption(select, genre, doc), OPTION_WAIT_MS)))
      continue;
    await chooseOption(select, genre, control, doc);
  }
  // A multi-select keeps focus (and may open) after a pick: close it like a user would.
  const focused = doc.activeElement;
  if (focused instanceof HTMLElement && select.contains(focused)) {
    focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
}

async function applyYear(
  root: ParentNode,
  year: number | null,
  control: RestoreRunControl
): Promise<void> {
  const group = findGroup(root, GROUPS.year);
  if (!group || control.aborted || readYear(root) === year) return;
  if (year === null) {
    group.querySelector<HTMLElement>(SELECTORS.yearClear)?.click();
    await control.settle();
    return;
  }
  const slider = group.querySelector<HTMLElement>(SELECTORS.slider);
  const runway = slider?.querySelector<HTMLElement>(SELECTORS.sliderRunway);
  const min = Number(slider?.getAttribute('aria-valuemin'));
  const max = Number(slider?.getAttribute('aria-valuemax'));
  // Hidden sidebar (mobile layout) has no geometry to click on.
  if (!runway || !runway.clientWidth || !(max > min) || year < min || year > max) return;
  const rect = runway.getBoundingClientRect();
  const clientX = rect.left + ((year - min) / (max - min)) * runway.clientWidth;
  runway.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX, clientY: rect.top + rect.height / 2 })
  );
  await control.settle();
}

async function applyView(
  view: number | null,
  control: RestoreRunControl,
  doc: Document
): Promise<void> {
  if (view === null || control.aborted || readView(doc) === view) return;
  doc.querySelectorAll<HTMLElement>(SELECTORS.viewSwitch)[view]?.click();
  await control.settle();
}

async function applyTitle(
  root: ParentNode,
  title: string,
  control: RestoreRunControl
): Promise<void> {
  const input = root.querySelector<HTMLInputElement>(SELECTORS.titleInput);
  if (!input || control.aborted || input.value === title) return;
  input.value = title;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await control.settle();
}

/**
 * Drive AniList's filter controls until they match the target state.
 * Stops between steps as soon as the run is aborted.
 * @returns true when the controls read back exactly the target state
 */
export async function applyMediaListFilters(
  target: MediaListFilterState,
  control: RestoreRunControl,
  doc: Document = document
): Promise<boolean> {
  const root = doc.querySelector<HTMLElement>(SELECTORS.root);
  if (!root) return false;
  await applyView(target.view, control, doc);
  // A view change may re-render the sidebar: query controls afresh.
  const current = () => doc.querySelector<HTMLElement>(SELECTORS.root) ?? root;
  await applyTitle(current(), target.title, control);
  for (const field of Object.keys(SINGLE_SELECT_PLACEHOLDERS) as SingleSelectField[]) {
    await applySingle(findSingleSelect(current(), field), target[field], control, doc);
  }
  await applyGenres(findGenreSelect(current()), target.genres, control, doc);
  await applyYear(current(), target.year, control);
  await applySingle(findSortSelect(current()), target.sort, control, doc);
  const focused = doc.activeElement;
  if (focused instanceof HTMLElement && current().contains(focused)) focused.blur();
  return !control.aborted && sameFilters(readMediaListFilters(doc), target);
}

/** Field-by-field equality of two filter states (genre order is irrelevant). */
export function sameFilters(
  a: MediaListFilterState | null,
  b: MediaListFilterState | null
): boolean {
  if (!a || !b) return a === b;
  const genres = (state: MediaListFilterState) => [...state.genres].sort().join('\u0000');
  return (
    a.view === b.view &&
    a.title === b.title &&
    a.format === b.format &&
    a.status === b.status &&
    a.country === b.country &&
    a.year === b.year &&
    a.sort === b.sort &&
    genres(a) === genres(b)
  );
}
