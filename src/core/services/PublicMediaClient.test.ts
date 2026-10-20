import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_THEMES_BASE_URL, PublicMediaClient, PUBLIC_MEDIA_TIMEOUT_MS } from './PublicMediaClient';

describe('shared public media requests', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shares a pending read across six tabs and detaches each response', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = new PublicMediaClient();
    const requests = Array.from({ length: 6 }, () => client.get('/anime/1/themes'));
    finish({ ok: true, json: async () => ({ data: { openings: ['Song'] } }) } as Response);
    const results = await Promise.all(requests) as { data: { openings: string[] } }[];
    results[0].data.openings[0] = 'Changed';
    expect(results[1].data.openings).toEqual(['Song']); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps anime, manga and themes with the same MAL ID separate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: {} }) } as Response);
    const client = new PublicMediaClient();
    await Promise.all(['/anime/1', '/manga/1', '/anime/1/themes'].map(path => client.get(path)));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('spaces different music requests across tabs while sharing duplicates in the waiting queue', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: {} }) } as Response);
    const client = new PublicMediaClient(MUSIC_THEMES_BASE_URL, 550);
    const results = Promise.all([client.get('/anime/1/themes'), client.get('/anime/2/themes'), client.get('/anime/2/themes'), client.get('/anime/3/themes')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(549); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(550); await results;
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([1, 2, 3].map(id => `https://api.tenrai.org/v1/anime/${id}/themes`));
  });

  it.each(['fetch', 'body'])('aborts and releases all callers when %s never settles', async stage => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      signal = init?.signal as AbortSignal;
      return stage === 'fetch' ? new Promise<Response>(() => {})
        : Promise.resolve({ ok: true, json: () => new Promise(() => {}) } as Response);
    });
    const client = new PublicMediaClient();
    const results = Promise.allSettled([client.get('/anime/1'), client.get('/anime/1')]);
    await vi.advanceTimersByTimeAsync(PUBLIC_MEDIA_TIMEOUT_MS);
    expect(signal?.aborted).toBe(true);
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off repeated failures, then permits recovery without caching an error as empty data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({ data: { malId: 1, score: 8 } }) } as Response);
    const client = new PublicMediaClient();
    await expect(client.get('/anime/1')).rejects.toMatchObject({ statusCode: 429 });
    await expect(client.get('/anime/1')).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(client.get('/anime/1')).resolves.toMatchObject({ data: { malId: 1, score: 8 } });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
