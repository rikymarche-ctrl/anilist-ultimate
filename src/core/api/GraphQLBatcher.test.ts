import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphQLBatcher } from './GraphQLBatcher';
import { Kind, parse, getLocation } from 'graphql';
import type { IApiClient, ApiContext } from '@core/interfaces/IApiClient';

interface BatchApiFake {
  queryRaw: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
  mutate?: () => Promise<unknown>;
  getContext?: () => ApiContext;
  ensureContext?: () => Promise<ApiContext>;
}
function batcherWithFake(api: BatchApiFake) {
  // Domain responses deliberately include malformed wire data. Keep them unknown
  // until GraphQLBatcher validates them, rather than pretending they are valid T.
  return new GraphQLBatcher(api as unknown as IApiClient);
}

/**
 * Minimal IApiClient stub: only queryRaw is exercised by the batcher.
 */
function makeApi(response: unknown) {
  const queryRaw = vi.fn(async (_q: string, _variables?: Record<string, unknown>) => response);
  return { queryRaw };
}

function missingActivityApi(missing: number[], locations = true) {
  const deleted = new Set(missing);
  const queryRaw = vi.fn(async (query: string, variables: Record<string, unknown> = {}) => {
    const doc = parse(query); const op = doc.definitions[0];
    if (op.kind !== Kind.OPERATION_DEFINITION) throw new Error('Invalid fixture query');
    const fields = op.selectionSet.selections.map(field => {
      if (field.kind !== Kind.FIELD || !field.alias) throw new Error('Invalid fixture field');
      const id = field.arguments?.find(arg => arg.name.value === 'id')?.value;
      if (id?.kind !== Kind.VARIABLE) throw new Error('Invalid fixture variable');
      return { alias: field.alias.value, id: Number(variables[id.name.value]), location: getLocation(field.loc!.source, field.loc!.start) };
    });
    const missingFields = fields.filter(field => deleted.has(field.id));
    if (missingFields.length) return { data: Object.fromEntries(fields.map(field => [field.alias, null])),
      errors: missingFields.map(field => ({ message: 'Not Found.', status: 404, ...(locations ? { locations: [field.location] } : {}) })) };
    return { data: Object.fromEntries(fields.map(field => [field.alias, { id: field.id }])) };
  });
  return { queryRaw };
}

const activityQuery = 'query($id:Int!) { Activity(id:$id) { __typename } }';

