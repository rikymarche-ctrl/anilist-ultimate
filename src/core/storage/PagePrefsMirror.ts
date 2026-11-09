/**
 * @file PagePrefsMirror.ts
 * @description Some view preferences (Watch Order, collapsed sections) live in anilist.co's
 * localStorage so they load synchronously. This keeps a copy in extension storage, so a backup
 * carries them to another browser, and copies restored values back into the page on load.
 */

import { STORAGE_PREFIX } from '@core/constants';
import { localStorageOperation } from './LocalStorageBridge';

export const PAGE_PREFS_MIRROR_KEY = `${STORAGE_PREFIX}page_prefs`;
/** Remembers which restore this page already adopted. */
const APPLIED_MARKER = 'au-page-prefs-restored';

interface Mirror {
  values: Record<string, string>;
  restoredAt?: number;
}

function parseMirror(raw: unknown): Mirror {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { values: {} };
  const record = raw as Record<string, unknown>;
  const values: Record<string, string> = {};
  if (record.values && typeof record.values === 'object' && !Array.isArray(record.values)) {
    for (const [key, value] of Object.entries(record.values as Record<string, unknown>)) {
      if (typeof value === 'string') values[key] = value;
    }
  }
  const restoredAt = typeof record.restoredAt === 'number' ? record.restoredAt : undefined;
  return restoredAt === undefined ? { values } : { values, restoredAt };
}

async function readMirror(): Promise<Mirror> {
  const result = await localStorageOperation('get', PAGE_PREFS_MIRROR_KEY);
  return parseMirror(result[PAGE_PREFS_MIRROR_KEY]);
}

let writes: Promise<void> = Promise.resolve();

/** Copies one page preference into extension storage. Best effort: the page copy stays the source. */
export function mirrorPagePref(key: string, raw: string): void {
  writes = writes
    .then(async () => {
      const mirror = await readMirror();
      const next: Mirror = { ...mirror, values: { ...mirror.values, [key]: raw } };
      await localStorageOperation('set', { [PAGE_PREFS_MIRROR_KEY]: next });
    })
    .catch(() => undefined);
}

/**
 * Fills the page's localStorage from the mirror: keys the page lacks (a new browser), and every
 * key after a backup was restored. Runs before modules read their preferences.
 */
export async function hydratePagePrefs(keys: readonly string[]): Promise<void> {
  try {
    const mirror = await readMirror();
    const page = window.localStorage;
    const applied = Number(page.getItem(APPLIED_MARKER) ?? 0);
    const restored = mirror.restoredAt !== undefined && mirror.restoredAt > applied;
    for (const key of keys) {
      const value = mirror.values[key];
      if (value === undefined) continue;
      if (restored || page.getItem(key) === null) page.setItem(key, value);
    }
    if (restored) page.setItem(APPLIED_MARKER, String(mirror.restoredAt));
  } catch {
    /* extension storage unavailable: the page keeps its own preferences */
  }
}
