import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphQLBatcher } from './GraphQLBatcher';

/**
 * Minimal IApiClient stub: only queryRaw is exercised by the batcher.
 */
function makeApi(response: { data?: Record<string, any>; errors?: any[] }) {
  const queryRaw = vi.fn(async (_q: string) => response);
  return { queryRaw } as any;
}

describe('GraphQLBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('escapes string variables when inlining (no GraphQL injection)', async () => {
    const api = makeApi({ data: { a0: { notes: 'ok' } } });
    const batcher = new GraphQLBatcher(api);

    // Value starts with "$" (the old code passed these through RAW) and contains a
    // double quote that would break out of the string literal if not escaped.
    const malicious = '$x" or true';
    const p = batcher.query(
      'query ($userName: String) { MediaList(userName: $userName) { notes } }',
      { userName: malicious }
    );

    await vi.advanceTimersByTimeAsync(60);
    await p;

    const combined = api.queryRaw.mock.calls[0][0] as string;
    // Quote is escaped, value is fully quoted, "$" is treated as data not a variable ref.
    expect(combined).toContain('"$x\\" or true"');
    expect(combined).not.toContain('userName: $x'); // no raw passthrough / break-out
  });

  it('inlines numbers without quotes', async () => {
    const api = makeApi({ data: { a0: { notes: 'ok' } } });
    const batcher = new GraphQLBatcher(api);

    const p = batcher.query('query ($mediaId: Int) { MediaList(mediaId: $mediaId) { notes } }', {
      mediaId: 123,
    });
    await vi.advanceTimersByTimeAsync(60);
    await p;

    const combined = api.queryRaw.mock.calls[0][0] as string;
    expect(combined).toContain('mediaId: 123');
    expect(combined).not.toContain('mediaId: "123"');
  });

  it('batches multiple queries into one request and distributes results by alias', async () => {
    const api = makeApi({ data: { a0: { id: 1 }, a1: { id: 2 } } });
    const batcher = new GraphQLBatcher(api);

    const p1 = batcher.query('query { A { id } }');
    const p2 = batcher.query('query { B { id } }');

    await vi.advanceTimersByTimeAsync(60);

    expect(api.queryRaw).toHaveBeenCalledTimes(1);
    expect(await p1).toEqual({ id: 1 });
    expect(await p2).toEqual({ id: 2 });
  });

  it('rejects only the alias that returned a partial error', async () => {
    const api = makeApi({
      data: { a0: { id: 1 }, a1: null },
      errors: [{ message: 'Not found', path: ['a1'] }],
    });
    const batcher = new GraphQLBatcher(api);

    const ok = batcher.query('query { A { id } }');
    const bad = batcher.query('query { B { id } }');
    // Attach the rejection handler BEFORE the flush fires to avoid an
    // unhandled-rejection warning during timer advancement.
    const badAssertion = expect(bad).rejects.toThrow(/Not found/);

    await vi.advanceTimersByTimeAsync(60);

    expect(await ok).toEqual({ id: 1 });
    await badAssertion;
  });

  it('rejects every pending promise when the whole batch throws', async () => {
    const api = {
      queryRaw: vi.fn(async () => {
        throw new Error('network down');
      }),
    } as any;
    const batcher = new GraphQLBatcher(api);

    const p1 = batcher.query('query { A { id } }');
    const p2 = batcher.query('query { B { id } }');
    // Attach rejection handlers before the flush to avoid unhandled-rejection noise.
    const a1 = expect(p1).rejects.toThrow(/network down/);
    const a2 = expect(p2).rejects.toThrow(/network down/);

    await vi.advanceTimersByTimeAsync(60);

    await a1;
    await a2;
  });
});
