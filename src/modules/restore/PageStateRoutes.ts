/**
 * @file PageStateRoutes.ts
 * @description Route matching and history keys for the Back-navigation restore feature
 *
 * Page kinds:
 *   - Media lists:  /user/<name>/animelist[/<section>], /user/<name>/mangalist[/<section>]
 *                   (the "Lists" sidebar rewrites the section into the path)
 *   - Everything else is a potential scroll-loader page: Browse, the Home and profile
 *     activity feeds, social tabs, reviews, list comparisons... Whether a page really
 *     loads content on scroll is decided by its rendered markup, not by its path.
 *
 * History keys:
 *   The Navigation API exposes a stable key per session history entry that
 *   survives replaceState (AniList's list sidebar replaces the URL and wipes
 *   history.state). When it is unavailable the URL itself is the key.
 */

import type { RestorablePageKind } from './PageStateTypes';

const MEDIA_LIST_PATH = /^\/user\/[^/]+\/(?:anime|manga)list(?:\/([^/]+))?\/?$/;

/** Sub-pages of a media list route that are not the list itself. */
const NON_LIST_SECTIONS = new Set(['compare']);

/** Restorable page identity resolved from the current location. */
export interface RestorablePage {
  readonly kind: RestorablePageKind;
  readonly url: string;
  readonly key: string;
}

/** Minimal Navigation API surface (not yet in the TypeScript DOM lib). */
interface NavigationEntryHost {
  readonly navigation?: { readonly currentEntry?: { readonly key?: unknown } | null };
}

/** Resolve which kind of restorable page a pathname belongs to. */
export function resolveRestorablePageKind(pathname: string): RestorablePageKind {
  const list = MEDIA_LIST_PATH.exec(pathname);
  const isList = !!list && !(list[1] && NON_LIST_SECTIONS.has(list[1].toLowerCase()));
  return isList ? 'mediaList' : 'scrollLoader';
}

/**
 * Module page matcher. Any AniList page may hold a scroll loader, so the module
 * runs everywhere; pages without one never produce a snapshot.
 */
export function isRestorablePath(_pathname: string): boolean {
  return true;
}

/** Key of the current session history entry, when the Navigation API exposes one. */
export function currentHistoryEntryKey(
  host: NavigationEntryHost = window as NavigationEntryHost
): string | null {
  try {
    const key = host.navigation?.currentEntry?.key;
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Snapshot store key for a page URL.
 * Prefixed so entry keys and URL keys can never collide.
 */
export function pageStateKey(url: string, entryKey: string | null): string {
  return entryKey ? `entry:${entryKey}` : `url:${url}`;
}

/** Identity of the page currently shown. */
export function resolveCurrentPage(
  location: Pick<Location, 'pathname' | 'search'> = window.location,
  entryKey: string | null = currentHistoryEntryKey()
): RestorablePage {
  const url = `${location.pathname}${location.search}`;
  return {
    kind: resolveRestorablePageKind(location.pathname),
    url,
    key: pageStateKey(url, entryKey),
  };
}
