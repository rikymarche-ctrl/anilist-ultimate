import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomListClient } from './CustomListClient';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const response = (name = 'Friends') => ({
  success: true,
  data: { [name]: [{ id: 7, name: 'Synthetic user', avatar: '' }] },
});
const retire = (client: CustomListClient) => client.dispose();

describe('custom list client resource lifetime and pending requests', () => {
  const clients: CustomListClient[] = [];
  let runtimeListeners: Set<Parameters<typeof chrome.runtime.onMessage.addListener>[0]>;
  let storageListeners: Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>;
  let previousStorageSignal: typeof chrome.storage.onChanged;
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeListeners = new Set();
    storageListeners = new Set();
    previousStorageSignal = chrome.storage.onChanged;
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((listener) => {
      runtimeListeners.add(listener);
    });
    vi.mocked(chrome.runtime.onMessage.removeListener).mockImplementation((listener) => {
      runtimeListeners.delete(listener);
    });
    chrome.storage.onChanged = {
      addListener: vi.fn((listener) => {
        storageListeners.add(listener);
      }),
      removeListener: vi.fn((listener) => {
        storageListeners.delete(listener);
      }),
    } as unknown as typeof chrome.storage.onChanged;
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(response() as never);
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    chrome.storage.onChanged = previousStorageSignal;
    vi.restoreAllMocks();
  });
  function setup(bus = new EventBus()) {
    let session = 'one';
    const auth = { getSessionId: () => session, ensureInitialized: vi.fn(async () => {}) };
    const client = new CustomListClient(auth as never, bus);
    clients.push(client);
    return {
      client,
      auth,
      bus,
      switchSession: (value = 'two') => {
        session = value;
      },
    };
  }
  const runtimeChange = (keys = ['custom_lists_account_1']) => {
    for (const listener of runtimeListeners)
      listener({ type: MSG.LOCAL_CHANGED, keys }, {}, vi.fn());
  };
  const storageChange = (
    key = 'custom_lists_account_1',
    area: chrome.storage.AreaName = 'local'
  ) => {
    for (const listener of storageListeners) listener({ [key]: { newValue: {} } }, area);
  };

  it('disposes each exact browser listener and the account subscription once and clears its snapshot', async () => {
    const { client, bus } = setup();
    await client.init();
    const runtime = [...runtimeListeners][0];
    const storage = [...storageListeners][0];
    expect(client.getList('Friends')).toHaveLength(1);
    retire(client);
    retire(client);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledExactlyOnceWith(runtime);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(storage);
    expect(runtimeListeners.size).toBe(0);
    expect(storageListeners.size).toBe(0);
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    expect(client.getLists()).toEqual({});
  });

  it('rejects retirement while initialization is pending and never sends the delayed RPC', async () => {
    const { client, auth } = setup();
    const gate = deferred<void>();
    auth.ensureInitialized.mockReturnValueOnce(gate.promise);
    const pending = client.init();
    const result = expect(pending).rejects.toThrow('disposed');
    retire(client);
    gate.resolve();
    await result;
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(client.getLists()).toEqual({});
  });

  it('rejects a late read response without publishing the retired snapshot or emitting an update', async () => {
    const { client, bus } = setup();
    const emitted = vi.spyOn(bus, 'emit');
    const gate = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => gate.promise) as never);
    const pending = client.init();
    const result = expect(pending).rejects.toThrow('disposed');
    await flush();
    retire(client);
    gate.resolve(response());
    await result;
    expect(client.getLists()).toEqual({});
    expect(emitted).not.toHaveBeenCalled();
  });

  it('allows an accepted background write to finish while rejecting its retired acknowledgement', async () => {
    const first = setup();
    const accepted = deferred<unknown>();
    let durable = false;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((async () => {
      const reply = await accepted.promise;
      durable = true;
      return reply;
    }) as never);
    const writing = first.client.createList('Accepted');
    const outcome = expect(writing).rejects.toThrow('disposed');
    await flush();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', sessionId: 'one' })
    );
    retire(first.client);
    const replacement = setup(first.bus);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response('Replacement') as never);
    await replacement.client.init();
    accepted.resolve(response('Accepted'));
    await outcome;
    expect(durable).toBe(true);
    expect(first.client.getLists()).toEqual({});
    expect(replacement.client.getLists()).toEqual(response('Replacement').data);
  });

  it('rejects new operations after disposal without initializing authentication or sending writes', async () => {
    const { client, auth } = setup();
    retire(client);
    await expect(client.init()).rejects.toThrow('disposed');
    await expect(client.createList('Later')).rejects.toThrow('disposed');
    await expect(client.deleteList('Later')).rejects.toThrow('disposed');
    await expect(
      client.toggleUserInList('Later', { id: 7, name: 'User', avatar: '' }, true)
    ).rejects.toThrow('disposed');
    expect(auth.ensureInitialized).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('refreshes only the replacement for browser/account signals and guards copied retired callbacks', async () => {
    const first = setup();
    const oldRuntime = [...runtimeListeners][0];
    const oldStorage = [...storageListeners][0];
    retire(first.client);
    const replacement = setup(first.bus);
    oldRuntime({ type: MSG.LOCAL_CHANGED, keys: ['custom_lists_account_1'] }, {}, vi.fn());
    oldStorage({ custom_lists_account_local: { newValue: {} } }, 'local');
    await flush();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    runtimeChange();
    await flush();
    storageChange('custom_lists_account_local');
    await flush();
    first.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 2,
      timestamp: new Date(),
    });
    await flush();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
    expect(first.auth.ensureInitialized).not.toHaveBeenCalled();
    expect(first.client.getLists()).toEqual({});
    expect(replacement.client.getLists()).toEqual(response().data);
  });

  it('does not refresh on unrelated runtime keys or nonlocal storage areas', async () => {
    setup();
    runtimeChange(['calendar_preferences']);
    storageChange('custom_lists_account_1', 'sync');
    storageChange('calendar_preferences');
    await flush();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('preserves the account guard when the session changes during authentication initialization', async () => {
    const f = setup();
    const gate = deferred<void>();
    f.auth.ensureInitialized.mockReturnValueOnce(gate.promise);
    const pending = f.client.createList('Stale');
    const result = expect(pending).rejects.toThrow('account changed');
    f.switchSession();
    gate.resolve();
    await result;
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('clears the previous account and rejects its late response after a real account event', async () => {
    const f = setup();
    await f.client.init();
    const gate = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => gate.promise) as never);
    const pending = f.client.init();
    const result = expect(pending).rejects.toThrow('account changed');
    await flush();
    const current = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => current.promise) as never);
    f.switchSession();
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 2,
      timestamp: new Date(),
    });
    expect(f.client.getLists()).toEqual({});
    await flush();
    gate.resolve(response('Old'));
    await result;
    expect(f.client.getLists()).toEqual({});
    current.resolve(response('Current'));
    await flush();
    expect(f.client.getLists()).toEqual(response('Current').data);
  });

  it('preserves confirmed data on transport/validation failure and permits retry', async () => {
    const { client } = setup();
    await client.init();
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('Unavailable'));
    await expect(client.createList('Failed')).rejects.toThrow('Unavailable');
    expect(client.getLists()).toEqual(response().data);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      data: { Friends: [{}] },
    } as never);
    await expect(client.init()).rejects.toThrow('Invalid custom lists');
    expect(client.getLists()).toEqual(response().data);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response('Retry') as never);
    await client.init();
    expect(client.getLists()).toEqual(response('Retry').data);
  });

  it('contains signal refresh failures and retries on the next signal', async () => {
    const { client } = setup();
    await client.init();
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(
      new Error('Signal refresh unavailable')
    );
    runtimeChange();
    await flush();
    expect(client.getLists()).toEqual(response().data);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response('Retry signal') as never);
    storageChange();
    await flush();
    expect(client.getLists()).toEqual(response('Retry signal').data);
  });

  it('applies a write acknowledgement that arrives after a signal refresh was dispatched', async () => {
    const { client } = setup();
    await client.init();
    const changed = vi.fn();
    const unsubscribe = client.onChange(changed);
    const ack = deferred<unknown>();
    const refreshed = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage)
      .mockImplementationOnce((() => ack.promise) as never)
      .mockImplementationOnce((() => refreshed.promise) as never);
    const writing = client.createList('Accepted');
    await flush();
    storageChange();
    await flush();
    ack.resolve(response('Accepted'));
    await writing;
    expect(client.getLists()).toEqual(response('Accepted').data);
    expect(changed).toHaveBeenCalledTimes(1);
    refreshed.resolve(response('Accepted'));
    await flush();
    expect(client.getLists()).toEqual(response('Accepted').data);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response('Later') as never);
    await client.init();
    expect(client.getLists()).toEqual(response('Later').data);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer snapshot when an earlier read completes last', async () => {
    const { client } = setup();
    const gate = deferred<unknown>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => gate.promise) as never);
    const earlier = client.init();
    await flush();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response('Latest') as never);
    await client.init();
    gate.resolve(response('Earlier'));
    await earlier;
    expect(client.getLists()).toEqual(response('Latest').data);
  });
});