describe('GraphQLBatcher', () => {
  it('rejects a response when the session changes during batch execution', async () => {
    let session = 'one'; let finish!: (value: unknown) => void;
    const api = { getContext: () => ({ sessionId: session, userId: 1 }), ensureContext: async () => ({ sessionId: session, userId: 1 }), queryRaw: () => new Promise(resolve => { finish = resolve; }) };
    const batcher = batcherWithFake(api); const waiting = batcher.query('query { Viewer { id } }');
    const rejected = expect(waiting).rejects.toThrow('account changed'); await vi.advanceTimersByTimeAsync(60);
    session = 'two'; finish({ data: { a0: { id: 1 } } }); await rejected; batcher.destroy();
  });
  it('rejects queued and initializing requests on destroy and never sends them later', async () => {
    let initialized!: () => void; const api = { ensureContext: () => new Promise<ApiContext>(resolve => { initialized = () => resolve({ sessionId: 'one', userId: 1 }); }), queryRaw: vi.fn() };
    const batcher = batcherWithFake(api); const initializing = batcher.query('query { Viewer { id } }');
    const rejected = expect(initializing).rejects.toThrow('destroyed'); await vi.advanceTimersByTimeAsync(60);
    const queued = batcher.query('query { Viewer { name } }'); const queuedRejected = expect(queued).rejects.toThrow('destroyed');
    batcher.destroy(); await rejected; await queuedRejected; initialized(); await vi.advanceTimersByTimeAsync(60);
    expect(api.queryRaw).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await expect(batcher.query('query { Viewer { id } }')).rejects.toThrow('destroyed');
  });
  it('contains malformed error paths and does not accept inherited alias results', async () => {
    const api = makeApi({ data: { a0: {} }, errors: [{ message: 'bad', path: 'a0' }] }); const batcher = batcherWithFake(api);
    const malformed = batcher.query('query { Viewer { id } }'); const rejected = expect(malformed).rejects.toThrow('Invalid GraphQL');
    await vi.advanceTimersByTimeAsync(60); await rejected;
    api.queryRaw.mockResolvedValueOnce({ data: Object.create({ a0: { id: 1 } }) });
    const inherited = batcher.query('query { Viewer { id } }'); const inheritedRejected = expect(inherited).rejects.toThrow('Missing result');
    await vi.advanceTimersByTimeAsync(60); await inheritedRejected; batcher.destroy();
  });
  it('sends mutations through the mutation channel and rejects old account batches', async () => {
    const api = { queryRaw: vi.fn(), mutate: vi.fn(async () => ({ a0: { id: 1 } })),
      getContext: () => ({ sessionId: 'one', userId: 1 }), ensureContext: vi.fn(async () => ({ sessionId: 'one', userId: 1 })) };
    const batcher = batcherWithFake(api);
    const saved = batcher.mutate('mutation($mediaId:Int) { SaveMediaListEntry(mediaId:$mediaId) { id } }', { mediaId: 1 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await saved).toEqual({ id: 1 });
    expect(api.mutate).toHaveBeenCalledOnce();
    expect(api.queryRaw).not.toHaveBeenCalled();
    const pending = batcher.query('query { Viewer { id } }');
    const rejected = expect(pending).rejects.toThrow('account changed');
    api.ensureContext.mockResolvedValueOnce({ sessionId: 'two', userId: 2 });
    await vi.advanceTimersByTimeAsync(60);
    await rejected;
    expect(api.queryRaw).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps string values separate from query text (no GraphQL injection)', async () => {
    const api = makeApi({ data: { a0: { notes: 'ok' } } });
    const batcher = batcherWithFake(api);

    const malicious = '$x" or true';
    const p = batcher.query(
      'query ($userName: String) { MediaList(userName: $userName) { notes } }',
      { userName: malicious }
    );

    await vi.advanceTimersByTimeAsync(60);
    await p;

    const [combined, variables] = api.queryRaw.mock.calls[0];
    expect(combined).not.toContain(malicious);
    expect(variables).toEqual({ a0_userName: malicious });
    expect(() => parse(combined)).not.toThrow();
  });

  it('preserves numeric variable types', async () => {
    const api = makeApi({ data: { a0: { notes: 'ok' } } });
    const batcher = batcherWithFake(api);

    const p = batcher.query('query ($mediaId: Int) { MediaList(mediaId: $mediaId) { notes } }', {
      mediaId: 123,
    });
    await vi.advanceTimersByTimeAsync(60);
    await p;

    const [combined, variables] = api.queryRaw.mock.calls[0];
    expect(combined).toContain('$a0_mediaId: Int');
    expect(variables).toEqual({ a0_mediaId: 123 });
  });

  it('batches multiple queries into one request and distributes results by alias', async () => {
    const api = makeApi({ data: { a0: { id: 1 }, a1: { id: 2 } } });
    const batcher = batcherWithFake(api);

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
    const batcher = batcherWithFake(api);

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
    };
    const batcher = batcherWithFake(api);

    const p1 = batcher.query('query { A { id } }');
    const p2 = batcher.query('query { B { id } }');
    // Attach rejection handlers before the flush to avoid unhandled-rejection noise.
    const a1 = expect(p1).rejects.toThrow(/network down/);
    const a2 = expect(p2).rejects.toThrow(/network down/);

    await vi.advanceTimersByTimeAsync(60);

    await a1;
    await a2;
  });

  it('preserves replacement tokens and variable-looking text inside string values', async () => {
    const api = makeApi({ data: { a0: { notes: 'ok' } } });
    const batcher = batcherWithFake(api);
    const value = '$& $mediaId';
    const pending = batcher.query('query ($name: String, $mediaId: Int) { MediaList(userName: $name, mediaId: $mediaId) { notes } }', { name: value, mediaId: 1 });
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    const [query, variables] = api.queryRaw.mock.calls[0];
    expect(variables?.a0_name).toBe(value);
    expect(query).not.toContain(value);
  });

  it('rejects global GraphQL errors instead of resolving a missing result as null', async () => {
    const api = makeApi({ data: null, errors: [{ message: 'Unauthenticated' }] });
    const batcher = batcherWithFake(api);
    const pending = expect(batcher.query('query { Viewer { id } }')).rejects.toMatchObject({
      name: 'GraphQLBatchGlobalError', message: expect.stringContaining('Unauthenticated'),
    });
    await vi.advanceTimersByTimeAsync(60);
    await pending;
  });

  it('rejects missing aliases but accepts explicit null results', async () => {
    const api = makeApi({ data: { a0: null } });
    const batcher = batcherWithFake(api);
    const nullResult = batcher.query('query { A { id } }');
    const missing = expect(batcher.query('query { B { id } }')).rejects.toThrow(/missing/i);
    await vi.advanceTimersByTimeAsync(60);
    expect(await nullResult).toBeNull();
    await missing;
  });

  it('treats unscoped-error nulls as a batch failure while preserving non-null siblings', async () => {
    const api = makeApi({ data: { a0: { id: 1 }, a1: null }, errors: [{ message: 'Not Found.', locations: [{ line: 1, column: 7 }] }] });
    const batcher = batcherWithFake(api);
    const valid = batcher.query('query { A { id } }');
    const invalid = expect(batcher.query('query { B { id } }')).rejects.toMatchObject({ name: 'GraphQLBatchGlobalError' });
    await vi.advanceTimersByTimeAsync(60);
    expect(await valid).toEqual({ id: 1 }); await invalid; batcher.destroy();
  });

  it('namespaces fragments and variables while retaining enums and defaults', async () => {
    const api = makeApi({ data: { a0: { id: 1 }, a1: { id: 2 } } });
    const batcher = batcherWithFake(api);
    const query = 'query Named($type: MediaType = ANIME) { Media(type: $type) { ...Details } } fragment Details on Media { id }';
    const first = batcher.query(query);
    const second = batcher.query(query, { type: 'MANGA' });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([first, second]);
    const [combined, variables] = api.queryRaw.mock.calls[0];
    const parsed = parse(combined);
    expect(parsed.definitions.filter(node => node.kind === Kind.FRAGMENT_DEFINITION).map(node => node.name.value)).toEqual(['a0_Details', 'a1_Details']);
    expect(combined).toContain('$a0_type: MediaType = ANIME');
    expect(variables).toEqual({ a1_type: 'MANGA' });
  });

  it('isolates all located 404s and retries the valid siblings once as a batch', async () => {
    const api = missingActivityApi([2, 7]); const batcher = batcherWithFake(api);
    const results = Array.from({ length: 8 }, (_, i) => batcher.query(activityQuery, { id: i + 1 })
      .then(value => ({ value }), error => ({ error })));
    await vi.advanceTimersByTimeAsync(60);
    const settled = await Promise.all(results);
    expect(api.queryRaw).toHaveBeenCalledTimes(2);
    expect(api.queryRaw.mock.calls.map(([, vars]) => Object.keys(vars!).length)).toEqual([8, 6]);
    expect(Object.values(api.queryRaw.mock.calls[1][1]!)).not.toContain(2);
    expect(Object.values(api.queryRaw.mock.calls[1][1]!)).not.toContain(7);
    expect(settled[1]).toMatchObject({ error: { name: 'GraphQLResourceNotFoundError', statusCode: 404 } });
    expect(settled[6]).toMatchObject({ error: { name: 'GraphQLResourceNotFoundError' } });
    expect(settled[0]).toEqual({ value: { id: 1 } }); expect(settled[7]).toEqual({ value: { id: 8 } }); batcher.destroy();
  });

  it('uses bounded binary isolation when a 404 has no path or location', async () => {
    const api = missingActivityApi([8], false); const batcher = batcherWithFake(api);
    const results = Array.from({ length: 16 }, (_, i) => batcher.query(activityQuery, { id: i + 1 })
      .then(value => ({ value }), error => ({ error })));
    await vi.advanceTimersByTimeAsync(60); const settled = await Promise.all(results);
    expect(api.queryRaw).toHaveBeenCalledTimes(9);
    expect(settled[7]).toMatchObject({ error: { name: 'GraphQLResourceNotFoundError' } });
    expect(settled.filter(value => 'value' in value)).toHaveLength(15); batcher.destroy();
  });

  it('does not retry or classify a nested-field 404 as a missing root activity', async () => {
    const api = { queryRaw: vi.fn(async (query: string) => {
      const doc = parse(query); const op = doc.definitions[0];
      if (op.kind !== Kind.OPERATION_DEFINITION) throw new Error('Invalid query');
      const field = op.selectionSet.selections[0];
      if (field.kind !== Kind.FIELD) throw new Error('Invalid field');
      const child = field.selectionSet!.selections[0];
      return { data: { a0: null }, errors: [{ message: 'Not Found.', status: 404, locations: [getLocation(child.loc!.source, child.loc!.start)] }] };
    }) };
    const batcher = batcherWithFake(api);
    const rejected = expect(batcher.query(activityQuery, { id: 1 })).rejects.toMatchObject({ name: 'GraphQLBatchGlobalError' });
    await vi.advanceTimersByTimeAsync(60); await rejected; expect(api.queryRaw).toHaveBeenCalledOnce(); batcher.destroy();
  });

  it('never dispatches a recovery after account change during the initial batch', async () => {
    let session = 'one'; const base = missingActivityApi([1]);
    const api = { ...base, getContext: () => ({ sessionId: session, userId: 1 }), ensureContext: async () => ({ sessionId: session, userId: 1 }) };
    const execute = base.queryRaw.getMockImplementation()!;
    base.queryRaw.mockImplementation(async (query, variables) => { const response = await execute(query, variables); session = 'two'; return response; });
    const batcher = batcherWithFake(api);
    const results = [1, 2].map(id => expect(batcher.query(activityQuery, { id })).rejects.toThrow('account changed'));
    await vi.advanceTimersByTimeAsync(60); await Promise.all(results); expect(api.queryRaw).toHaveBeenCalledOnce(); batcher.destroy();
  });

  it.each([false, true])('does not mark a root missing when its errors include another failure (reverse=%s)', async reverse => {
    const errors = [{ message: 'Forbidden', status: 403, path: ['a0'] }, { message: 'Not Found.', status: 404, path: ['a0'] }];
    const api = makeApi({ data: { a0: null }, errors: reverse ? errors.reverse() : errors });
    const batcher = batcherWithFake(api);
    const result = batcher.query(activityQuery, { id: 1 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(60);
    expect(await result).toMatchObject({ name: 'Error' }); expect(api.queryRaw).toHaveBeenCalledOnce(); batcher.destroy();
  });

  it('settles a recovery on destroy and discards its late response', async () => {
    const api = missingActivityApi([1]); const execute = api.queryRaw.getMockImplementation()!;
    let release!: () => void;
    api.queryRaw.mockImplementation(async (query, variables) => {
      if (Object.values(variables ?? {}).includes(1)) return execute(query, variables);
      await new Promise<void>(resolve => { release = resolve; }); return execute(query, variables);
    });
    const batcher = batcherWithFake(api);
    const missing = expect(batcher.query(activityQuery, { id: 1 })).rejects.toMatchObject({ name: 'GraphQLResourceNotFoundError' });
    const readable = expect(batcher.query(activityQuery, { id: 2 })).rejects.toThrow('destroyed');
    await vi.advanceTimersByTimeAsync(60); await missing; expect(api.queryRaw).toHaveBeenCalledTimes(2);
    batcher.destroy(); await readable; release(); await vi.advanceTimersByTimeAsync(60);
    expect(api.queryRaw).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
