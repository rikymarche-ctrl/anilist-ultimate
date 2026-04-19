/**
 * Lightweight Reactive State Management
 * Custom implementation - no external dependencies
 */

type Listener<T> = (state: T, prevState: T) => void;
type Selector<T, R> = (state: T) => R;
type Unsubscribe = () => void;

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<Listener<T>>();
  private prevState: T;

  constructor(initialState: T) {
    this.state = { ...initialState };
    this.prevState = { ...initialState };
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
    listener: (selected: R, prevSelected: R) => void
  ): Unsubscribe {
    const wrappedListener: Listener<T> = (state, prevState) => {
      const newValue = selector(state);
      const prevValue = selector(prevState);

      if (!this.shallowEqual(newValue, prevValue)) {
        listener(newValue, prevValue);
      }
    };

    return this.subscribe(wrappedListener);
  }

  /**
   * Reset state to initial or provided values
   */
  reset(newState?: Partial<T>): void {
    this.prevState = { ...this.state };
    this.state = newState ? { ...this.state, ...newState } : { ...this.prevState };
    this.notify();
  }

  /**
   * Batch multiple state updates into a single notification
   */
  batch(updater: () => void): void {
    const originalNotify = this.notify;
    let shouldNotify = false;

    // Temporarily override notify
    this.notify = () => {
      shouldNotify = true;
    };

    try {
      updater();
    } finally {
      this.notify = originalNotify;
      if (shouldNotify) {
        this.notify();
      }
    }
  }

  /**
   * Notify all listeners of state change
   */
  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.state, this.prevState);
      } catch (error) {
        console.error('[Store] Error in listener:', error);
      }
    });
  }

  /**
   * Shallow equality check
   */
  private shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => a[key] === b[key]);
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
}

/**
 * Create a memoized selector for expensive computations
 */
export function createMemoizedSelector<T, R>(
  selector: Selector<T, R>,
  equalityFn: (a: R, b: R) => boolean = (a, b) => a === b
): Selector<T, R> {
  let lastState: T | undefined;
  let lastResult: R;

  return (state: T): R => {
    if (lastState !== undefined) {
      const currentResult = selector(state);
      if (equalityFn(currentResult, lastResult)) {
        return lastResult;
      }
      lastResult = currentResult;
      lastState = state;
      return currentResult;
    }

    lastResult = selector(state);
    lastState = state;
    return lastResult;
  };
}

/**
 * Combine multiple stores into a single derived state
 */
export function combineStores<T extends Record<string, Store<any>>>(
  stores: T
): Store<Record<string, any>> {
  const getInitialState = (): Record<string, any> => {
    const state: Record<string, any> = {};
    for (const key in stores) {
      state[key] = stores[key].getState();
    }
    return state;
  };

  const combinedStore = new Store(getInitialState());

  // Subscribe to all stores and update combined state
  for (const key in stores) {
    stores[key].subscribe(() => {
      combinedStore.setState({
        [key]: stores[key].getState(),
      });
    });
  }

  return combinedStore;
}
