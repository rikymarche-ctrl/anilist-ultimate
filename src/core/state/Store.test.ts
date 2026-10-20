import { describe, it, expect, vi } from 'vitest';
import { Store, combineStores, createMemoizedSelector } from './Store';
import { logger } from '@core/logger';

interface TestState {
  count: number;
  name: string;
  nested: { value: number };
}

const initial = (): TestState => ({ count: 0, name: 'a', nested: { value: 1 } });

describe('Store', () => {
  it('reports every batched selector change against the state before the entire batch', () => {
    const store = new Store(initial());
    const count = vi.fn();
    store.subscribeToSelector(state => state.count, count);
    store.batch(() => {
      store.setState({ count: 1 });
      store.setState({ name: 'last unrelated change' });
    });
    expect(count).toHaveBeenCalledExactlyOnceWith(1, 0);
  });

  it('notifies once after nested batches and preserves partial changes when an updater throws', () => {
    const store = new Store(initial());
    const listener = vi.fn();
    store.subscribe(listener);
    expect(() => store.batch(() => {
      store.setState({ count: 1 });
      store.batch(() => store.setState({ count: 2 }));
      throw new Error('interrupted batch');
    })).toThrow('interrupted batch');
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ count: 2 }), expect.objectContaining({ count: 0 }));
    store.setState({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('defers replacement subscriptions created during a rerender until the next event', () => {
    const store = new Store(initial());
    const replacement = vi.fn();
    let unsubscribe = () => {};
    unsubscribe = store.subscribe(() => {
      unsubscribe();
      store.subscribe(replacement);
    });
    store.setState({ count: 1 });
    expect(replacement).not.toHaveBeenCalled();
    store.setState({ count: 2 });
    expect(replacement).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ count: 2 }), expect.objectContaining({ count: 1 }));
  });

  it('does not deliver events to listeners removed by an earlier callback', () => {
    const store = new Store(initial());
    const removed = vi.fn();
    let unsubscribe = () => {};
    store.subscribe(() => unsubscribe());
    unsubscribe = store.subscribe(removed);
    store.setState({ count: 1 });
    expect(removed).not.toHaveBeenCalled();
  });

  it('delivers nested writes in the same order to every subscriber', () => {
    const store = new Store(initial());
    const seen: string[] = [];
    store.subscribe(state => {
      seen.push(`A${state.count}`);
      if (state.count === 1) store.setState({ count: 2 });
    });
    store.subscribe(state => { seen.push(`B${state.count}`); });
    store.setState({ count: 1 });
    expect(seen).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('contains async listener and selector rejection without skipping other subscribers', async () => {
    const store = new Store(initial());
    const reported = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      store.subscribe(async () => { throw new Error('async listener'); });
      store.subscribeToSelector(state => state.count, async () => { throw new Error('async selector'); });
      const listener = vi.fn();
      store.subscribe(listener);
      store.setState({ count: 1 });
      await Promise.resolve();
      expect(reported).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { reported.mockRestore(); }
  });

  it('distinguishes different selector keys even when their values are both undefined', () => {
    const store = new Store({ left: true });
    const listener = vi.fn();
    store.subscribeToSelector(state => state.left ? { first: undefined } : { second: undefined }, listener);
    store.setState({ left: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('returns the initial state', () => {
    const store = new Store(initial());
    expect(store.getState()).toEqual(initial());
  });

  it('merges a partial update and notifies with prev state', () => {
    const store = new Store(initial());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 5 });

    expect(store.getState().count).toBe(5);
    expect(store.getState().name).toBe('a'); // untouched
    expect(listener).toHaveBeenCalledTimes(1);
    const [next, prev] = listener.mock.calls[0];
    expect(next.count).toBe(5);
    expect(prev.count).toBe(0);
  });

  it('supports a functional updater', () => {
    const store = new Store(initial());
    store.setState((s) => ({ count: s.count + 10 }));
    expect(store.getState().count).toBe(10);
  });

  it('does not mutate the previous state object (immutability)', () => {
    const store = new Store(initial());
    const before = store.getState();
    store.setState({ count: 99 });
    expect(before.count).toBe(0); // old reference untouched
    expect(store.getState()).not.toBe(before);
  });

  it('unsubscribes correctly', () => {
    const store = new Store(initial());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ count: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribeToSelector only fires when the selected slice changes', () => {
    const store = new Store(initial());
    const listener = vi.fn();
    store.subscribeToSelector((s) => s.count, listener);

    store.setState({ name: 'b' }); // count unchanged
    expect(listener).not.toHaveBeenCalled();

    store.setState({ count: 7 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(7, 0);
  });

  it('reset() restores the ORIGINAL initial state, not the previous state', () => {
    // Regression guard: reset() used to restore prevState instead of initialState.
    const store = new Store(initial());
    store.setState({ count: 42, name: 'changed' });
    store.setState({ count: 100 });

    store.reset();

    expect(store.getState()).toEqual(initial());
  });

  it('reset(partial) merges over the initial state', () => {
    const store = new Store(initial());
    store.setState({ count: 42 });
    store.reset({ count: 5 });
    expect(store.getState()).toEqual({ ...initial(), count: 5 });
  });

  it('batch() collapses multiple updates into a single notification', () => {
    const store = new Store(initial());
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => {
      store.setState({ count: 1 });
      store.setState({ count: 2 });
      store.setState({ name: 'z' });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().count).toBe(2);
    expect(store.getState().name).toBe('z');
  });

  it('keeps notifying other listeners when one throws', () => {
    const store = new Store(initial());
    const throwing = () => {
      throw new Error('boom');
    };
    const ok = vi.fn();
    store.subscribe(throwing);
    store.subscribe(ok);

    expect(() => store.setState({ count: 1 })).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});

describe('createMemoizedSelector', () => {
  it('retains an equal result even when undefined is a valid input state', () => {
    const selector = createMemoizedSelector<undefined, { value: number }>(() => ({ value: 1 }), (a, b) => a.value === b.value);
    const first = selector(undefined);
    expect(selector(undefined)).toBe(first);
  });
  it('returns the computed value', () => {
    const compute = vi.fn((s: TestState) => s.count * 2);
    const selector = createMemoizedSelector(compute);

    expect(selector({ ...initial(), count: 3 })).toBe(6);
    expect(selector({ ...initial(), count: 3 })).toBe(6);
    expect(selector({ ...initial(), count: 4 })).toBe(8);
  });
});

describe('combineStores', () => {
  it('releases earlier sources when a later subscription fails', () => {
    const first = new Store({ count: 0 });
    const broken = { getState: () => ({ value: 1 }), subscribe: () => { throw new Error('subscribe failed'); } };
    expect(() => combineStores({ first, broken })).toThrow('subscribe failed');
    expect(first.getDebugInfo().listenerCount).toBe(0);
  });

  it('continues teardown after a source cleanup throws', () => {
    const reported = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const broken = { getState: () => ({ value: 1 }), subscribe: () => () => { throw new Error('cleanup failed'); } };
      const ordinary = new Store({ count: 1 });
      const combined = combineStores({ broken, ordinary });
      expect(() => combined.destroy()).not.toThrow();
      expect(ordinary.getDebugInfo().listenerCount).toBe(0);
      expect(reported).toHaveBeenCalledTimes(1);
    } finally { reported.mockRestore(); }
  });
  it('uses only own sources, including an own __proto__ key', () => {
    const inherited = new Store({ secret: 'not a source' });
    const own = new Store({ count: 1 });
    const sources = Object.create({ inherited }) as Record<string, typeof own>;
    Object.defineProperty(sources, '__proto__', { value: own, enumerable: true });
    const combined = combineStores(sources);
    expect(Object.keys(combined.getState())).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(combined.getState())).toBe(Object.prototype);
    expect(combined.getState()['__proto__']).toEqual({ count: 1 });
    expect(inherited.getDebugInfo().listenerCount).toBe(0);
    own.setState({ count: 2 });
    expect(combined.getState()['__proto__']).toEqual({ count: 2 });
  });

  it('captures the actual sources instead of rereading a mutable source dictionary', () => {
    const original = new Store({ count: 0 });
    const replacement = new Store({ count: 100 });
    const sources = { original };
    const combined = combineStores(sources);
    sources.original = replacement;
    original.setState({ count: 1 });
    expect(combined.getState().original.count).toBe(1);
    expect(replacement.getDebugInfo().listenerCount).toBe(0);
  });

  it('uses the dispatched state so nested updates retain their event order', () => {
    const source = new Store({ count: 0 });
    source.subscribe(state => { if (state.count === 1) source.setState({ count: 2 }); });
    const combined = combineStores({ source });
    const observed: number[] = [];
    combined.subscribe(state => { observed.push(state.source.count); });
    source.setState({ count: 1 });
    expect(observed).toEqual([1, 2]);
  });

  it('releases upstream and downstream listeners on repeated destroy', () => {
    const first = new Store({ count: 0 });
    const second = new Store({ name: 'a' });
    const combined = combineStores({ first, second });
    const listener = vi.fn();
    combined.subscribe(listener);
    expect(first.getDebugInfo().listenerCount).toBe(1);
    combined.destroy();
    combined.destroy();
    expect(first.getDebugInfo().listenerCount).toBe(0);
    expect(second.getDebugInfo().listenerCount).toBe(0);
    expect(combined.getDebugInfo().listenerCount).toBe(0);
    first.setState({ count: 10 });
    expect(combined.getState().first.count).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
