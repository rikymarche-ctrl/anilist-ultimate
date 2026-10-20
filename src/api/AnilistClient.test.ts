import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the graphql-request client so no real network happens.
interface TransportRequestFake {
  query: string;
  variables: Record<string, unknown>;
  signal: AbortSignal;
}
const mockRawRequest = vi.fn<(request: TransportRequestFake) => Promise<unknown>>();
vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn().mockImplementation(function () { return { rawRequest: mockRawRequest }; }),
}));

import { AnilistClient } from './AnilistClient';
import { AnilistClientProxy } from './AnilistClientProxy';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import { EventBus } from '@core/events/EventBus';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import type { IErrorHandler } from '@core/interfaces/IErrorHandler';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';

// Keep mock inspection typed; only the constructor boundary expands the narrow
// dependency fakes to the complete production contracts.
function clientWithDeps(deps: ReturnType<typeof makeDeps>): AnilistClient {
  return new AnilistClient(deps.errorHandler as unknown as IErrorHandler,
    deps.authTokenService as unknown as AuthTokenService,
    deps.eventBus as unknown as IEventBus);
}

interface RequestExecutionProbe {
  executeRequest(item: {
    query: string; variables: Record<string, unknown>; isRaw: boolean; epoch: number;
  }): Promise<unknown>;
}

function makeDeps(token: string | null = 'tok') {
  return {
    errorHandler: { handle: vi.fn<IErrorHandler['handle']>() } satisfies Pick<IErrorHandler, 'handle'>,
    authTokenService: { getToken: () => token, getSessionId: () => 's1', getUserCache: (): ReturnType<AuthTokenService['getUserCache']> => null, ensureInitialized: vi.fn(async () => {}) } satisfies Pick<AuthTokenService, 'getToken' | 'getSessionId' | 'getUserCache' | 'ensureInitialized'>,
    eventBus: { on: vi.fn<(_event: string, callback: () => void) => EventSubscription>().mockReturnValue({ unsubscribe: vi.fn() }), emit: vi.fn() },
  };
}

const makeClient = (token: string | null = 'tok') => {
  const d = makeDeps(token);
  return clientWithDeps(d);
};

