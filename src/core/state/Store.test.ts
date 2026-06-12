import { describe, it, expect, vi } from 'vitest';
import { Store, createMemoizedSelector } from './Store';

interface TestState {
  count: number;
  name: string;
  nested: { value: number };
}

const initial = (): TestState => ({ count: 0, name: 'a', nested: { value: 1 } });

describe('Store', () => {
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
  it('returns the computed value', () => {
    const compute = vi.fn((s: TestState) => s.count * 2);
    const selector = createMemoizedSelector(compute);

    expect(selector({ ...initial(), count: 3 })).toBe(6);
    expect(selector({ ...initial(), count: 3 })).toBe(6);
    expect(selector({ ...initial(), count: 4 })).toBe(8);
  });
});
