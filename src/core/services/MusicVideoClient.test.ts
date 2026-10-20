import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '@/test/fixtures/music-videos.json';
import { MUSIC_VIDEO_INDEX_BASE_URL, MusicVideoClient } from './MusicVideoClient';

describe('shared public theme video catalogue', () => {
  const session = new Map<string, unknown>();
  beforeEach(() => {
    session.clear();
    vi.stubGlobal('chrome', { storage: { session: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(session.get(key)) })),
      set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) session.set(key, structuredClone(value)); }),
    } } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function provider() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      const name = String(url).split('/').pop();
      const data = name === 'manifest.json' ? fixtures.manifest : name === '4988.json' ? fixtures['4988'] : fixtures['5009'];
      return { ok: true, json: async () => structuredClone(data) } as Response;
    });
  }
  it('loads one index across six tabs, coalesces identical works and detaches results', async () => {
    const fetchMock = provider(); const client = new MusicVideoClient();
    const replies = await Promise.all(Array.from({ length: 6 }, () => client.get(63382)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    replies[0].links[0].titles[0] = 'Changed'; expect(replies[1].links[0].titles[0]).toBe('RESPAWN!!');
    await client.get(61578); await client.get(63382); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reuses the compact session index after a worker restart', async () => {
    const fetchMock = provider(); await new MusicVideoClient().get(63382); fetchMock.mockClear();
    await new MusicVideoClient().get(61578);
    expect(fetchMock).toHaveBeenCalledWith(`${MUSIC_VIDEO_INDEX_BASE_URL}/4988.json`, expect.any(Object));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('keeps optional storage failures from blocking public links', async () => {
    const fetchMock = provider(); vi.mocked(chrome.storage.session.get).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(chrome.storage.session.set).mockRejectedValue(new Error('Unavailable'));
    expect((await new MusicVideoClient().get(63382)).links).toHaveLength(2); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('refetches an invalid persisted index and never follows its URLs', async () => {
    const fetchMock = provider(); session.set('media_theme_video_index_v1', { cachedAt: Date.now(), ids: { 63382: 'https://evil.test' } });
    await new MusicVideoClient().get(63382);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(MUSIC_VIDEO_INDEX_BASE_URL + '/'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('returns no links for an unlisted work without fetching an arbitrary snapshot', async () => {
    const fetchMock = provider(); expect(await new MusicVideoClient().get(999)).toEqual({ idMal: 999, links: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([0, -1, 1.5, NaN, 2147483648])('rejects invalid MAL id %s before fetching', async id => {
    const fetchMock = provider(); await expect(new MusicVideoClient().get(id)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a snapshot for another work without caching its links', async () => {
    const fetchMock = provider(); fetchMock.mockResolvedValueOnce({ ok: true, json: async () => fixtures.manifest } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => fixtures['4988'] } as Response);
    const client = new MusicVideoClient(); await expect(client.get(63382)).rejects.toThrow('identity');
    expect((await client.get(63382)).links).toHaveLength(2);
  });
});
