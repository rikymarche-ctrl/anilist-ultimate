/**
 * @file PageStateStore.ts
 * @description Tab-scoped store for Back-navigation page snapshots
 *
 * Snapshots live in memory and are mirrored to the page's sessionStorage, so a
 * Back navigation that reloads the document (e.g. returning from another site
 * when the page was not kept in the back/forward cache) can still be restored.
 * Nothing is written to chrome.storage: the data is per tab and dies with it.
 *
 * Bounded: at most MAX_ENTRIES snapshots are kept; the least recently saved
 * entries are evicted first. Values read from sessionStorage are untrusted
 * (page scripts share it) and are validated entry by entry.
 *
 * @see PageStateTypes.ts for the snapshot model and validation
 */

import { injectable } from 'tsyringe';
import { logger } from '@core/logger';
import { STORAGE_PREFIX } from '@core/constants';
import { parsePageStateSnapshot, type PageStateSnapshot } from './PageStateTypes';

export const PAGE_STATE_STORAGE_KEY = `${STORAGE_PREFIX}page_state`;
export const PAGE_STATE_MAX_ENTRIES = 25;
/** Raw size guard before JSON.parse on a value page scripts could have written. */
const MAX_SERIALIZED_LENGTH = 512 * 1024;

@injectable()
export class PageStateStore {
  /** Insertion order doubles as recency order (re-saving moves an entry to the end). */
  private entries: ReadonlyMap<string, PageStateSnapshot> | null = null;

  /** Snapshot saved for a key, or null. */
  public get(key: string): PageStateSnapshot | null {
    return this.load().get(key) ?? null;
  }

  /** Save (or replace) the snapshot for its key and persist the bounded set. */
  public save(snapshot: PageStateSnapshot): void {
    const next = new Map(this.load());
    next.delete(snapshot.key);
    next.set(snapshot.key, snapshot);
    while (next.size > PAGE_STATE_MAX_ENTRIES) {
      const oldest = next.keys().next().value;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    this.entries = next;
    this.persist(next);
  }

  /** Drop the snapshot for a key. */
  public delete(key: string): void {
    if (!this.load().has(key)) return;
    const next = new Map(this.load());
    next.delete(key);
    this.entries = next;
    this.persist(next);
  }

  private load(): ReadonlyMap<string, PageStateSnapshot> {
    if (!this.entries) this.entries = this.readPersisted();
    return this.entries;
  }

  private readPersisted(): ReadonlyMap<string, PageStateSnapshot> {
    const entries = new Map<string, PageStateSnapshot>();
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(PAGE_STATE_STORAGE_KEY);
    } catch (error) {
      logger.debug('[PageState] sessionStorage unavailable, using memory only', error);
      return entries;
    }
    if (!raw || raw.length > MAX_SERIALIZED_LENGTH) return entries;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.debug('[PageState] Ignoring malformed persisted snapshots');
      return entries;
    }
    if (!Array.isArray(parsed)) return entries;
    for (const candidate of parsed.slice(-PAGE_STATE_MAX_ENTRIES)) {
      const snapshot = parsePageStateSnapshot(candidate);
      if (snapshot) {
        entries.delete(snapshot.key);
        entries.set(snapshot.key, snapshot);
      }
    }
    return entries;
  }

  private persist(entries: ReadonlyMap<string, PageStateSnapshot>): void {
    try {
      window.sessionStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify([...entries.values()]));
    } catch (error) {
      // Quota or access errors only cost cross-document restores; memory still works.
      logger.debug('[PageState] Could not persist snapshots to sessionStorage', error);
    }
  }
}
