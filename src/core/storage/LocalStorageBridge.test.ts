import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEY, MSG } from '@shared/messages';
import { broadcastLocalStorageChanges, dispatchLocalStorage } from './LocalStorageBridge';

describe('local storage privilege boundary', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([AUTH_STORAGE_KEY, 'anilist_ultimate_access_token', 'anilist_ultimate_sync_queue_v1', 'anilist_ultimate_au_astra_work_1', 'foreign_key', 'au_custom_user_lists', 'au_best_friends', 'custom_lists_account_42', 'anilist_ultimate_sync_recovery_original', 'anilist_ultimate_cache_notifications_activity', 'anilist_ultimate_cache_calendar_schedule', 'anilist_ultimate_cache_social_friends', 'anilist_ultimate_cache_social_followers', 'anilist_ultimate_hover_comments_cache', 'anilist_ultimate_hover_comments_cache_v2'])('blocks direct read/write access to %s', async key => {
    await expect(dispatchLocalStorage('get', key)).rejects.toThrow('not allowed');
    await expect(dispatchLocalStorage('set', { [key]: 'injected' })).rejects.toThrow('not allowed');
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('allows scoped cache operations and revision reads without allowing revision writes', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ anilist_ultimate_astra_account_42_au_astra_revision: 7 } as never);
    expect(await dispatchLocalStorage('get', 'anilist_ultimate_astra_account_42_au_astra_revision')).toEqual({ anilist_ultimate_astra_account_42_au_astra_revision: 7 });
    await expect(dispatchLocalStorage('set', { anilist_ultimate_astra_account_42_au_astra_revision: 999 })).rejects.toThrow('read only');
    await dispatchLocalStorage('set', { anilist_ultimate_cache_music: [] });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ anilist_ultimate_cache_music: [] });
  });
  it('filters credentials and repository data from enumeration', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ [AUTH_STORAGE_KEY]: 'secret', anilist_ultimate_cache_music: [], anilist_ultimate_au_astra_work_1: { notes: 'private' }, anilist_ultimate_cache_social_followers: [{ userId: 9 }] } as never);
    expect(await dispatchLocalStorage('all', undefined)).toEqual({ anilist_ultimate_cache_music: [] });
  });
  it('broadcasts only key signals, never tokens, notes or journal payloads', async () => {
    const query = vi.fn(async () => [{ id: 1 }]);
    const sendMessage = vi.fn(async () => {});
    chrome.tabs = { query, sendMessage } as never;
    broadcastLocalStorageChanges({ [AUTH_STORAGE_KEY]: { newValue: 'secret' }, anilist_ultimate_au_astra_pending_commit: { newValue: { notes: 'private' } }, anilist_ultimate_astra_account_42_au_astra_revision: { newValue: 1 } }, 'local');
    await Promise.resolve(); await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(1, { type: MSG.LOCAL_CHANGED, keys: ['anilist_ultimate_astra_account_42_au_astra_revision'], authChanged: true });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('private');
  });
  it('broadcasts a queue invalidation signal without leaking owner, notes or payload values', async () => {
    const query = vi.fn(async () => [{ id: 1 }]); const sendMessage = vi.fn(async () => {});
    chrome.tabs = { query, sendMessage } as never;
    broadcastLocalStorageChanges({ anilist_ultimate_sync_queue_v1: { newValue: { revision: 'opaque', entries: [{ userId: 77, payload: { notes: 'private' } }] } } }, 'local');
    await Promise.resolve(); await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(1, { type: MSG.LOCAL_CHANGED, keys: [], authChanged: false, syncQueueChanged: true });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('private'); expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('77');
  });

});
