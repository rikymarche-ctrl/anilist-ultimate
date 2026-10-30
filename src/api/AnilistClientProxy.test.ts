import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const raw = vi.fn();
vi.mock('graphql-request', () => ({ GraphQLClient: vi.fn().mockImplementation(function () { return { rawRequest: raw }; }) }));
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import { AnilistClient } from './AnilistClient';
import { AnilistClientProxy } from './AnilistClientProxy';

describe('shared API client without credential exposure', () => {
  let session: string;
  let handle: ReturnType<typeof createBackgroundMessageHandler>;
  let background: AnilistClient;
  const metadata = () => ({ ensureInitialized: async () => {}, hasToken: () => true, getSessionId: () => session });
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'extension-test'; session = 's1';
    raw.mockReset().mockResolvedValue({ data: { Viewer: { id: 1, name: 'User' } } });
    background = new AnilistClient({ handle: vi.fn() } as never, { ensureInitialized: async () => {}, getToken: () => 'private-background-token' } as never, new EventBus());
    handle = createBackgroundMessageHandler(Promise.resolve(), () => ({ getStatus: async () => ({ authenticated: true, userId: 1, sessionId: session }) }) as never, vi.fn(), () => background);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => new Promise(resolve => { handle(message, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve); })) as never);
  });
  afterEach(() => { background.clearQueue(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it('uses one rate limit for simultaneous queries from two clients', async () => {
    const clients = [new AnilistClientProxy(metadata() as never, new EventBus()), new AnilistClientProxy(metadata() as never, new EventBus())];
    const requests = Array.from({ length: 30 }, (_, i) => clients[i % 2].query('query { Viewer { id name } }'));
    await vi.advanceTimersByTimeAsync(45000);
    // Background reads keep 5 window slots free for priority work, so 20 dispatch in the first minute.
    expect(raw).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(25000);
    expect(await Promise.all(requests)).toHaveLength(30);
    expect(raw).toHaveBeenCalledTimes(30);
    expect(clients[0]).not.toHaveProperty('getAccessToken');
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.every(([message]) => !JSON.stringify(message).includes('private-background-token'))).toBe(true);
  });
  it('rejects an obsolete session before any network request', async () => {
    const response = await new Promise<{ success: boolean }>(resolve => handle({ type: 'api:request', query: 'query { Viewer { id } }', variables: {}, method: 'query', sessionId: 'old' }, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve as never));
    expect(response.success).toBe(false);
    expect(raw).not.toHaveBeenCalled();
  });
  it('does not deliver responses after the account changed while fetching', async () => {
    let finish!: (value: unknown) => void;
    raw.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const bus = new EventBus();
    const proxy = new AnilistClientProxy(metadata() as never, bus);
    const pending = proxy.query('query { Viewer { id } }');
    const rejected = expect(pending).rejects.toThrow('queue cleared');
    await vi.advanceTimersByTimeAsync(0);
    session = 's2';
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 2, timestamp: new Date() });
    await rejected;
    finish({ data: { Viewer: { id: 1 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(proxy.getQueueStatus().queueLength).toBe(0);
  });
  it('rejects invalid operations before forwarding to the GraphQL client', async () => {
    const proxy = new AnilistClientProxy(metadata() as never, new EventBus());
    await expect(proxy.mutate('mutation { DeleteUser(id:1) { id } }')).rejects.toThrow('background request failed');
    expect(raw).not.toHaveBeenCalled();
  });
  it('sends non-idempotent mutations as mutateOnce over the messaging channel', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: { ToggleLikeV2: { id: 1 } } });
    const proxy = new AnilistClientProxy(metadata() as never, new EventBus());
    await expect(proxy.mutateOnce('mutation ($id: Int) { ToggleLikeV2(id: $id, type: ACTIVITY) { ... on TextActivity { id } } }', { id: 1 })).resolves.toEqual({ ToggleLikeV2: { id: 1 } });
    expect(vi.mocked(chrome.runtime.sendMessage).mock.lastCall?.[0]).toEqual(expect.objectContaining({ method: 'mutateOnce', variables: { id: 1 }, silent: false }));
    proxy.destroy();
  });
  it('settles a request when the messaging channel rejects with a non-Error value', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(null);
    const bus = new EventBus(); const errors = vi.fn(); bus.on(EVENT_TYPES.API_ERROR, errors);
    const proxy = new AnilistClientProxy(metadata() as never, bus);
    await expect(proxy.query('query { Viewer { id } }')).rejects.toThrow('background request failed');
    await vi.advanceTimersByTimeAsync(0); expect(proxy.getQueueStatus().queueLength).toBe(0); expect(errors).toHaveBeenCalledOnce(); proxy.destroy();
  });
  it('rejects malformed raw errors returned by the messaging channel', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: { data: {}, errors: [{ message: 'bad', path: {} }] } });
    const proxy = new AnilistClientProxy(metadata() as never, new EventBus());
    await expect(proxy.queryRaw('query { Viewer { id } }')).rejects.toThrow('Invalid GraphQL'); proxy.destroy();
  });
  it('redacts API error events and refuses requests after destruction', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('Transport variables: { notes: "private" }'));
    const bus = new EventBus(); const errors = vi.fn(); bus.on(EVENT_TYPES.API_ERROR, errors);
    const proxy = new AnilistClientProxy(metadata() as never, bus);
    await expect(proxy.query('query { Viewer { id } }')).rejects.toThrow('Transport');
    expect(errors.mock.calls[0][0].error.message).not.toContain('private'); proxy.destroy();
    await expect(proxy.query('query { Viewer { id } }')).rejects.toThrow('destroyed');
  });
});

