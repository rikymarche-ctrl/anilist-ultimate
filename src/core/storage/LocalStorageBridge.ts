import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY, MSG } from '@shared/messages';
import { STORAGE_PREFIX } from '@core/constants';

export function needsLocalStorageBridge(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}
export async function localStorageOperation(operation: 'get' | 'set' | 'remove' | 'all' | 'usage', value?: unknown): Promise<Record<string, unknown>> {
  if (needsLocalStorageBridge()) {
    const response = await chrome.runtime.sendMessage({ type: MSG.LOCAL_STORAGE, operation, value });
    if (!response || response.success !== true) throw new Error('Local storage background operation failed');
    return response.data;
  }
  switch (operation) {
    case 'get': return chrome.storage.local.get(value as string | string[]);
    case 'set': await chrome.storage.local.set(value as Record<string, unknown>); return {};
    case 'remove': await chrome.storage.local.remove(value as string | string[]); return {};
    case 'all': return chrome.storage.local.get(null);
    case 'usage': return localUsage();
  }
}

/** Firefox lacks storage.local.getBytesInUse/QUOTA_BYTES: estimate from the serialized contents there. */
async function localUsage(): Promise<Record<string, unknown>> {
  const local = chrome.storage.local;
  if (typeof local.getBytesInUse === 'function') return { bytesInUse: await local.getBytesInUse(), quota: local.QUOTA_BYTES };
  const all = await local.get(null);
  const bytesInUse = Object.entries(all).reduce((total, [key, value]) => total + key.length + JSON.stringify(value ?? null).length, 0);
  return { bytesInUse, quota: undefined };
}

/** These keys are handled by dedicated auth/queue/repository protocols. */
export function isPublicLocalKey(key: string): boolean {
  if ([AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY, `${STORAGE_PREFIX}access_token`, `${STORAGE_PREFIX}sync_queue_v1`].includes(key)) return false;
  if (key.startsWith(`${STORAGE_PREFIX}astra_`)) return /^anilist_ultimate_astra_account_(?:[1-9]\d*|local)_au_astra_revision$/.test(key);
  if (['calendar_schedule', 'social_followings', 'social_followers', 'notifications_activity', 'social_friends', 'activity_scores']
    .some(namespace => key === `${STORAGE_PREFIX}cache_${namespace}`)) return false;
  if (['hover_comments_cache', 'hover_comments_cache_v2'].some(name => key === `${STORAGE_PREFIX}${name}`)) return false;
  if (key.startsWith('friend_alerts_account_')) return false;
  if (key.startsWith('custom_lists_account_')
    || key.startsWith(`${STORAGE_PREFIX}sync_recovery_`)) return false;
  if (key.startsWith(`${STORAGE_PREFIX}au_astra_`)) return key === `${STORAGE_PREFIX}au_astra_dashboard_state_v2`;
  return key.startsWith(STORAGE_PREFIX);
}

export async function dispatchLocalStorage(operation: unknown, value: unknown): Promise<Record<string, unknown>> {
  const keys = typeof value === 'string' ? [value] : Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value) : [];
  if (operation === 'all') {
    const all = await chrome.storage.local.get(null);
    return Object.fromEntries(Object.entries(all).filter(([key]) => isPublicLocalKey(key)));
  }
  if (operation === 'usage') return localUsage();
  if (!keys.length || keys.length > 1000 || !keys.every(key => typeof key === 'string' && key.length <= 300 && isPublicLocalKey(key))) throw new Error('Local storage key not allowed');
  if (operation === 'get') {
    if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Invalid storage keys');
    return chrome.storage.local.get(value);
  }
  if (operation === 'remove' || operation === 'set') {
    if (keys.some(key => key.endsWith('au_astra_revision'))) throw new Error('Repository revision is read only');
    if (operation === 'remove') {
      if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Invalid storage keys');
      await chrome.storage.local.remove(value);
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 8 * 1024 * 1024) throw new Error('Invalid storage values');
      await chrome.storage.local.set(value);
    }
    return {};
  }
  throw new Error('Unknown local storage operation');
}

/** Never broadcast credential or payload values into content scripts. */
export function broadcastLocalStorageChanges(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local') return;
  const keys = Object.keys(changes).filter(key => isPublicLocalKey(key) || key.startsWith('custom_lists_account_') || key.startsWith('friend_alerts_account_'));
  const authChanged = [AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY].some(key => key in changes);
  const syncQueueChanged = `${STORAGE_PREFIX}sync_queue_v1` in changes;
  if (!keys.length && !authChanged && !syncQueueChanged) return;
  void chrome.tabs.query({ url: 'https://anilist.co/*' }).then(tabs => {
    return Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => chrome.tabs.sendMessage(tab.id!, { type: MSG.LOCAL_CHANGED, keys, authChanged, ...(syncQueueChanged ? { syncQueueChanged: true } : {}) })));
  }).catch(() => undefined);
}
