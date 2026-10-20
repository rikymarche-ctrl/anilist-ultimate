import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from './CacheService';
import type { Disposable } from 'tsyringe';

function fixture() {
  const data = new Map<string, unknown>();
  const storage = { get: vi.fn(async (key: string) => structuredClone(data.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); return true; }),
    remove: vi.fn(async (key: string) => { data.delete(key); return true; }) };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const cache = new CacheService<string, number>(storage as never, logger as never, { namespace: 'test' });
  return { cache, storage, data, logger };
}
describe('cache persistence concurrency', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps edits made while an older persistence is pending dirty', async () => {
    const { cache, storage, data } = fixture();
    await cache.set('first', 1);
    let finish!: () => void;
    const set = storage.set.getMockImplementation()!;
    storage.set.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { finish = resolve; }); return set(key, value); });
    const saving = cache.persist();
    await Promise.resolve();
    await cache.set('second', 2);
    finish(); await saving;
    await cache.flush();
    expect(data.get('cache_test')).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'second', value: 2 })]));
  });
  it('does not restore data after a clear during startup', async () => {
    const { cache, storage } = fixture();
    let finish!: (value: object | null) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reading = cache.get('old');
    await cache.clear();
    finish([{ key: 'old', value: 1, timestamp: Date.now() }]);
    expect(await reading).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
  it('serializes removal after an in-flight write, preventing cache resurrection', async () => {
    const { cache, storage, data } = fixture();
    await cache.set('old', 1);
    let finish!: () => void;
    const set = storage.set.getMockImplementation()!;
    storage.set.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { finish = resolve; }); return set(key, value); });
    const saving = cache.persist();
    await Promise.resolve();
    const clearing = cache.clear();
    finish(); await Promise.all([saving, clearing]);
    expect(data.has('cache_test')).toBe(false);
  });
  it('propagates a failed flush and allows a later flush to retry', async () => {
    const { cache, storage } = fixture();
    await cache.set('one', 1);
    storage.set.mockResolvedValueOnce(false);
    await expect(cache.flush()).rejects.toThrow('Cache persistence failed');
    await cache.flush();
    expect(storage.set).toHaveBeenCalledTimes(2);
  });
});

describe('cache disposal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const dispose = (cache: CacheService<string, number>) => (cache as CacheService<string, number> & Disposable).dispose();

  it('releases memory and the debounce without deleting or flushing persistent data', async () => {
    const { cache, storage, data } = fixture();
    data.set('cache_test', [{ key: 'saved', value: 1, timestamp: Date.now() }]);
    await cache.set('pending', 2);
    expect(vi.getTimerCount()).toBe(1);
    dispose(cache); dispose(cache);
    expect(cache.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(data.get('cache_test')).toEqual([{ key: 'saved', value: 1, timestamp: Date.now() }]);
  });

  it('makes a captured debounce callback inert after disposal', async () => {
    const { cache, storage } = fixture();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    await cache.set('pending', 2);
    const callback = timerSpy.mock.calls[0][0] as () => void;
    dispose(cache); callback();
    await Promise.resolve();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('does not let a replaced debounce write more recent edits early', async () => {
    const { cache, storage } = fixture();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    await cache.set('first', 1);
    const superseded = timerSpy.mock.calls[0][0] as () => void;
    await cache.set('second', 2);
    superseded();
    await Promise.resolve();
    expect(storage.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.set).toHaveBeenCalledTimes(1);
    dispose(cache);
  });

  it('does not restore or report an obsolete storage read failure after disposal', async () => {
    const { cache, storage, logger } = fixture();
    let fail!: (error: Error) => void;
    storage.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const reading = cache.get('old');
    const result = expect(reading).rejects.toThrow('disposed');
    dispose(cache); fail(new Error('retired read failure'));
    await result;
    expect(logger.error).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it.each(['get', 'set', 'delete', 'has'] as const)('retires a pending %s when the storage read completes', async method => {
    const { cache, storage } = fixture();
    let finish!: (value: object | null) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const command = method === 'set' ? cache.set('old', 2) : cache[method]('old');
    const result = expect(command).rejects.toThrow('disposed');
    dispose(cache);
    finish([{ key: 'old', value: 1, timestamp: Date.now() }]);
    await result;
    expect(cache.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('rejects all new commands after disposal', async () => {
    const { cache, storage } = fixture();
    dispose(cache);
    for (const command of [cache.get('x'), cache.set('x', 1), cache.has('x'), cache.delete('x'), cache.clear(), cache.flush(), cache.persist()]) {
      await expect(command).rejects.toThrow('disposed');
    }
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it.each(['persist', 'clear'] as const)('retires queued %s while permitting an already-started write to finish', async method => {
    const { cache, storage, data } = fixture();
    await cache.set('saved', 1);
    let finish!: () => void;
    const set = storage.set.getMockImplementation()!;
    storage.set.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { finish = resolve; }); return set(key, value); });
    const saving = cache.persist();
    await Promise.resolve();
    await cache.set('pending', 2);
    const queued = cache[method]();
    const result = expect(queued).rejects.toThrow('disposed');
    dispose(cache);
    finish(); await saving; await result;
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(data.get('cache_test')).toEqual([{ key: 'saved', value: 1, timestamp: Date.now() }]);
    expect(cache.size()).toBe(0);
  });
});
