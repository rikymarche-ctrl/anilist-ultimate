import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackgroundMessageHandler } from './BackgroundRouter';
import { SyncQueueClient } from './SyncQueueClient';
import { SyncQueueService } from './SyncQueueService';
import { MSG } from '@shared/messages';

const sender = { id: 'extension-test', url: 'https://anilist.co/home' };
const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() };
function makeQueue() {
  const data = new Map<string, unknown>();
  const store = { get: vi.fn(async (key: string) => { await Promise.resolve(); return structuredClone(data.get(key) ?? null); }),
    set: vi.fn(async (key: string, value: unknown) => { await Promise.resolve(); data.set(key, structuredClone(value)); return true; }),
    remove: vi.fn(async (key: string) => { data.delete(key); return true; }) };
  const api = { getQueueStatus: () => ({ isRateLimited: true }), mutate: vi.fn() };
  const auth = { ensureInitialized: async () => {}, hasToken: () => true, getUserCache: () => ({ userId: 42 }), getSessionId: () => 'test' };
  return { queue: new SyncQueueService(store as never, logger as never, api as never, auth as never), store, api };
}

describe('background queue boundary', () => {
  beforeEach(() => { vi.useFakeTimers(); chrome.runtime.id = 'extension-test'; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it.each([
    { id: 'other', url: 'https://anilist.co/home' },
    { id: 'extension-test', url: 'https://anilist.co.attacker.test/home' },
    { id: 'extension-test', url: 'http://anilist.co/home' },
    { id: 'extension-test', url: 'chrome-extension://other/popup.html' },
    { id: 'extension-test' },
  ])('rejects a message from untrusted sender %j', rejected => {
    const getQueue = vi.fn();
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), getQueue);
    expect(handle({ type: MSG.SYNC_PROCESS }, rejected, respond)).toBe(false);
    expect(getQueue).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it('awaits cold-start readiness before resolving a service', async () => {
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const { queue } = makeQueue();
    const getQueue = vi.fn(() => queue);
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(ready, () => ({ getStatus: async () => ({ sessionId: 'test', authenticated: true, userId: 42 }) }) as never, getQueue);
    expect(handle({ type: MSG.SYNC_GET, sessionId: 'test' }, sender, respond)).toBe(true);
    await Promise.resolve();
    expect(getQueue).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(respond).toHaveBeenCalledWith({ success: true, data: [] });
  });
  it('routes friend alert commands through the dedicated account host', async () => {
    const dispatch = vi.fn(async () => ({ rules: [], alerts: [], lastPoll: 0 }));
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn(), undefined, undefined, undefined, undefined, () => ({ dispatch }) as never);
    expect(handle({ type: MSG.FRIEND_ALERTS, operation: 'watch', value: { mediaId: 10, list: 'Best Friends' }, sessionId: 'one' }, sender, respond)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledWith('watch', { mediaId: 10, list: 'Best Friends' }, 'one');
    expect(respond).toHaveBeenCalledWith({ success: true, data: { rules: [], alerts: [], lastPoll: 0 } });
  });
  it('reports failed startup without attempting the mutation', async () => {
    const getQueue = vi.fn();
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.reject(new Error('Init failed')), vi.fn(), getQueue);
    handle({ type: MSG.SYNC_PROCESS }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(getQueue).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ success: false, error: 'Background operation failed' });
  });
  it('fetches themes only from the fixed Tenrai endpoint for a valid MAL ID', async () => {
    const response = { data: { openings: ['Opening'], endings: ['Ending'] } };
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => response } as Response);
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn());
    expect(handle({ type: MSG.MEDIA_MUSIC_THEMES, idMal: 100 }, sender, respond)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith('https://api.tenrai.org/v1/anime/100/themes', expect.objectContaining({ signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer' }));
    expect(respond).toHaveBeenCalledWith({ success: true, data: response });
  });
  it('searches Jikan by a validated title through its fixed anime endpoint', async () => {
    const response = { data: [{ malId: 100, title: 'Anime' }] };
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => response } as Response);
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn());
    expect(handle({ type: MSG.MEDIA_MUSIC_SEARCH, title: 'Romelia War Chronicle' }, sender, respond)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith('https://jikan.lucashdo.com/v1/anime?q=Romelia+War+Chronicle', expect.objectContaining({ signal: expect.any(AbortSignal), credentials: 'omit' }));
    expect(respond).toHaveBeenCalledWith({ success: true, data: response });
  });
  it.each(['ANIME', 'MANGA'])('retrieves public %s metadata in the background without an account token', async mediaType => {
    const response = { data: { malId: 100, score: 8.5 } };
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => response } as Response);
    const respond = vi.fn();
    createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn())(
      { type: MSG.MEDIA_METADATA_SCORE, idMal: 100, mediaType }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith(`https://jikan.lucashdo.com/v1/${mediaType.toLowerCase()}/100`, {
      signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    expect(respond).toHaveBeenCalledWith({ success: true, data: response });
  });
  it.each([{ idMal: 0, mediaType: 'ANIME' }, { idMal: '100', mediaType: 'MANGA' },
    { idMal: 100, mediaType: 'anime' }, { idMal: 100, mediaType: '../anime' }, { idMal: 100 }])('rejects invalid metadata identity %j', async args => {
    const request = vi.spyOn(globalThis, 'fetch'); const respond = vi.fn();
    createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn())({ type: MSG.MEDIA_METADATA_SCORE, ...args }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled(); expect(respond).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it('bounds a long title to the provider search limit without splitting Unicode characters', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);
    const respond = vi.fn();
    createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn())(
      { type: MSG.MEDIA_MUSIC_SEARCH, title: '🎵'.repeat(70) }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    const url = new URL(request.mock.calls[0][0] as string);
    expect(url.searchParams.get('q')).toBe('🎵'.repeat(64)); expect(url.searchParams.has('limit')).toBe(false);
  });
  it.each(['', ' '.repeat(2), 'a'.repeat(201), 'a\nb'])('rejects invalid Jikan title searches before fetching', async title => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn());
    handle({ type: MSG.MEDIA_MUSIC_SEARCH, title }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it.each([0, -1, 1.5, NaN, 2147483648, '100'])('rejects invalid music theme ID %s before fetching', async idMal => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const respond = vi.fn();
    const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn());
    handle({ type: MSG.MEDIA_MUSIC_THEMES, idMal }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it('serializes concurrent tab clients through the single background queue', async () => {
    const { queue } = makeQueue();
    const handle = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ sessionId: 'test', authenticated: true, userId: 42 }) }) as never, () => queue);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) =>
      new Promise(resolve => { handle(message, sender, resolve); })) as never);
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 'test' };
    const clients = [new SyncQueueClient(metadata as never), new SyncQueueClient(metadata as never)];
    await Promise.all(Array.from({ length: 20 }, (_, i) => clients[i % 2].enqueue('ASTRA_SAVE', { mediaId: i + 1, score: i })));
    expect(await clients[0].getQueue()).toHaveLength(20);
  });
  it.each([{ mediaId: -1 }, { mediaId: 1, score: 500 }, { mediaId: 1, query: 'mutation { evil }' }, { mediaId: 1, startedAt: { month: 99 } }])('rejects invalid boundary payload %j', async payload => {
    const { queue, store } = makeQueue();
    const respond = vi.fn();
    createBackgroundMessageHandler(Promise.resolve(), vi.fn(), () => queue)(
      { type: MSG.SYNC_ENQUEUE, mutationType: 'ASTRA_SAVE', payload }, sender, respond);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.set).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
  it('sends mutateOnce to the background client without retrying through mutate', async () => {
    const client = { mutate: vi.fn(), mutateOnce: vi.fn(async () => ({ ToggleLikeV2: { id: 1 } })) };
    const handle = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ sessionId: 'test', authenticated: true, userId: 42 }) }) as never, vi.fn(), () => client as never);
    const response = await new Promise<unknown>(resolve => handle({ type: MSG.API_REQUEST, method: 'mutateOnce', query: 'mutation ($id: Int) { ToggleLikeV2(id: $id, type: ACTIVITY) { ... on TextActivity { id } } }', variables: { id: 1 }, sessionId: 'test' }, sender, resolve));
    expect(response).toEqual({ success: true, data: { ToggleLikeV2: { id: 1 } } });
    expect(client.mutateOnce).toHaveBeenCalledWith(expect.stringContaining('ToggleLikeV2'), { id: 1 });
    expect(client.mutate).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated mutateOnce requests before reaching the background client', async () => {
    const client = { mutate: vi.fn(), mutateOnce: vi.fn() };
    const handle = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ sessionId: 'test', authenticated: false, userId: null }) }) as never, vi.fn(), () => client as never);
    const response = await new Promise<{ success: boolean }>(resolve => handle({ type: MSG.API_REQUEST, method: 'mutateOnce', query: 'mutation ($id: Int) { ToggleLikeV2(id: $id, type: ACTIVITY) { ... on TextActivity { id } } }', variables: { id: 1 }, sessionId: 'test' }, sender, resolve as never));
    expect(response.success).toBe(false);
    expect(client.mutateOnce).not.toHaveBeenCalled();
  });
  it('propagates missing background responses to the caller instead of claiming durability', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(undefined as never);
    await expect(new SyncQueueClient().enqueue('ASTRA_SAVE', { mediaId: 1 })).rejects.toThrow('Background queue unavailable');
  });
  it('returns and clears only current-account queue records, retaining other owners and legacy records', async () => {
    const { queue, store } = makeQueue();
    await store.set('sync_queue_v1', { schemaVersion: 2, revision: 'fixture', entries: [
      { id: 'current', userId: 42, type: 'ASTRA_SAVE', payload: { mediaId: 1 }, retries: 0 },
      { id: 'other', userId: 7, type: 'ASTRA_SAVE', payload: { mediaId: 2 }, retries: 0 },
      { id: 'legacy', type: 'ASTRA_SAVE', payload: { mediaId: 3 }, retries: 0 },
    ] });
    const handle = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ sessionId: 'test', authenticated: true, userId: 42 }) }) as never, () => queue);
    const request = (type: string, sessionId = 'test') => new Promise<{ success: boolean; data?: { id: string }[] }>(resolve => handle({ type, sessionId }, sender, resolve as never));
    expect(await request(MSG.SYNC_GET)).toEqual({ success: true, data: [expect.objectContaining({ id: 'current' })] });
    expect((await request(MSG.SYNC_CLEAR, 'old')).success).toBe(false);
    expect((await request(MSG.SYNC_CLEAR)).success).toBe(true);
    expect((await queue.getQueue()).map(item => item.id)).toEqual(['other', 'legacy']);
  });
});
