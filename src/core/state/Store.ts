import { logger } from '@core/logger';
/**
 * @file Store.ts
 * @description Lightweight reactive state management (~175 lines, zero dependencies)
 *
 * A minimal Redux-like store with:
 *   - getState() / setState() with partial updates
 *   - subscribe() for global change listeners
 *   - subscribeToSelector() for targeted subscriptions (shallow equality check)
 *   - batch() for multiple updates with single notification
 *   - reset() for state restoration
 *
 * Utility functions:
 *   - createMemoizedSelector() - caches expensive computed values
 *   - combineStores() - merges multiple stores into a derived state
 *
 * Used by CalendarStore for managing calendar entries, preferences, and loading states.
 *
 * Fixed: Store.reset() now correctly restores initialState.
 *
 * @see docs/ARCHITECTURE.md#46-state-management
 */

type Listener<T> = (state: T, prevState: T) => void | Promise<void>;
type Selector<T, R> = (state: T) => R;
type Unsubscribe = () => void;

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<Listener<T>>();
  private prevState: T;
  private readonly initialState: T;
  private batchDepth = 0;
  private batchStart: T | null = null;
  private batchChanged = false;
  private notifying = false;
  private notifications: Array<{ state: T; previous: T }> = [];

  constructor(initialState: T) {
    this.state = { ...initialState };
    this.prevState = { ...initialState };
    this.initialState = { ...initialState };
  }

  /**
   * Get the current state (readonly)
   */
  getState(): Readonly<T> {
    return this.state;
  }

  /**
   * Update the state
   * @param partial - Partial state update or updater function
   */
  setState(partial: Partial<T> | ((state: T) => Partial<T>)): void {
    this.prevState = { ...this.state };

    const updates = typeof partial === 'function' ? partial(this.state) : partial;

    this.state = { ...this.state, ...updates };
    this.notify();
  }

  /**
   * Subscribe to state changes
   * @param listener - Callback function called on state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to specific state property changes
   * @param selector - Function to select a specific part of state
   * @param listener - Callback called when selected state changes
   * @returns Unsubscribe function
   */
  subscribeToSelector<R>(
    selector: Selector<T, R>,
    listener: (selected: R, prevSelected: R) => void | Promise<void>
  ): Unsubscribe {
    const wrappedListener: Listener<T> = (state, prevState) => {
      const newValue = selector(state);
      const prevValue = selector(prevState);

      if (!this.shallowEqual(newValue, prevValue)) {
        return listener(newValue, prevValue);
      }
    };

    return this.subscribe(wrappedListener);
  }

  /**
   * Reset state to initial or provided values
   */
  reset(newState?: Partial<T>): void {
    this.prevState = { ...this.state };
    this.state = newState ? { ...this.initialState, ...newState } : { ...this.initialState };
    this.notify();
  }

  /**
   * Batch multiple state updates into a single notification
   */
  batch(updater: () => void): void {
    const outermost = this.batchDepth === 0;
    if (outermost) {
      this.batchStart = this.state;
      this.batchChanged = false;
    }
    this.batchDepth++;

    try {
      updater();
    } finally {
      this.batchDepth--;
      if (outermost) {
        const previous = this.batchStart;
        this.batchStart = null;
        if (this.batchChanged && previous) {
          this.prevState = previous;
          this.notify();
        }
      }
    }
  }

  /**
   * Notify all listeners of state change
   */
  private notify(): void {
    if (this.batchDepth > 0) {
      this.batchChanged = true;
      return;
    }
    this.notifications.push({ state: this.state, previous: this.prevState });
    if (this.notifying) return;
    this.notifying = true;
    try {
      // Snapshot each dispatch: rerender can remove/re-add a subscription.
      // Nested writes queue their event so every listener sees changes in order.
      for (let index = 0; index < this.notifications.length; index++) {
        const change = this.notifications[index];
        for (const listener of [...this.listeners]) {
          if (!this.listeners.has(listener)) continue;
          try {
            const result = listener(change.state, change.previous);
            if (result !== undefined) void Promise.resolve(result).catch(error => logger.error('[Store] Error in listener:', error));
          } catch (error) {
            logger.error('[Store] Error in listener:', error);
          }
        }
      }
    } finally {
      this.notifications.length = 0;
      this.notifying = false;
    }
  }

  /**
   * Shallow equality check
   */
  private shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key)
      && (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
  }

  /**
   * Get debug info about the store
   */
  getDebugInfo(): {
    state: T;
    prevState: T;
    listenerCount: number;
  } {
    return {
      state: this.state,
      prevState: this.prevState,
      listenerCount: this.listeners.size,
    };
  }

  protected clearListeners(): void {
    this.listeners.clear();
  }
}

/**
 * Compute on each call and retain the previous result reference when equal.
 */
export function createMemoizedSelector<T, R>(
  selector: Selector<T, R>,
  equalityFn: (a: R, b: R) => boolean = (a, b) => a === b
): Selector<T, R> {
  let initialized = false;
  let lastResult: R;

  return (state: T): R => {
    if (initialized) {
      const currentResult = selector(state);
      if (equalityFn(currentResult, lastResult)) {
        return lastResult;
      }
      lastResult = currentResult;
      return currentResult;
    }

    lastResult = selector(state);
    initialized = true;
    return lastResult;
  };
}

/**
 * Combine multiple stores into a single derived state
 */
interface StoreSource {
  getState(): object;
  subscribe(listener: Listener<object>): Unsubscribe;
}

type CombinedState<T extends Record<string, StoreSource>> = {
  [K in keyof T]: ReturnType<T[K]['getState']>;
};

/** Owns subscriptions to the captured, own string-keyed sources. */
export class CombinedStore<T extends Record<string, StoreSource>> extends Store<CombinedState<T>> {
  private unsubscribers: Unsubscribe[] = [];

  constructor(stores: T) {
    const sources = Object.entries(stores);
    // fromEntries/spread keep __proto__ as an own data key, without changing prototypes.
    super(Object.fromEntries(sources.map(([key, source]) => [key, source.getState()])) as CombinedState<T>);
    try {
      for (const [key, source] of sources) {
        this.unsubscribers.push(source.subscribe(state => {
          // Use the dispatched snapshot, not getState(), which may already hold a nested write.
          this.setState({ [key]: state } as Partial<CombinedState<T>>);
        }));
      }
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  /** Stop following sources and release existing listeners; preserves the last snapshot. */
  destroy(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try { unsubscribe(); } catch (error) { logger.error('[CombinedStore] Error in unsubscribe:', error); }
    }
    this.clearListeners();
  }
}

export function combineStores<T extends Record<string, StoreSource>>(stores: T): CombinedStore<T> {
  return new CombinedStore(stores);
}