const selectedViewer = () => ({ Viewer: { id: 7, name: 'Viewer', avatar: { medium: 'https://s4.anilist.co/a.png' },
  options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat: 'POINT_100', rowOrder: 'title' } } });

describe('AnilistClientProxy Viewer boundary', () => {
  const auth = () => ({ ensureInitialized: async () => {}, getSessionId: () => 's1', getUserCache: () => null, hasToken: () => true });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([
    { id: 2147483648 }, { name: '' }, { avatar: {} }, { avatar: { medium: 1 } },
    { options: {} }, { options: { titleLanguage: 'UNKNOWN' } },
    { mediaListOptions: {} }, { mediaListOptions: { scoreFormat: 'UNKNOWN', rowOrder: 'title' } },
    { mediaListOptions: { scoreFormat: 'POINT_100', rowOrder: {} } },
  ])('rejects malformed selected Viewer fields and retries a valid response: %j', async patch => {
    const proxy = new AnilistClientProxy(auth() as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    const valid = selectedViewer(); const query = vi.spyOn(proxy, 'query').mockResolvedValueOnce({ Viewer: { ...valid.Viewer, ...patch } }).mockResolvedValue(valid);
    await expect(proxy.getCurrentUser()).rejects.toThrow('Invalid Viewer response');
    expect(await proxy.getCurrentUser()).toEqual(valid.Viewer); expect(query).toHaveBeenCalledTimes(2); proxy.destroy();
  });
  it('does not cache transport objects by reference', async () => {
    const proxy = new AnilistClientProxy(auth() as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    const response = selectedViewer(); const query = vi.spyOn(proxy, 'query').mockResolvedValue(response);
    const first = await proxy.getCurrentUser(); first.avatar.medium = 'caller-change'; response.Viewer.avatar.medium = 'transport-change';
    expect((await proxy.getCurrentUser()).avatar.medium).toBe('https://s4.anilist.co/a.png'); expect(query).toHaveBeenCalledOnce(); proxy.destroy();
  });
  it('rejects a stale context even when no auth event was delivered', async () => {
    let session = 's1'; const metadata = { ...auth(), getSessionId: () => session };
    const proxy = new AnilistClientProxy(metadata as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    vi.spyOn(proxy, 'query').mockImplementationOnce(async () => { session = 's2'; return selectedViewer(); });
    await expect(proxy.getCurrentUser()).rejects.toThrow('Viewer context changed'); proxy.destroy();
  });
  it('rejects a different known owner and accepts a provisional OAuth owner', async () => {
    let owner: { userId: number; userName: string } | null = { userId: 8, userName: 'Other' };
    const metadata = { ...auth(), getUserCache: () => owner };
    const proxy = new AnilistClientProxy(metadata as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    const query = vi.spyOn(proxy, 'query').mockResolvedValue(selectedViewer());
    await expect(proxy.getCurrentUser()).rejects.toThrow('Invalid Viewer response'); owner = null;
    expect((await proxy.getCurrentUser()).id).toBe(7); expect(query).toHaveBeenCalledTimes(2); proxy.destroy();
  });
  it('refreshes cache after a silent session switch or explicit queue reset', async () => {
    let session = 's1'; const metadata = { ...auth(), getSessionId: () => session };
    const proxy = new AnilistClientProxy(metadata as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    const second = selectedViewer(); second.Viewer.name = 'New session';
    const query = vi.spyOn(proxy, 'query').mockResolvedValueOnce(selectedViewer()).mockResolvedValue(second);
    expect((await proxy.getCurrentUser()).name).toBe('Viewer'); session = 's2';
    expect((await proxy.getCurrentUser()).name).toBe('New session'); proxy.clearQueue(); await proxy.getCurrentUser();
    expect(query).toHaveBeenCalledTimes(3); proxy.destroy();
  });
  it('rejects a deferred Viewer after destroy and does not refill its cache', async () => {
    const proxy = new AnilistClientProxy(auth() as unknown as import('@core/auth/AuthStateClient').AuthStateClient, new EventBus());
    let finish!: (value: unknown) => void; vi.spyOn(proxy, 'query').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = proxy.getCurrentUser(); const rejection = expect(pending).rejects.toThrow('Viewer context changed');
    await Promise.resolve(); proxy.destroy(); finish(selectedViewer()); await rejection;
    await expect(proxy.getCurrentUser()).rejects.toThrow('destroyed');
  });

});
