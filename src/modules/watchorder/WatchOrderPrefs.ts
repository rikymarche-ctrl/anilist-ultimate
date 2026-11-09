/**
 * @file WatchOrderPrefs.ts
 * @description Viewer preferences of the Watch Order section (view, filters, map style),
 * (open/closed is not one of them: the section opens on every page once it has loaded),
 * remembered per browser so every franchise page opens the way it was last left.
 */

import { mirrorPagePref } from '@core/storage/PagePrefsMirror';
import type { BranchKind } from './WatchOrderTheme';

/** What is on screen: derived from the two tabs, the release-date toggle and the curated order. */
export type OrderMode = 'curated' | 'story' | 'release' | 'map';
/** The two tabs: the watch order as a list, or the relation map. */
export type ViewTab = 'list' | 'map';

export interface WatchOrderPrefs {
  /** Last tab the viewer picked; null until they pick one. */
  mode: ViewTab | null;
  /** List sorted by release date instead of the watch order. */
  releaseSort: boolean;
  specials: boolean;
  hideWatched: boolean;
  posters: boolean;
  /** Map laid out as the curated order (one line) when there is one; the default. */
  curatedMap: boolean;
  /** Minimap over the map; off unless turned on from the map controls. */
  minimap: boolean;
  /** Relation kinds whose titles are hidden from the map. */
  hiddenKinds: BranchKind[];
}

export const PREFS_STORAGE_KEY = 'au-watchorder-prefs';

/** Earlier versions stored one of four views; they map onto the two tabs. */
const LEGACY_TABS: Record<string, ViewTab> = {
  list: 'list',
  map: 'map',
  curated: 'list',
  story: 'list',
  release: 'list',
};
const KINDS: readonly BranchKind[] = ['SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY'];

export const DEFAULT_PREFS: WatchOrderPrefs = {
  mode: null,
  releaseSort: false,
  specials: false,
  hideWatched: false,
  posters: false,
  curatedMap: true,
  minimap: false,
  hiddenKinds: [],
};

/** Parse stored preferences; anything unexpected falls back to the default for that field. */
export function parsePrefs(raw: string | null): WatchOrderPrefs {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      value = parsed as Record<string, unknown>;
  } catch {
    /* corrupted entry: defaults */
  }
  const bool = (key: keyof WatchOrderPrefs, fallback: boolean) =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : fallback;
  const mode =
    typeof value.mode === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_TABS, value.mode)
      ? LEGACY_TABS[value.mode]
      : null;
  const hidden = Array.isArray(value.hiddenKinds)
    ? KINDS.filter((kind) => (value.hiddenKinds as unknown[]).includes(kind))
    : [];
  return {
    mode,
    releaseSort: bool('releaseSort', value.mode === 'release'),
    specials: bool('specials', false),
    hideWatched: bool('hideWatched', false),
    posters: bool('posters', false),
    curatedMap: bool('curatedMap', true),
    minimap: bool('minimap', false),
    hiddenKinds: hidden,
  };
}

export function loadPrefs(): WatchOrderPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: WatchOrderPrefs): void {
  try {
    const raw = JSON.stringify(prefs);
    window.localStorage.setItem(PREFS_STORAGE_KEY, raw);
    mirrorPagePref(PREFS_STORAGE_KEY, raw);
  } catch {
    /* storage unavailable: preferences stay in memory */
  }
}
