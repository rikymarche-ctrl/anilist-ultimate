import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { StorageManager } from './StorageManager';
import { SyncQueueService } from '@core/services/SyncQueueService';
import { AuthTokenService } from '@core/auth/AuthTokenService';
import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY } from '@shared/messages';

const storageGet = (area: 'local' | 'sync') => chrome.storage[area].get as unknown as Mock<(keys: unknown) => Promise<Record<string, unknown>>>;

describe('StorageManager durable read failures', () => {
  beforeEach(() => {
    chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never;
    storageGet('local').mockReset().mockResolvedValue({});
    storageGet('sync').mockReset().mockResolvedValue({});
  });
  it.each(['local', 'sync'] as const)('preserves requested key names in %s batch reads', async area => {
    storageGet(area).mockResolvedValueOnce({
      anilist_ultimate_plain: 4, [AUTH_SESSION_KEY]: 'persisted-session', anilist_ultimate_unrequested: 9,
    });
    const values = await new StorageManager(area).getMultiple(['plain', AUTH_SESSION_KEY, 'missing']);
    expect(values).toEqual({ plain: 4, [AUTH_SESSION_KEY]: 'persisted-session' });
    expect(chrome.storage[area].get).toHaveBeenCalledWith(['anilist_ultimate_plain', AUTH_SESSION_KEY, 'anilist_ultimate_missing']);
  });
  it('boots authentication from real StorageManager without replacing the saved session', async () => {
    storageGet('local').mockResolvedValueOnce({
      [AUTH_STORAGE_KEY]: 'synthetic-token', [AUTH_USER_CACHE_KEY]: { userId: 7, userName: 'Fixture' },
      [AUTH_SESSION_KEY]: 'persisted-session',
    });
    vi.mocked(chrome.storage.local.set).mockClear();
    const token = new AuthTokenService({ info: vi.fn(), error: vi.fn() } as never, { emit: vi.fn() } as never, new StorageManager('local'));
    await token.initialize();
    expect(token.getSessionId()).toBe('persisted-session');
    expect(token.getUserCache()?.userId).toBe(7);
    expect(token.getToken()).toBe('synthetic-token');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('distinguishes a missing key from a failed read', async () => {
    const storage = new StorageManager('local');
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    expect(await storage.get('absent')).toBeNull();
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(storage.get('existing')).rejects.toThrow('Storage unavailable');
  });
  it('rejects failed batch reads instead of returning defaults', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Read failed'));
    await expect(new StorageManager('local').getMultiple(['a', 'b'])).rejects.toThrow('Read failed');
  });
  it('does not overwrite the actual durable queue after a Chrome read error', async () => {
    const storage = new StorageManager('local');
    const queue = new SyncQueueService(storage, { error: vi.fn() } as never, {} as never);
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Read failed'));
    vi.mocked(chrome.storage.local.set).mockClear();
    await expect(queue.enqueue('ASTRA_SAVE', { mediaId: 1 })).rejects.toThrow('Read failed');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
