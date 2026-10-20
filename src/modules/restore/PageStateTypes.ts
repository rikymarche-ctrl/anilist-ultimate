/**
 * @file PageStateTypes.ts
 * @description Snapshot model for the Back-navigation restore feature
 *
 * A snapshot records what the user saw on a restorable page when they left it:
 *   - the page kind and URL (pathname + query) it belongs to
 *   - the window scroll offset
 *   - how much content was loaded: rendered entries on media lists, or how far the
 *     content of an AniList infinite-scroll loader reached on every other page
 *   - the list filters that AniList keeps only in component state (media lists)
 *
 * Other pages (Browse, Home and profile activity feeds, social tabs...) keep their
 * filters in the URL query or in AniList's global store, which survive a Back navigation,
 * so only the loaded content and the scroll offset need restoring. The rare filter kept
 * in component state (a profile feed's type dropdown) restarts from its default.
 *
 * Snapshots are mirrored to the page's sessionStorage, which page scripts can
 * also write. parsePageStateSnapshot() therefore validates every field and caps
 * every size before a stored value is trusted.
 *
 * @see PageStateStore.ts for persistence
 * @see PageStateRestorer.ts for how a snapshot is replayed
 */

/**
 * - mediaList: a user's anime/manga list (filters in component state, local rendering)
 * - scrollLoader: any other page whose content grows through AniList's scroll loader
 */
export type RestorablePageKind = 'mediaList' | 'scrollLoader';

/**
 * Media list filters as displayed by AniList's filter sidebar.
 * Select values are stored as their visible labels (e.g. "OVA", "Score"),
 * which is exactly what the restore step clicks on. The "Lists" section
 * ("Planning", a custom list) is not part of it: AniList writes it into the
 * path, so the restored URL already carries it.
 */
export interface MediaListFilterState {
  /** Index of the active list view switch (0 list, 1 compact, 2 cards). */
  readonly view: number | null;
  readonly title: string;
  readonly format: string | null;
  readonly status: string | null;
  readonly genres: readonly string[];
  readonly country: string | null;
  /** Year slider value; null when the slider sits at its minimum (no filter). */
  readonly year: number | null;
  readonly sort: string | null;
}

export interface PageStateSnapshot {
  /** Store key: the history entry key when the Navigation API exists, else the URL. */
  readonly key: string;
  /** pathname + search of the page the snapshot belongs to. */
  readonly url: string;
  readonly kind: RestorablePageKind;
  readonly scrollY: number;
  /**
   * How much content was loaded, in the unit of the page's adapter: rendered entries on
   * media lists, the layout offset (px) of the loader sentinel on scroll-loader pages.
   */
  readonly loaded: number;
  /** Which AniList scroll loader of the page was measured (document order); null on lists. */
  readonly loaderIndex: number | null;
  readonly filters: MediaListFilterState | null;
  readonly capturedAt: number;
}

/**
 * Cancellation and pacing handle for one restore run.
 * Every step that drives page controls checks `aborted` first, so a user interaction
 * (or leaving the page) stops it between two programmatic actions.
 */
export interface RestoreRunControl {
  readonly aborted: boolean;
  /** Poll until the predicate holds; false on timeout or abort. */
  waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean>;
  /** Yield long enough for the page framework to re-render after a DOM action. */
  settle(): Promise<void>;
}

/** Hard caps for values read back from sessionStorage. */
export const SNAPSHOT_LIMITS = {
  MAX_KEY_LENGTH: 2200,
  MAX_URL_LENGTH: 2048,
  MAX_TEXT_LENGTH: 200,
  MAX_GENRES: 50,
  MAX_SCROLL_Y: 10_000_000,
  MAX_LOADED: 10_000_000,
  MAX_LOADER_INDEX: 50,
  MAX_VIEW_INDEX: 10,
  MAX_YEAR: 9999,
} as const;

const KINDS: readonly RestorablePageKind[] = ['mediaList', 'scrollLoader'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(
  value: unknown,
  maxLength: number = SNAPSHOT_LIMITS.MAX_TEXT_LENGTH
): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isBoundedInteger(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function parseOptionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isBoundedText(value) && value.length > 0 ? value : undefined;
}

/**
 * Validate an untrusted media list filter state.
 * @returns the parsed state, or null when any field is malformed
 */
export function parseMediaListFilterState(value: unknown): MediaListFilterState | null {
  if (!isRecord(value)) return null;
  const { view, title, format, status, genres, country, year, sort } = value;
  const texts = [format, status, country, sort].map(parseOptionalText);
  if (texts.some((text) => text === undefined)) return null;
  if (!isBoundedText(title)) return null;
  if (view !== null && !isBoundedInteger(view, SNAPSHOT_LIMITS.MAX_VIEW_INDEX)) return null;
  if (year !== null && !isBoundedInteger(year, SNAPSHOT_LIMITS.MAX_YEAR)) return null;
  if (!Array.isArray(genres) || genres.length > SNAPSHOT_LIMITS.MAX_GENRES) return null;
  if (!genres.every((genre) => isBoundedText(genre) && genre.length > 0)) return null;
  const [parsedFormat, parsedStatus, parsedCountry, parsedSort] = texts as (string | null)[];
  return {
    view,
    title,
    format: parsedFormat,
    status: parsedStatus,
    genres: [...genres] as string[],
    country: parsedCountry,
    year,
    sort: parsedSort,
  };
}

/**
 * Validate an untrusted snapshot (e.g. read back from sessionStorage).
 * @returns the parsed snapshot, or null when any field is malformed
 */
export function parsePageStateSnapshot(value: unknown): PageStateSnapshot | null {
  if (!isRecord(value)) return null;
  const { key, url, kind, scrollY, loaded, loaderIndex, filters, capturedAt } = value;
  if (!isBoundedText(key, SNAPSHOT_LIMITS.MAX_KEY_LENGTH) || key.length === 0) return null;
  if (!isBoundedText(url, SNAPSHOT_LIMITS.MAX_URL_LENGTH) || !url.startsWith('/')) return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind as RestorablePageKind)) return null;
  if (!isBoundedInteger(scrollY, SNAPSHOT_LIMITS.MAX_SCROLL_Y)) return null;
  if (!isBoundedInteger(loaded, SNAPSHOT_LIMITS.MAX_LOADED)) return null;
  if (loaderIndex !== null && !isBoundedInteger(loaderIndex, SNAPSHOT_LIMITS.MAX_LOADER_INDEX)) {
    return null;
  }
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt < 0) return null;
  const parsedFilters = filters === null ? null : parseMediaListFilterState(filters);
  if (filters !== null && parsedFilters === null) return null;
  return {
    key,
    url,
    kind: kind as RestorablePageKind,
    scrollY,
    loaded,
    loaderIndex,
    filters: parsedFilters,
    capturedAt,
  };
}
