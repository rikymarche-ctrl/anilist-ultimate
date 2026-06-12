import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the graphql-request client so no real network happens.
const mockRawRequest = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn().mockImplementation(() => ({ rawRequest: mockRawRequest })),
}));

import { AnilistClient } from './AnilistClient';

function makeDeps(token: string | null = 'tok') {
  return {
    errorHandler: { handle: vi.fn() } as any,
    authTokenService: { getToken: () => token, ensureInitialized: vi.fn(async () => {}) } as any,
    eventBus: { on: vi.fn(), emit: vi.fn() } as any,
  };
}

const makeClient = (token: string | null = 'tok') => {
  const d = makeDeps(token);
  return new AnilistClient(d.errorHandler, d.authTokenService, d.eventBus);
};

describe('AnilistClient', () => {
  beforeEach(() => {
    mockRawRequest.mockReset();
    // The client guards against an invalidated extension context via chrome.runtime.id.
    (globalThis as any).chrome.runtime.id = 'test-extension-id';
  });

  it('resolves the data payload on a successful query', async () => {
    mockRawRequest.mockResolvedValue({ data: { Viewer: { id: 7 } } });
    const result = await makeClient().query<{ Viewer: { id: number } }>('query { Viewer { id } }');
    expect(result).toEqual({ Viewer: { id: 7 } });
  });

  it('mutate() funnels through the same path and resolves data', async () => {
    mockRawRequest.mockResolvedValue({ data: { ok: true } });
    expect(await makeClient().mutate('mutation { x }')).toEqual({ ok: true });
  });

  it('queryRaw() returns the full response (data + errors)', async () => {
    mockRawRequest.mockResolvedValue({ data: { a: 1 }, errors: [{ message: 'partial' }] });
    const raw = await makeClient().queryRaw('query { a }');
    expect(raw.data).toEqual({ a: 1 });
    expect(raw.errors?.[0].message).toBe('partial');
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
});
