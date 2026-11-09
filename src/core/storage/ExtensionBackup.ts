/**
 * @file ExtensionBackup.ts
 * @description Full backup of the extension's own storage, to move every preference,
 * custom list and Astra record to another browser. Login tokens and rebuildable caches
 * are never written to the file; pending AniList writes stay with the browser that queued them.
 */

import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY } from '@shared/messages';
import { STORAGE_PREFIX } from '@core/constants';
import { PAGE_PREFS_MIRROR_KEY } from './PagePrefsMirror';

export const BACKUP_FORMAT = 'anilist-ultimate-backup';
export const BACKUP_VERSION = 1;
/** Generous cap: chrome.storage.local itself is limited to ~10 MB. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface ExtensionBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  sync: Record<string, unknown>;
  local: Record<string, unknown>;
}

const NEVER_EXPORTED = new Set([
  AUTH_STORAGE_KEY,
  AUTH_USER_CACHE_KEY,
  AUTH_SESSION_KEY,
  `${STORAGE_PREFIX}access_token`,
  `${STORAGE_PREFIX}sync_queue_v1`,
]);
const NEVER_EXPORTED_PREFIXES = [
  `${STORAGE_PREFIX}cache_`,
  `${STORAGE_PREFIX}sync_recovery_`,
  `${STORAGE_PREFIX}hover_comments_cache`,
];

/** Login, pending writes and caches stay out of the file; everything else is the user's data. */
export function isBackedUpKey(key: string): boolean {
  if (NEVER_EXPORTED.has(key)) return false;
  return !NEVER_EXPORTED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function pick(area: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(area).filter(([key]) => isBackedUpKey(key)));
}

export function buildBackup(
  sync: Record<string, unknown>,
  local: Record<string, unknown>,
  now: Date = new Date()
): ExtensionBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    sync: pick(sync),
    local: pick(local),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validates a backup file; throws a message fit for the settings page. */
export function parseBackup(text: string): ExtensionBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('This file is too large to be a backup.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid backup.');
  }
  if (!isPlainRecord(data) || data.format !== BACKUP_FORMAT)
    throw new Error('This file is not an AniList Ultimate backup.');
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION)
    throw new Error('This backup comes from a newer version of the extension. Update it first.');
  if (!isPlainRecord(data.sync) || !isPlainRecord(data.local))
    throw new Error('This backup is damaged.');
  return {
    format: BACKUP_FORMAT,
    version: data.version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    sync: pick(data.sync),
    local: pick(data.local),
  };
}

interface Area {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** Makes an area match the backup: backed-up keys missing from it are removed, login is untouched. */
async function replaceArea(area: Area, values: Record<string, unknown>): Promise<void> {
  const current = await area.get(null);
  const stale = Object.keys(current).filter((key) => isBackedUpKey(key) && !(key in values));
  if (stale.length) await area.remove(stale);
  if (Object.keys(values).length) await area.set(values);
}

/**
 * Restores a backup. The page-preference mirror is stamped so every AniList tab adopts the
 * restored values (they live in anilist.co's localStorage) the next time it loads.
 */
export async function restoreBackup(
  backup: ExtensionBackup,
  storage: { sync: Area; local: Area } = chrome.storage as never,
  now: number = Date.now()
): Promise<void> {
  const local = { ...backup.local };
  const mirror = local[PAGE_PREFS_MIRROR_KEY];
  if (isPlainRecord(mirror)) local[PAGE_PREFS_MIRROR_KEY] = { ...mirror, restoredAt: now };
  await replaceArea(storage.sync, backup.sync);
  await replaceArea(storage.local, local);
}