describe('AnilistClient', () => {
  beforeEach(() => {
    mockRawRequest.mockReset();
    // The client guards against an invalidated extension context via chrome.runtime.id.
    chrome.runtime.id = 'test-extension-id';
  });
  afterEach(() => { vi.useRealTimers(); });

  it('settles requests even when transport errors have malformed fields', async () => {
    vi.useFakeTimers(); const client = makeClient();
    mockRawRequest.mockRejectedValue({ message: 5, response: { status: 500, errors: { message: 'bad' } } });
    const waiting = client.query('query { x }'); const rejected = expect(waiting).rejects.toMatchObject({ statusCode: 500 });
    await vi.advanceTimersByTimeAsync(10000); await rejected; client.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([500, 429])('does not retry a scheduled one-attempt query on HTTP %i', async status => {
    vi.useFakeTimers(); const client = makeClient();
    mockRawRequest.mockRejectedValue({ response: { status } });
    const waiting = client.queryOnce('query { x }', {}, true); const rejected = expect(waiting).rejects.toMatchObject({ statusCode: status });
    await vi.advanceTimersByTimeAsync(180000); await rejected;
    expect(mockRawRequest).toHaveBeenCalledTimes(1); client.destroy(); expect(vi.getTimerCount()).toBe(0);
  });

  it('snapshots variables before callers edit them and keeps snapshots during retries', async () => {
    vi.useFakeTimers(); const client = makeClient(); const variables = { input: { notes: 'original' } };
    mockRawRequest.mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ data: { x: 1 } });
    const waiting = client.query('query { x }', variables); variables.input.notes = 'changed';
    await vi.advanceTimersByTimeAsync(5000); await waiting;
    expect(mockRawRequest.mock.calls.map(([request]) => request.variables)).toEqual([{ input: { notes: 'original' } }, { input: { notes: 'original' } }]); client.destroy();
  });

  it('rejects malformed raw response errors and can recover on the next request', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: {}, errors: [{ message: 5 }] });
    const waiting = client.queryRaw('query { x }'); const rejected = expect(waiting).rejects.toThrow('Invalid GraphQL');
    await vi.advanceTimersByTimeAsync(10000); await rejected;
    mockRawRequest.mockResolvedValue({ data: { x: 1 } }); const next = client.query('query { x }'); await vi.advanceTimersByTimeAsync(1000);
    expect(await next).toEqual({ x: 1 }); client.destroy();
  });

  it('unsubscribes and rejects new work after destroy', async () => {
    vi.useFakeTimers(); const deps = makeDeps(); const unsubscribe = vi.fn(); deps.eventBus.on.mockReturnValue({ unsubscribe });
    const client = clientWithDeps(deps); client.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce(); await expect(client.query('query { x }')).rejects.toThrow('destroyed');
    await expect(client.queryRaw('query { x }')).rejects.toThrow('destroyed'); expect(mockRawRequest).not.toHaveBeenCalled();
  });

  it('resolves the data payload on a successful query', async () => {
    mockRawRequest.mockResolvedValue({ data: { Viewer: { id: 7 } } });
    const result = await makeClient().query<{ Viewer: { id: number } }>('query { Viewer { id } }');
    expect(result).toEqual({ Viewer: { id: 7 } });
  });

  it('shares identical concurrent reads from multiple tabs, giving each an independent result', async () => {
    vi.useFakeTimers(); const client = makeClient(); let finish!: (value: unknown) => void;
    mockRawRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const waiting = Array.from({ length: 8 }, (_, index) => client.query<{ Media: { progress: number } }>(
      'query($id: Int!, $type: String) { Media(id: $id) { id } }',
      index % 2 ? { type: 'ANIME', id: 7 } : { id: 7, type: 'ANIME' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockRawRequest).toHaveBeenCalledTimes(1); expect(client.getQueueStatus().queueLength).toBe(0);
    finish({ data: { Media: { progress: 3 } } });
    const results = await Promise.all(waiting); results[0].Media.progress = 99;
    expect(results.slice(1).every(result => result.Media.progress === 3)).toBe(true); client.destroy();
  });

  it('never combines mutations and separates reads accepted after a mutation', async () => {
    vi.useFakeTimers(); const client = makeClient();
    mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query { Viewer { id } }';
    const waiting = [client.query(query), client.mutate('mutation { x }'), client.mutate('mutation { x }'), client.query(query)];
    await vi.advanceTimersByTimeAsync(5000); await Promise.all(waiting);
    expect(mockRawRequest).toHaveBeenCalledTimes(4); client.destroy();
  });

  it('shares one background request between six tab proxies and survives one tab closing', async () => {
    vi.useFakeTimers(); const deps = makeDeps();
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 's1',
      getUserCache: () => ({ userId: 7, userName: 'Viewer' }), hasToken: () => true };
    deps.authTokenService.getUserCache = metadata.getUserCache;
    const client = clientWithDeps(deps);
    const router = createBackgroundMessageHandler(Promise.resolve(), () => ({
      getStatus: async () => ({ authenticated: true, sessionId: 's1', userId: 7 }),
    }) as never, () => ({}) as never, () => client);
    let senderTabId = 0;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: unknown) => new Promise(resolve => {
      router(message, { id: chrome.runtime.id, url: 'https://anilist.co/home', tab: { id: ++senderTabId } as chrome.tabs.Tab },
        response => resolve(structuredClone(response)));
    }) as never);
    let finish!: (value: unknown) => void;
    mockRawRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const tabs = Array.from({ length: 6 }, () => new AnilistClientProxy(metadata as never, new EventBus()));
    try {
      const waiting = tabs.map(tab => tab.query<{ Viewer: { id: number } }>('query { Viewer { id } }'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(senderTabId).toBe(6); expect(mockRawRequest).toHaveBeenCalledTimes(1);
      const closed = expect(waiting[0]).rejects.toThrow('queue cleared'); tabs[0].destroy(); await closed;
      finish({ data: { Viewer: { id: 7 } } });
      expect(await Promise.all(waiting.slice(1))).toEqual(Array.from({ length: 5 }, () => ({ Viewer: { id: 7 } })));
    } finally { tabs.forEach(tab => tab.destroy()); client.destroy(); vi.mocked(chrome.runtime.sendMessage).mockReset(); }
  });

  it('separates different media and sessions, and rejects every shared reader immediately on clear', async () => {
    vi.useFakeTimers(); const deps = makeDeps(); let session = 's1';
    deps.authTokenService.getSessionId = () => session;
    const client = clientWithDeps(deps); mockRawRequest.mockReturnValue(new Promise(() => {}));
    const query = 'query($id: Int!) { Media(id: $id) { id } }';
    const first = client.query(query, { id: 1 }); const shared = client.query(query, { id: 1 });
    const other = client.query(query, { id: 2 }); session = 's2'; const next = client.query(query, { id: 1 });
    const rejected = [first, shared, other, next].map(request => expect(request).rejects.toThrow('queue cleared'));
    expect(client.getQueueStatus().queueLength).toBe(2);
    client.clearQueue(); await Promise.all(rejected); client.destroy();
  });

  it('does not cache a settled read and keeps raw and strict reads separate', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { x: 1 } });
    const first = client.query('query { x }'); await vi.advanceTimersByTimeAsync(0); await first;
    const waiting = [client.query('query { x }'), client.queryRaw('query { x }')];
    await vi.advanceTimersByTimeAsync(3000);
    expect(await Promise.all(waiting)).toEqual([{ x: 1 }, { data: { x: 1 } }]);
    expect(mockRawRequest).toHaveBeenCalledTimes(3); client.destroy();
  });

  it('mutate() funnels through the same path and resolves data', async () => {
    mockRawRequest.mockResolvedValue({ data: { ok: true } });
    expect(await makeClient().mutate('mutation { x }')).toEqual({ ok: true });
  });

  it('keeps a null data payload instead of exposing response metadata', async () => {
    mockRawRequest.mockResolvedValue({ data: null, status: 200 });
    expect(await makeClient().query('query { x }')).toBeNull();
  });

  it('does not return the raw envelope when data is undefined', async () => {
    mockRawRequest.mockResolvedValue({ data: undefined, status: 200 });
    expect(await makeClient().query('query { x }')).toBeUndefined();
  });

  it('preserves a field named data inside the query payload', async () => {
    const payload = { data: { value: 7 }, Viewer: { id: 1 } };
    mockRawRequest.mockResolvedValue({ data: payload, status: 200 });
    expect(await makeClient().query('query { data Viewer { id } }')).toEqual(payload);
  });

  it('queryRaw() returns the full response (data + errors)', async () => {
    mockRawRequest.mockResolvedValue({ data: { a: 1 }, errors: [{ message: 'partial' }] });
    const raw = await makeClient().queryRaw('query { a }');
    expect(raw.data).toEqual({ a: 1 });
    expect(raw.errors?.[0].message).toBe('partial');
  });
  it('normalizes native transport headers before cloning shared raw responses for tab clients', async () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '89' });
    mockRawRequest.mockResolvedValue({ data: { a0: { id: 7 } }, headers, status: 200 });
    const client = makeClient();
    const [first, second] = await Promise.all([client.queryRaw('query { a0: Activity(id:7) { __typename } }'),
      client.queryRaw('query { a0: Activity(id:7) { __typename } }')]);
    expect(mockRawRequest).toHaveBeenCalledOnce();
    expect(first).toEqual({ data: { a0: { id: 7 } }, headers: { 'x-ratelimit-remaining': '89' }, status: 200 });
    expect(first).not.toBe(second); expect(first.data).not.toBe(second.data);
  });

  it('queryRaw() preserves the envelope even with missing data', async () => {
    const response = { data: undefined, errors: [{ message: 'no data' }], status: 200 };
    mockRawRequest.mockResolvedValue(response);
    expect(await makeClient().queryRaw('query { x }')).toEqual(response);
  });

  it('preserves partial results when graphql-request throws an HTTP 200 GraphQL error', async () => {
    const response = { status: 200, data: { a0: { id: 1 }, a1: null }, errors: [{ message: 'Not found', path: ['a1'] }] };
    mockRawRequest.mockRejectedValue({ response });
    const raw = await makeClient().queryRaw('query { x }');
    expect(raw).toEqual({ data: response.data, errors: response.errors });
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps normal queries strict when the same GraphQL error is returned', async () => {
    const error = { response: { status: 200, data: { x: null }, errors: [{ message: 'Not found' }] } };
    mockRawRequest.mockRejectedValue(error);
    await expect((makeClient() as unknown as RequestExecutionProbe).executeRequest({ query: 'query { x }', variables: {}, isRaw: false, epoch: 0 })).rejects.toEqual(error);
  });

  it.each([400, 404, 422])('preserves HTTP %i GraphQL envelopes for raw readers without retrying', async status => {
    const errors = [{ message: 'Not Found.', locations: [{ line: 1, column: 38 }] }];
    mockRawRequest.mockRejectedValue({ response: { status, data: { a0: null, a1: null }, errors } });
    const client = makeClient();
    try {
      expect(await client.queryRaw('query { a0:Activity(id:7) { __typename } a1:Activity(id:8) { __typename } }'))
        .toEqual({ data: { a0: null, a1: null }, errors });
      expect(mockRawRequest).toHaveBeenCalledOnce();
    } finally { client.destroy(); }
  });

  it.each([401, 403, 429, 500, 503])('keeps HTTP %i GraphQL errors on the transport failure path', async status => {
    const error = { response: { status, data: null, errors: [{ message: 'Provider error' }] } };
    mockRawRequest.mockRejectedValue(error); const client = makeClient();
    try {
      await expect((client as unknown as RequestExecutionProbe).executeRequest({ query: 'query { x }', variables: {}, isRaw: true, epoch: 0 }))
        .rejects.toMatchObject(status === 401 || status === 403 ? { statusCode: status } : error);
    } finally { client.destroy(); }
  });

  it('isAuthenticated reflects the presence of a token', () => {
    expect(makeClient('tok').isAuthenticated()).toBe(true);
    expect(makeClient(null).isAuthenticated()).toBe(false);
  });

  it('clearQueue() rejects pending queued requests so callers never hang', async () => {
    // rawRequest never settles -> the first MAX_CONCURRENT requests stay in-flight,
    // the rest pile up in the queue and must be rejected by clearQueue().
    mockRawRequest.mockReturnValue(new Promise(() => {}));
    const client = makeClient();

    const promises = Array.from({ length: 8 }, () => client.query('query { x }'));
    promises.forEach((p) => p.catch(() => {})); // the in-flight ones never settle
    const lastRejected = expect(promises[7]).rejects.toThrow(/queue cleared/i);

    client.clearQueue();

    await lastRejected;
    expect(client.getQueueStatus().queueLength).toBe(0);
  });

  it('keeps dispatching into a free slot when a queued request is slow, respecting spacing and concurrency', async () => {
    vi.useFakeTimers(); const client = makeClient();
    let finish!: (value: unknown) => void;
    mockRawRequest.mockResolvedValueOnce({ data: { id: 1 } })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ data: { id: 3 } });
    const requests = [1, 2, 3].map(id => client.query('query($id:Int!) { Media(id:$id) { id } }', { id }));
    const settled = Promise.allSettled(requests);
    try {
      await vi.advanceTimersByTimeAsync(699); expect(mockRawRequest).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(mockRawRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(699); expect(mockRawRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); expect(mockRawRequest).toHaveBeenCalledTimes(3);
      expect(client.getQueueStatus()).toMatchObject({ queueLength: 0, activeRequests: 1, isRateLimited: false });
      finish({ data: { id: 2 } }); expect((await settled).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps at most two transports active and fills a released slot without another response delay', async () => {
    vi.useFakeTimers(); const client = makeClient(); const releases: Array<(value: unknown) => void> = [];
    mockRawRequest.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      releases.push(resolve); signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    const settled = Promise.allSettled([1, 2, 3, 4].map(id => client.query('query($id:Int!) { Media(id:$id) { id } }', { id })));
    try {
      await vi.advanceTimersByTimeAsync(1500); expect(mockRawRequest).toHaveBeenCalledTimes(2);
      expect(client.getQueueStatus()).toMatchObject({ activeRequests: 2, queueLength: 2 });
      releases[0]({ data: { id: 1 } }); await vi.advanceTimersByTimeAsync(1);
      expect(mockRawRequest).toHaveBeenCalledTimes(3);
      expect(client.getQueueStatus()).toMatchObject({ activeRequests: 2, queueLength: 1 });
      await vi.advanceTimersByTimeAsync(1500); expect(mockRawRequest).toHaveBeenCalledTimes(3);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps background work inside the per-minute budget while the queue keeps moving', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const settled = Promise.allSettled(Array.from({ length: 26 }, (_, id) => client.query('query($id:Int!) { Media(id:$id) { id } }', { id: id + 1 })));
    try {
      // Background work may use 25 - 5 reserved = 20 window slots; the rest wait for the window to slide.
      await vi.advanceTimersByTimeAsync(59999); expect(mockRawRequest).toHaveBeenCalledTimes(20);
      await vi.advanceTimersByTimeAsync(51); expect(mockRawRequest).toHaveBeenCalledTimes(21);
      await vi.advanceTimersByTimeAsync(60000); expect(mockRawRequest).toHaveBeenCalledTimes(26);
      expect((await settled).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispatches priority reads ahead of queued background reads, FIFO within each class', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const settled = Promise.allSettled([
      ...[1, 2, 3].map(id => client.query(query, { id })),
      ...[8, 9].map(id => client.query(query, { id }, false, { priority: true })),
    ]);
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockRawRequest.mock.calls.map(([request]) => request.variables.id)).toEqual([1, 8, 9, 2, 3]);
      expect((await settled).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('moves a waiting background read into the priority lane when a priority caller joins it', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const settled = Promise.allSettled([
      client.query(query, { id: 1 }), client.query(query, { id: 2 }), client.query(query, { id: 3 }),
      client.query(query, { id: 3 }, false, { priority: true }),
    ]);
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockRawRequest.mock.calls.map(([request]) => request.variables.id)).toEqual([1, 3, 2]);
      expect((await settled).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the reserved budget for priority work: background requests stop short of it', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const background = Promise.allSettled(Array.from({ length: 21 }, (_, index) => client.query(query, { id: index + 1 })));
    try {
      await vi.advanceTimersByTimeAsync(13300); expect(mockRawRequest).toHaveBeenCalledTimes(20);
      const priority = Promise.allSettled([client.query(query, { id: 99 }, false, { priority: true })]);
      await vi.advanceTimersByTimeAsync(700);
      expect(mockRawRequest).toHaveBeenCalledTimes(21);
      expect(mockRawRequest.mock.calls[20][0].variables).toEqual({ id: 99 });
      await vi.advanceTimersByTimeAsync(45000);
      expect(mockRawRequest).toHaveBeenCalledTimes(21);
      expect(client.getQueueStatus().queueLength).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockRawRequest).toHaveBeenCalledTimes(22);
      expect((await priority)[0].status).toBe('fulfilled');
      expect((await background).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await background; }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('treats mutations as priority writes that jump queued background reads', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const mutation = 'mutation($id:Int!) { SaveMediaListEntry(mediaId:$id) { id } }';
    const settled = Promise.allSettled([
      client.query(query, { id: 1 }), client.query(query, { id: 2 }), client.query(query, { id: 3 }),
      client.mutate(mutation, { id: 7 }),
    ]);
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockRawRequest.mock.calls.map(([request]) => request.variables.id)).toEqual([1, 7, 2, 3]);
      expect((await settled).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { client.destroy(); await settled; }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('treats the viewer lookup as a priority read so a cold cache is not stuck behind background work', async () => {
    vi.useFakeTimers(); const client = makeClient(); mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const settled = Promise.allSettled([client.query(query, { id: 1 }), client.query(query, { id: 2 })]);
    const viewer = client.getCurrentUser().catch(() => null);
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockRawRequest.mock.calls[1][0].query).toContain('Viewer');
    } finally { client.destroy(); await settled; await viewer; }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('honours a priority flag sent by a tab proxy through the background router', async () => {
    vi.useFakeTimers(); const deps = makeDeps();
    const metadata = { ensureInitialized: async () => {}, getSessionId: () => 's1',
      getUserCache: () => ({ userId: 7, userName: 'Viewer' }), hasToken: () => true };
    deps.authTokenService.getUserCache = metadata.getUserCache;
    const client = clientWithDeps(deps);
    const router = createBackgroundMessageHandler(Promise.resolve(), () => ({
      getStatus: async () => ({ authenticated: true, sessionId: 's1', userId: 7 }),
    }) as never, () => ({}) as never, () => client);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: unknown) => new Promise(resolve => {
      router(message, { id: chrome.runtime.id, url: 'https://anilist.co/home', tab: { id: 1 } as chrome.tabs.Tab },
        response => resolve(structuredClone(response)));
    }) as never);
    mockRawRequest.mockResolvedValue({ data: { ok: true } });
    const tab = new AnilistClientProxy(metadata as never, new EventBus());
    const query = 'query($id:Int!) { Media(id:$id) { id } }';
    const background = Promise.allSettled([1, 2].map(id => client.query(query, { id })));
    try {
      const priority = Promise.allSettled([tab.query(query, { id: 9 }, false, { priority: true })]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockRawRequest.mock.calls.map(([request]) => request.variables.id)).toEqual([1, 9, 2]);
      expect((await priority)[0].status).toBe('fulfilled');
      expect((await background).every(item => item.status === 'fulfilled')).toBe(true);
    } finally { tab.destroy(); client.destroy(); await background; vi.mocked(chrome.runtime.sendMessage).mockReset(); }
  });
  it('cancels a delayed retry so clearing the queue cannot revive old requests', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockRejectedValue(new Error('Temporary failure'));
    const client = makeClient();
    const request = client.query('query { x }');
    const rejected = expect(request).rejects.toThrow('queue cleared');
    await vi.advanceTimersByTimeAsync(0);
    client.clearQueue();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts in-flight requests and ignores results after an account switch', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    mockRawRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const deps = makeDeps();
    const client = clientWithDeps(deps);
    const request = client.query('query { Viewer { id } }');
    const rejected = expect(request).rejects.toThrow('queue cleared');
    await vi.advanceTimersByTimeAsync(0);
    const signal = mockRawRequest.mock.calls[0][0].signal as AbortSignal;
    deps.authTokenService.getToken = () => 'different-account-token';
    deps.eventBus.on.mock.calls[0][1]();
    await rejected;
    expect(signal.aborted).toBe(true);
    finish({ data: { Viewer: { id: 999 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses an abortable request timeout rather than detaching the request', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    const client = makeClient();
    const request = client.query('query { x }');
    const rejected = expect(request).rejects.toThrow('queue cleared');
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockRawRequest.mock.calls[0][0].signal.aborted).toBe(true);
    client.clearQueue();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('stops repeated 429 retries at the retry budget', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockRejectedValue({ response: { status: 429 } });
    const client = makeClient();
    const request = client.query('query { x }');
    const rejected = expect(request).rejects.toMatchObject({ statusCode: 429 });
    await vi.advanceTimersByTimeAsync(4 * 60000 + 1000);
    await rejected;
    expect(mockRawRequest).toHaveBeenCalledTimes(4);
    expect(client.getQueueStatus().queueLength).toBe(0);
    client.clearQueue();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a fresh network-failure streak after a throttling pause', async () => {
    vi.useFakeTimers(); const client = makeClient();
    mockRawRequest.mockRejectedValue(new TypeError('Failed to fetch'));
    // Distinct operations: identical pending reads would share one transport request.
    const burst = [1, 2, 3].map(index => client.queryOnce(`query { burst${index} }`, {}, true).catch((error: unknown) => error));
    await vi.advanceTimersByTimeAsync(5000); await Promise.all(burst);
    expect(client.getQueueStatus().isRateLimited).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.getQueueStatus().isRateLimited).toBe(false);
    const single = client.queryOnce('query { single }', {}, true).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000); await single;
    expect(client.getQueueStatus().isRateLimited).toBe(false);
    client.destroy();
  });
  it.each([400, 404, 422])('does not spend the retry budget replaying HTTP %i', async status => {
    vi.useFakeTimers(); mockRawRequest.mockRejectedValue({ response: { status } });
    const client = makeClient();
    const rejected = expect(client.query('query { x }')).rejects.toMatchObject({ statusCode: status });
    await vi.advanceTimersByTimeAsync(180000); await rejected;
    expect(mockRawRequest).toHaveBeenCalledTimes(1); client.destroy();
  });
  it('still retries transient HTTP 500 for ordinary queries', async () => {
    vi.useFakeTimers(); mockRawRequest.mockRejectedValue({ response: { status: 500 } });
    const client = makeClient();
    const rejected = expect(client.query('query { x }')).rejects.toMatchObject({ statusCode: 500 });
    await vi.advanceTimersByTimeAsync(180000); await rejected;
    expect(mockRawRequest).toHaveBeenCalledTimes(4); client.destroy();
  });
  it('preserves the authentication status and does not retry a 401', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockRejectedValue({ response: { status: 401 } });
    const client = makeClient();
    await expect(client.mutate('mutation { x }')).rejects.toMatchObject({ statusCode: 401 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500])('does not replay a guarded Notes mutation inside the transport after HTTP %s', async status => {
    vi.useFakeTimers();
    mockRawRequest.mockRejectedValue({ response: { status } });
    const client = makeClient();
    await expect(client.mutateOnce('mutation { x }', { notes: 'Private review' })).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(125000);
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    client.clearQueue();
  });

  it('does not expose serialized private notes through transport error messages', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockRejectedValue({ response: { status: 400 }, message: 'Request failed: private-note-secret in query variables' });
    const deps = makeDeps();
    const client = clientWithDeps(deps);
    const request = client.mutate('mutation { x }');
    const rejected = expect(request).rejects.toMatchObject({ message: 'Anilist API request failed (HTTP 400)' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(deps.errorHandler.handle.mock.calls[0][0].message).not.toContain('private-note-secret');
    client.clearQueue();
  });
});

const completeViewer = () => ({ Viewer: { id: 7, name: 'Viewer', avatar: { medium: 'https://s4.anilist.co/a.png' },
  options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat: 'POINT_100', rowOrder: 'title' } } });

describe('AnilistClient Viewer boundary', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([
    { id: 2147483648 }, { name: '' }, { avatar: {} }, { avatar: { medium: 1 } },
    { options: {} }, { options: { titleLanguage: 'UNKNOWN' } },
    { mediaListOptions: {} }, { mediaListOptions: { scoreFormat: 'UNKNOWN', rowOrder: 'title' } },
    { mediaListOptions: { scoreFormat: 'POINT_100', rowOrder: {} } },
  ])('rejects malformed selected Viewer fields and retries a valid response: %j', async patch => {
    const client = makeClient(); const valid = completeViewer();
    const query = vi.spyOn(client, 'query').mockResolvedValueOnce({ Viewer: { ...valid.Viewer, ...patch } }).mockResolvedValue(valid);
    await expect(client.getCurrentUser()).rejects.toThrow('Failed to fetch user details');
    expect(await client.getCurrentUser()).toEqual(valid.Viewer); expect(query).toHaveBeenCalledTimes(2); client.destroy();
  });
  it('projects selected data and snapshots both transport and caller objects', async () => {
    const client = makeClient(); const response = completeViewer();
    const query = vi.spyOn(client, 'query').mockResolvedValue(response);
    const first = await client.getCurrentUser(); first.avatar.medium = 'caller-change'; response.Viewer.avatar.medium = 'transport-change';
    expect((await client.getCurrentUser()).avatar.medium).toBe('https://s4.anilist.co/a.png'); expect(query).toHaveBeenCalledOnce(); client.destroy();
  });
  it('rejects context changes without requiring an auth event', async () => {
    const deps = makeDeps(); let session = 's1'; deps.authTokenService.getSessionId = () => session;
    const client = clientWithDeps(deps); vi.spyOn(client, 'query').mockImplementationOnce(async () => { session = 's2'; return completeViewer(); });
    await expect(client.getCurrentUser()).rejects.toThrow('Failed to fetch user details'); client.destroy();
  });
  it('rejects a different known owner and accepts a provisional OAuth owner', async () => {
    const deps = makeDeps(); deps.authTokenService.getUserCache = () => ({ userId: 8, userName: 'Other' });
    const client = clientWithDeps(deps); const query = vi.spyOn(client, 'query').mockResolvedValue(completeViewer());
    await expect(client.getCurrentUser()).rejects.toThrow('Failed to fetch user details');
    deps.authTokenService.getUserCache = () => null;
    expect((await client.getCurrentUser()).id).toBe(7); expect(query).toHaveBeenCalledTimes(2); client.destroy();
  });
  it('invalidates a cached Viewer when the session changes silently', async () => {
    const deps = makeDeps(); let session = 's1'; deps.authTokenService.getSessionId = () => session;
    const client = clientWithDeps(deps); const second = completeViewer(); second.Viewer.name = 'New session';
    const query = vi.spyOn(client, 'query').mockResolvedValueOnce(completeViewer()).mockResolvedValue(second);
    expect((await client.getCurrentUser()).name).toBe('Viewer'); session = 's2';
    expect((await client.getCurrentUser()).name).toBe('New session'); expect(query).toHaveBeenCalledTimes(2); client.destroy();
  });
  it('rejects a deferred Viewer after destroy and does not refill its cache', async () => {
    const client = makeClient(); let finish!: (value: unknown) => void;
    vi.spyOn(client, 'query').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = client.getCurrentUser(); const rejection = expect(pending).rejects.toThrow('Failed to fetch user details');
    await Promise.resolve(); client.destroy(); finish(completeViewer()); await rejection;
    await expect(client.getCurrentUser()).rejects.toThrow('destroyed');
  });

});
