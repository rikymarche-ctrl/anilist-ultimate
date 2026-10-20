import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStateClient } from './AuthStateClient';
import { AuthService } from './AuthService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';

describe('public authentication state client', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(chrome.runtime.sendMessage).mockReset(); chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never; });
  it('initializes without reading credentials or exposing a credential received by mistake', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ authenticated: true, userId: 1, userName: 'One', sessionId: 'one', token: 'secret' } as never);
    const client = new AuthStateClient(new EventBus());
    await Promise.all([client.initialize(), client.initialize()]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: MSG.AUTH_STATUS });
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(client.getToken()).toBeNull();
    expect(client.getUserCache()).toEqual({ userId: 1, userName: 'One' });
  });
  it('ignores a late status response from an earlier account refresh', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise(resolve => { complete = resolve; })) as never)
      .mockResolvedValueOnce({ authenticated: true, userId: 2, sessionId: 'two' } as never);
    const client = new AuthStateClient(new EventBus());
    const earlier = client.refresh();
    await client.refresh();
    complete({ authenticated: true, userId: 1, sessionId: 'one' });
    await earlier;
    expect(client.getSessionId()).toBe('two');
    expect(client.getUserCache()?.userId).toBe(2);
  });
  it.each(['authenticated', 'other-owner', 'anonymous', 'malformed', 'transport', 'disposed'] as const)(
    'keeps real login confirmation pending until the newest listener refresh settles: %s', async outcome => {
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: false, sessionId: 'anonymous' });
      const bus = new EventBus(); const client = new AuthStateClient(bus); await client.initialize();
      let finishEarlier!: (value: unknown) => void;
      let finishLatest!: (value: unknown) => void;
      let rejectLatest!: (error: Error) => void;
      vi.mocked(chrome.runtime.sendMessage)
        .mockResolvedValueOnce({ success: true, userId: 2, userName: 'Current' })
        .mockImplementationOnce((() => new Promise(resolve => { finishEarlier = resolve; })) as never)
        .mockImplementationOnce((() => new Promise((resolve, reject) => { finishLatest = resolve; rejectLatest = reject; })) as never);
      const logger = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
      const auth = new AuthService(logger as never, bus, {} as never, client as never);
      let settled = false;
      const login = auth.login().then(() => { settled = true; return 'success'; }, () => { settled = true; return 'failure'; });
      for (let spin = 0; spin < 8; spin++) await Promise.resolve();
      expect(finishEarlier).toBeTypeOf('function');
      const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
      listener({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
      finishEarlier({ authenticated: true, userId: 2, userName: 'Current', sessionId: 'confirmed' });
      for (let spin = 0; spin < 12; spin++) await Promise.resolve();
      expect(settled).toBe(false);
      expect(client.hasToken()).toBe(false);
      if (outcome === 'transport') rejectLatest(new Error('Disconnected'));
      else {
        if (outcome === 'disposed') client.dispose();
        finishLatest(outcome === 'anonymous' ? { authenticated: false, sessionId: 'new-anonymous' }
          : outcome === 'malformed' ? { authenticated: true, userId: '2', sessionId: 'invalid' }
          : { authenticated: true, userId: outcome === 'other-owner' ? 3 : 2, userName: 'Current', sessionId: 'confirmed' });
      }
      expect(await login).toBe(outcome === 'authenticated' ? 'success' : 'failure');
      expect(client.hasToken()).toBe(outcome === 'authenticated' || outcome === 'other-owner');
      if (outcome === 'other-owner') expect(client.getUserCache()?.userId).toBe(3);
      expect(logger.success).toHaveBeenCalledTimes(outcome === 'authenticated' ? 1 : 0);
      client.dispose();
    });
  it('clears old public metadata when an account change cannot be refreshed', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 1, sessionId: 'one' } as never);
    const bus = new EventBus();
    const changed = vi.fn(); bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, changed);
    const client = new AuthStateClient(bus);
    await client.initialize();
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('Disconnected'));
    const listeners = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    const listener = listeners[listeners.length - 1][0];
    listener({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(client.hasToken()).toBe(false);
    expect(client.getUserCache()).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ isAuthenticated: false }));
  });

  it('retires exact browser hooks once and clears public session metadata without emitting an account change', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ authenticated: true, userId: 1, sessionId: 'one' } as never);
    const bus = new EventBus(); const client = new AuthStateClient(bus); await client.initialize();
    const emit = vi.spyOn(bus, 'emit');
    const runtime = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    const storage = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    client.dispose(); client.dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledExactlyOnceWith(runtime);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(storage);
    expect(client.getSessionId()).toBeUndefined(); expect(client.hasToken()).toBe(false);
    expect(client.getToken()).toBeNull(); expect(client.getUserCache()).toBeNull(); expect(emit).not.toHaveBeenCalled();
    await expect(client.initialize()).rejects.toThrow('disposed'); await expect(client.refresh()).rejects.toThrow('disposed');
  });

  it('rejects a deferred initialization after disposal without publishing metadata or signals', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise(resolve => { finish = resolve; })) as never);
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    const pending = client.initialize(); const result = expect(pending).rejects.toThrow('disposed');
    client.dispose(); finish({ authenticated: true, userId: 1, sessionId: 'one' }); await result;
    expect(client.hasToken()).toBe(false); expect(client.getSessionId()).toBeUndefined(); expect(emit).not.toHaveBeenCalled();
  });

  it('makes copied retired callbacks inert while replacement clients still refresh', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ authenticated: false, sessionId: 'one' } as never);
    const first = new AuthStateClient(new EventBus());
    const old = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    first.dispose(); const replacement = new AuthStateClient(new EventBus());
    old({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    const current = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[1][0];
    current({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(replacement.getSessionId()).toBe('one'); expect(first.getSessionId()).toBeUndefined();
  });

  it('contains a failed listener refresh after retirement without emitting invalidation', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise((_resolve, reject) => { fail = reject; })) as never);
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    const callback = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    callback({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
    client.dispose(); fail(new Error('Runtime disconnected'));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(emit).not.toHaveBeenCalled(); expect(client.getSessionId()).toBeUndefined();
  });
  it.each([
    { authenticated: true, userId: '7', sessionId: 'valid' },
    { authenticated: true, userId: 0, sessionId: 'valid' },
    { authenticated: true, userId: -1, sessionId: 'valid' },
    { authenticated: true, userId: 1.5, sessionId: 'valid' },
    { authenticated: true, userId: 2147483648, sessionId: 'valid' },
    { authenticated: true, userId: 1 },
    { authenticated: true, userId: 1, sessionId: 17 },
    { authenticated: true, userId: 1, sessionId: ' ' },
    { authenticated: true, userId: 1, sessionId: 'valid', userName: {} },
    { authenticated: 'true', userId: 1, sessionId: 'valid' },
  ])('rejects malformed public metadata without announcing an authenticated owner: %j', async response => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response);
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    await expect(client.initialize()).rejects.toThrow('authentication');
    expect(client.hasToken()).toBe(false); expect(client.getUserCache()).toBeNull();
    expect(client.getSessionId()).toBeUndefined();
    expect(emit).not.toHaveBeenCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: true }));
    client.dispose();
  });

  it('invalidates a failed direct refresh once and recovers through initialization', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 1, sessionId: 'one' })
      .mockResolvedValueOnce({ authenticated: true, userId: '2', sessionId: 'two' })
      .mockResolvedValueOnce({ authenticated: true, userId: 2, userName: '', sessionId: ' two ' });
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    await client.initialize(); emit.mockClear();
    await expect(client.refresh()).rejects.toThrow('authentication');
    expect(client.hasToken()).toBe(false); expect(client.getUserCache()).toBeNull(); expect(client.getSessionId()).toBeUndefined();
    expect(emit).toHaveBeenCalledExactlyOnceWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false }));
    await client.initialize();
    expect(client.getUserCache()).toEqual({ userId: 2, userName: '' }); expect(client.getSessionId()).toBe(' two ');
    client.dispose();
  });

  it('contains a malformed listener refresh and publishes a single invalidation', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 1, sessionId: 'one' })
      .mockResolvedValueOnce({ authenticated: true, userId: 2, sessionId: {} });
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    await client.initialize(); emit.mockClear();
    const runtime = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.slice(-1)[0][0];
    runtime({ type: MSG.LOCAL_CHANGED, authChanged: true }, {}, vi.fn());
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(client.hasToken()).toBe(false); expect(client.getUserCache()).toBeNull();
    expect(emit).toHaveBeenCalledExactlyOnceWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false }));
    client.dispose();
  });

  it.each(['malformed', 'rejection'] as const)('ignores an earlier %s refresh after a newer session succeeds', async failure => {
    let finish!: (value: unknown) => void; let reject!: (error: Error) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise((resolve, fail) => { finish = resolve; reject = fail; })) as never)
      .mockResolvedValueOnce({ authenticated: true, userId: 2, sessionId: 'two' });
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    const earlier = client.refresh(); await client.refresh(); emit.mockClear();
    if (failure === 'malformed') finish({ authenticated: true, userId: {}, sessionId: 17 });
    else reject(new Error('Disconnected'));
    await earlier;
    expect(client.getUserCache()).toEqual({ userId: 2, userName: '' }); expect(client.getSessionId()).toBe('two');
    expect(emit).not.toHaveBeenCalled(); client.dispose();
  });

  it('projects anonymous metadata without retaining an owner or credential', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: false, userId: 1, userName: 'Old', token: 'private', sessionId: 'anon' });
    const client = new AuthStateClient(new EventBus()); await client.initialize();
    expect(client.hasToken()).toBe(false); expect(client.getUserCache()).toBeNull(); expect(client.getToken()).toBeNull();
    expect(client.getSessionId()).toBe('anon'); client.dispose();
  });

  it('clears earlier metadata when a current direct refresh transport fails', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 1, sessionId: 'one' })
      .mockRejectedValueOnce(new Error('Disconnected'));
    const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit'); const client = new AuthStateClient(bus);
    await client.initialize(); emit.mockClear();
    await expect(client.refresh()).rejects.toThrow('Disconnected');
    expect(client.getUserCache()).toBeNull(); expect(client.getSessionId()).toBeUndefined();
    expect(emit).toHaveBeenCalledExactlyOnceWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false }));
    client.dispose();
  });

  it.each(['malformed', 'synchronous-transport'] as const)('keeps a reentrant initialization alive when an older initialization fails: %s', async failure => {
    let finish!: (value: unknown) => void;
    if (failure === 'malformed') vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ authenticated: true, userId: 'bad', sessionId: 'old' });
    else vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => { throw new Error('Extension context invalidated'); });
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise(resolve => { finish = resolve; })) as never);
    const bus = new EventBus(); const client = new AuthStateClient(bus);
    let replacement: Promise<void> | undefined;
    bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, event => { if (!event?.isAuthenticated) replacement = client.initialize(); });
    await expect(client.initialize()).rejects.toThrow(failure === 'malformed' ? 'authentication' : 'Extension context invalidated');
    const same = client.initialize();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2); expect(same).toBe(replacement);
    finish({ authenticated: true, userId: 2, sessionId: 'two' }); await replacement; await same;
    expect(client.getUserCache()).toEqual({ userId: 2, userName: '' }); client.dispose();
  });

});
