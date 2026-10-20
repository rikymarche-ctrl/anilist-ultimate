import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthTokenService } from './AuthTokenService';
import { AuthService } from './AuthService';
import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY } from '@shared/messages';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/interfaces/ILogger';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

function fixture(initial: Record<string, unknown> = {}) {
  const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit');
  const data = { ...initial };
  const backend = {
    async get<T>(key: string): Promise<T | null> { return structuredClone(data[key] ?? null) as T | null; },
    async getMultiple<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
      return Object.fromEntries(keys.filter(key => key in data).map(key => [key, structuredClone(data[key])])) as Partial<T>;
    },
    set: vi.fn(async (key: string, value: unknown) => { data[key] = structuredClone(value); return true; }),
    setMultiple: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); return true; }),
    remove: vi.fn(async (key: string) => { delete data[key]; return true; }),
    async clear() { Object.keys(data).forEach(key => { delete data[key]; }); return true; },
    async has(key: string) { return key in data; },
    onChange: () => () => undefined,
  } satisfies IStorageService;
  const storage = Object.assign(backend, { getMultiple: vi.spyOn(backend, 'getMultiple') });
  const logger = {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(),
    group: vi.fn(), groupEnd: vi.fn(), time: vi.fn(), timeEnd: vi.fn(), enable: vi.fn(), disable: vi.fn(), isEnabled: () => false,
  } satisfies ILogger;
  const token = new AuthTokenService(logger, bus, storage);
  const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
  const listener = calls[calls.length - 1][0];
  function change(values: Record<string, unknown>) {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    Object.entries(values).forEach(([key, value]) => { changes[key] = { oldValue: data[key], newValue: value }; data[key] = structuredClone(value); });
    listener(changes, 'local');
  }
  return { token, bus: Object.assign(bus, { emit }), storage, logger, data, change, listener };
}

const owner = { userId: 7, userName: 'Friend' };
const snapshot = { [AUTH_STORAGE_KEY]: 'secret', [AUTH_USER_CACHE_KEY]: owner, [AUTH_SESSION_KEY]: 'session-a' };
describe('authentication persistence and message privacy', () => {
  beforeEach(() => { chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never; });
  it.each(['set', 'clear'] as const)('rejects obsolete conditional %s operations after an earlier queued write', async kind => {
    const f = fixture(snapshot); await f.token.initialize();
    let finish!: () => void; let entered = false;
    f.storage.setMultiple.mockImplementationOnce(async values => {
      entered = true; await new Promise<void>(resolve => { finish = resolve; }); Object.assign(f.data, values); return true;
    });
    const first = f.token.setToken('newer', { userId: 8, userName: 'Newer' });
    await vi.waitFor(() => expect(entered).toBe(true));
    let current = true;
    const old = kind === 'set' ? f.token.setToken('obsolete', owner, () => current) : f.token.clearToken(() => current);
    const rejected = expect(old).rejects.toThrow('superseded');
    current = false; finish(); await first; await rejected;
    expect(f.data[AUTH_STORAGE_KEY]).toBe('newer'); expect(f.token.getUserCache()?.userId).toBe(8);
    expect(f.storage.setMultiple).toHaveBeenCalledTimes(1); f.token.dispose();
  });
  it('never announces authentication after a failed token write', async () => {
    const { token, bus, storage } = fixture();
    storage.setMultiple.mockResolvedValueOnce(false);
    await expect(token.setToken('secret')).rejects.toThrow('storage write failed');
    expect(token.hasToken()).toBe(false);
    expect(bus.emit).not.toHaveBeenCalled();
  });
  it('writes token and user metadata together and rejects a failed batch', async () => {
    const { token, storage } = fixture();
    const user = { userId: 7, userName: 'Friend' };
    storage.setMultiple.mockResolvedValueOnce(false);
    await expect(token.setToken('secret', user)).rejects.toThrow();
    expect(token.hasToken()).toBe(false);
    await token.setToken('secret', user);
    expect(storage.setMultiple).toHaveBeenCalledWith({ [AUTH_STORAGE_KEY]: 'secret', [AUTH_USER_CACHE_KEY]: user, [AUTH_SESSION_KEY]: expect.any(String) });
  });
  it.each(['false', 'reject'])('does not report successful logout when its snapshot write fails with %s', async failure => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    if (failure === 'false') f.storage.setMultiple.mockResolvedValueOnce(false);
    else f.storage.setMultiple.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(f.token.clearToken()).rejects.toThrow();
    expect(f.token.getToken()).toBe('secret'); expect(f.token.getUserCache()).toEqual(owner);
    expect(f.token.getSessionId()).toBe('session-a'); expect(f.data).toEqual(snapshot); expect(f.bus.emit).not.toHaveBeenCalled();
  });
  it('persists logout as one coherent credential, owner and session snapshot', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    await f.token.clearToken();
    expect(f.storage.setMultiple).toHaveBeenCalledExactlyOnceWith({
      [AUTH_STORAGE_KEY]: null, [AUTH_USER_CACHE_KEY]: null, [AUTH_SESSION_KEY]: expect.any(String),
    });
    expect(f.storage.remove).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled();
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    expect(f.token.getSessionId()).not.toBe('session-a');
    expect(f.data).toEqual({ [AUTH_STORAGE_KEY]: null, [AUTH_USER_CACHE_KEY]: null, [AUTH_SESSION_KEY]: f.token.getSessionId() });
    expect(f.bus.emit).toHaveBeenLastCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false, userId: undefined }));
  });

  it('never performs trailing metadata cleanup that deletes an account committed after logout', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    let release!: () => void;
    const gate = () => new Promise<void>(resolve => { release = resolve; });
    f.storage.set.mockImplementation(async (key, value) => { f.change({ [key]: value }); return true; });
    // Batch completion may arrive after another writer has committed. Legacy
    // cleanup instead submits a separate remove, whose commit can arrive later.
    f.storage.setMultiple.mockImplementation(async values => { f.change(values); await gate(); return true; });
    f.storage.remove.mockImplementation(async key => {
      if (key === AUTH_USER_CACHE_KEY) await gate();
      const oldValue = f.data[key]; delete f.data[key];
      f.listener({ [key]: { oldValue } }, 'local'); return true;
    });
    const pending = f.token.clearToken(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const newer = { [AUTH_STORAGE_KEY]: 'new-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'new-session' };
    f.change(newer); release(); await pending;
    await f.token.refresh();
    expect(f.data).toEqual(newer); expect(f.token.getToken()).toBe('new-secret');
    expect(f.token.getUserCache()).toEqual(newer[AUTH_USER_CACHE_KEY]); expect(f.token.getSessionId()).toBe('new-session');
  });

  it('rotates an already anonymous session when Chrome omits unchanged null credentials and owner', async () => {
    const f = fixture({ [AUTH_STORAGE_KEY]: null, [AUTH_USER_CACHE_KEY]: null, [AUTH_SESSION_KEY]: 'anonymous' });
    await f.token.initialize();
    f.storage.setMultiple.mockImplementation(async values => {
      const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(f.data[key])));
      f.change(changed); return true;
    });
    await f.token.clearToken();
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    expect(f.token.getSessionId()).not.toBe('anonymous'); expect(f.token.getSessionId()).not.toBe('');
    expect(f.data[AUTH_SESSION_KEY]).toBe(f.token.getSessionId());
    expect(f.storage.remove).not.toHaveBeenCalled();
  });

  it('does not revive authentication or publish a held logout callback after disposal', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    let release!: () => void;
    f.storage.setMultiple.mockImplementationOnce(async values => {
      Object.assign(f.data, structuredClone(values)); await new Promise<void>(resolve => { release = resolve; }); return true;
    });
    const pending = f.token.clearToken(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.token.dispose(); release(); await expect(pending).rejects.toThrow('disposed');
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull(); expect(f.token.getSessionId()).toBe('');
    expect(f.bus.emit).not.toHaveBeenCalled(); expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('updates metadata before emitting a batched account switch', async () => {
    const { token, bus, change } = fixture();
    change({ [AUTH_STORAGE_KEY]: 'new-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'new-session' });
    await token.ensureInitialized();
    expect(token.getUserCache()?.userId).toBe(9);
    expect(bus.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 9 }));
  });

  it.each(['full', 'partial'])('tracks a pre-initialization %s storage event without reading or publishing authentication', async kind => {
    const f = fixture(snapshot);
    const next = { [AUTH_STORAGE_KEY]: 'new-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'new-session' };
    Object.assign(f.data, next);
    f.change(kind === 'full' ? next : { [AUTH_SESSION_KEY]: 'new-session' });
    await Promise.resolve(); await Promise.resolve();
    expect(f.storage.getMultiple).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled(); expect(f.storage.setMultiple).not.toHaveBeenCalled();
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull(); expect(f.token.getSessionId()).toBe('');
    expect(f.bus.emit).not.toHaveBeenCalled();
    await f.token.initialize();
    expect(f.token.getToken()).toBe('new-secret'); expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('new-session');
  });

  it.each([
    { [AUTH_USER_CACHE_KEY]: { userId: '7', userName: 'Friend' } },
    { [AUTH_USER_CACHE_KEY]: { userId: 2147483648, userName: 'Friend' } },
    { [AUTH_USER_CACHE_KEY]: { userId: 7, userName: {} } },
    { [AUTH_SESSION_KEY]: 42 }, { [AUTH_SESSION_KEY]: '' },
    { [AUTH_STORAGE_KEY]: {} }, { [AUTH_STORAGE_KEY]: '   ' },
  ])('rejects malformed persisted authentication without erasing it: %j', async corrupt => {
    const f = fixture({ ...snapshot, ...corrupt });
    await expect(f.token.initialize()).rejects.toThrow();
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    expect(f.bus.emit.mock.calls.some(([, payload]) => (payload as { isAuthenticated?: boolean }).isAuthenticated)).toBe(false);
    expect(f.storage.remove).not.toHaveBeenCalled(); expect(f.storage.setMultiple).not.toHaveBeenCalled(); expect(f.storage.set).not.toHaveBeenCalled();
    expect(f.data).toEqual({ ...snapshot, ...corrupt });
    Object.assign(f.data, snapshot); await f.token.initialize(); expect(f.token.getUserCache()).toEqual(owner);
  });

  it('copies and validates a setToken owner before asynchronous initialization', async () => {
    const f = fixture({ [AUTH_SESSION_KEY]: 'initial' });
    let release!: (value: object) => void;
    f.storage.getMultiple.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const user = { ...owner }; const pending = f.token.setToken('secret', user); user.userId = 9; user.userName = 'Mutated';
    release({ [AUTH_SESSION_KEY]: 'initial' }); await pending;
    expect(f.token.getUserCache()).toEqual(owner); expect(f.data[AUTH_USER_CACHE_KEY]).toEqual(owner);
  });

  it('rejects malformed setToken arguments without touching valid authentication', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    await expect(f.token.setToken(7 as unknown as string, owner)).rejects.toThrow();
    await expect(f.token.setToken('next', { userId: '7', userName: 'Bad' } as unknown as typeof owner)).rejects.toThrow();
    expect(f.token.getToken()).toBe('secret'); expect(f.token.getUserCache()).toEqual(owner); expect(f.bus.emit).not.toHaveBeenCalled();
    expect(f.storage.setMultiple).not.toHaveBeenCalled();
  });

  it('keeps a provisional token without publishing a true owner and rotates the old session', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    await f.token.setToken('secret');
    expect(f.token.getToken()).toBe('secret'); expect(f.token.getUserCache()).toBeNull(); expect(f.token.getSessionId()).not.toBe('session-a');
    expect(f.bus.emit).toHaveBeenLastCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false, userId: undefined }));
  });

  it('rotates the session when an owner changes under the same credential', async () => {
    const f = fixture(snapshot); await f.token.initialize();
    await f.token.setToken('secret', { userId: 9, userName: 'New' });
    expect(f.token.getSessionId()).not.toBe('session-a'); expect(f.token.getUserCache()?.userId).toBe(9);
  });

  it('accepts a validated atomic metadata/session update with an unchanged token', async () => {
    const f = fixture(snapshot); await f.token.initialize();
    f.change({ [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'next' });
    await f.token.ensureInitialized();
    expect(f.token.getToken()).toBe('secret'); expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('next');
  });

  it('requires a new session before accepting a metadata-only owner switch', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    f.change({ [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' } });
    await f.token.ensureInitialized(); expect(f.token.getUserCache()).toBeNull();
    expect(f.bus.emit.mock.calls.some(([, payload]) => (payload as { isAuthenticated?: boolean }).isAuthenticated)).toBe(false);
    f.change({ [AUTH_SESSION_KEY]: 'next' }); await f.token.ensureInitialized();
    expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('next');
  });

  it('removes exactly its native listener and ignores copied deliveries after disposal', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    (f.token as unknown as { dispose(): void }).dispose();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(f.listener);
    f.listener({ [AUTH_STORAGE_KEY]: { newValue: 'secret-again' }, [AUTH_USER_CACHE_KEY]: { newValue: owner }, [AUTH_SESSION_KEY]: { newValue: 'next' } }, 'local');
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull(); expect(f.bus.emit).not.toHaveBeenCalled();
    await expect(f.token.initialize()).rejects.toThrow('disposed');
  });

  it('never combines a token-only change with the previously cached owner', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    f.change({ [AUTH_STORAGE_KEY]: 'new-secret' });
    expect(f.token.getUserCache()).toBeNull();
    await Promise.resolve(); await Promise.resolve();
    expect(f.token.getUserCache()).toBeNull();
    expect(f.bus.emit.mock.calls.some(([, payload]) => (payload as { isAuthenticated?: boolean }).isAuthenticated)).toBe(false);
  });

  it('fails closed on corrupt metadata-only changes and recovers with the next valid snapshot', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    f.change({ [AUTH_USER_CACHE_KEY]: { userId: '7', userName: 'Secret-metadata' } });
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    await expect(f.token.initialize()).rejects.toThrow();
    expect(f.logger.error.mock.calls.flat().join(' ')).not.toContain('Secret-metadata');
    f.change(snapshot); await f.token.ensureInitialized(); expect(f.token.getUserCache()).toEqual(owner);
  });

  it('publishes the newer storage snapshot when an external account switch races a held local write', async () => {
    const f = fixture(snapshot); await f.token.initialize(); f.bus.emit.mockClear();
    let release!: () => void;
    f.storage.setMultiple.mockImplementationOnce(async values => { Object.assign(f.data, structuredClone(values)); await new Promise<void>(resolve => { release = resolve; }); return true; });
    const pending = f.token.setToken('local-secret', { userId: 8, userName: 'Local' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.change({ [AUTH_STORAGE_KEY]: 'newer-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'Newer' }, [AUTH_SESSION_KEY]: 'newer' });
    release(); await pending;
    expect(f.token.getToken()).toBe('newer-secret'); expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('newer');
  });

  it('preserves the owner barrier if a token-only update interrupts a local write', async () => {
    const f = fixture(snapshot); await f.token.initialize();
    let release!: () => void;
    f.storage.setMultiple.mockImplementationOnce(async values => { Object.assign(f.data, structuredClone(values)); await new Promise<void>(resolve => { release = resolve; }); return true; });
    const pending = f.token.setToken('local-secret', { userId: 8, userName: 'Local' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.change({ [AUTH_STORAGE_KEY]: 'external-secret' }); release(); await pending;
    expect(f.token.getToken()).toBe('external-secret'); expect(f.token.getUserCache()).toBeNull();
    expect(f.bus.emit).toHaveBeenLastCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false, userId: undefined }));
  });

  it('serializes writes and retains each queued caller snapshot', async () => {
    const f = fixture(snapshot); await f.token.initialize();
    let release!: () => void;
    const save = f.storage.setMultiple.getMockImplementation()!;
    f.storage.setMultiple.mockImplementationOnce(async values => { await new Promise<void>(resolve => { release = resolve; }); return save(values); });
    const first = f.token.setToken('first', { userId: 8, userName: 'First' });
    const nextOwner = { userId: 9, userName: 'Second' }; const second = f.token.setToken('second', nextOwner); nextOwner.userId = 99;
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); expect(f.storage.setMultiple).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]); expect(f.storage.setMultiple).toHaveBeenCalledTimes(2);
    expect(f.token.getUserCache()).toEqual({ userId: 9, userName: 'Second' }); expect(f.data[AUTH_STORAGE_KEY]).toBe('second');
  });

  it('ignores an initialization read that finishes after disposal', async () => {
    const f = fixture(snapshot); let release!: (value: object) => void;
    f.storage.getMultiple.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.token.initialize(); (f.token as unknown as { dispose(): void }).dispose(); release(snapshot);
    await expect(pending).rejects.toThrow('disposed'); expect(f.token.getUserCache()).toBeNull(); expect(f.bus.emit).not.toHaveBeenCalled();
  });

  it('does not pass thrown credential text to diagnostics', async () => {
    const f = fixture(); f.storage.getMultiple.mockRejectedValueOnce(new Error('secret-credential'));
    await expect(f.token.initialize()).rejects.toThrow();
    expect(f.logger.error.mock.calls.flat().join(' ')).not.toContain('secret-credential');
  });

  it('keeps an empty legacy credential absent and never exposes orphaned owner metadata', async () => {
    const f = fixture({ ...snapshot, [AUTH_STORAGE_KEY]: '' }); await f.token.initialize();
    expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    expect(f.storage.setMultiple).not.toHaveBeenCalled(); expect(f.data[AUTH_STORAGE_KEY]).toBe('');
    await expect(f.token.setToken('')).rejects.toThrow('Empty');
  });

  it('allows explicit fresh credentials after corrupt metadata without repairing stored data automatically', async () => {
    const f = fixture({ ...snapshot, [AUTH_USER_CACHE_KEY]: { userId: '7', userName: 'Corrupt' } });
    await expect(f.token.initialize()).rejects.toThrow();
    await f.token.ensureInitialized(); expect(f.token.getToken()).toBeNull(); expect(f.token.getUserCache()).toBeNull();
    expect(f.storage.setMultiple).not.toHaveBeenCalled(); expect(f.storage.remove).not.toHaveBeenCalled(); expect(f.data[AUTH_STORAGE_KEY]).toBe('secret');
    await f.token.setToken('fresh-secret', { userId: 9, userName: 'Fresh' });
    expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getToken()).toBe('fresh-secret');
    expect(f.token.getSessionId()).not.toBe('session-a');
  });

  it('permits the OAuth provisional credential after corrupt metadata while keeping the owner absent', async () => {
    const f = fixture({ ...snapshot, [AUTH_SESSION_KEY]: 42 });
    await f.token.setToken('provisional-fresh');
    expect(f.token.getToken()).toBe('provisional-fresh'); expect(f.token.hasToken()).toBe(true);
    expect(f.token.getUserCache()).toBeNull(); expect(f.token.getSessionId()).toEqual(expect.any(String));
    expect(f.token.getSessionId()).not.toBe('');
    expect(f.bus.emit).toHaveBeenLastCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.objectContaining({ isAuthenticated: false, userId: undefined }));
    await f.token.setToken('provisional-fresh', { userId: 9, userName: 'Fresh' }); expect(f.token.getUserCache()?.userId).toBe(9);
  });

  it('does not turn a storage read failure into permission to replace authentication', async () => {
    const f = fixture(snapshot); f.storage.getMultiple.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(f.token.setToken('fresh', owner)).rejects.toThrow('Unavailable');
    expect(f.storage.setMultiple).not.toHaveBeenCalled(); expect(f.data).toEqual(snapshot);
  });

  it('handles native writes where Chrome omits unchanged metadata from an atomic batch', async () => {
    const f = fixture(snapshot); await f.token.initialize();
    f.storage.setMultiple.mockImplementation(async values => {
      const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(f.data[key])));
      f.change(changed); return true;
    });
    await f.token.setToken('rotated-secret', owner);
    expect(f.token.getToken()).toBe('rotated-secret'); expect(f.token.getUserCache()).toEqual(owner);
    expect(f.token.getSessionId()).not.toBe('session-a');
    await f.token.setToken('rotated-secret');
    expect(f.token.getToken()).toBe('rotated-secret'); expect(f.token.getUserCache()).toBeNull();
    await f.token.setToken('rotated-secret', owner); expect(f.token.getUserCache()).toEqual(owner);
    await f.token.setToken('rotated-secret', { ...owner, userName: 'Renamed' }); expect(f.token.getUserCache()?.userName).toBe('Renamed');
  });

  it('generates a missing legacy session while preserving valid token and owner data', async () => {
    const f = fixture({ [AUTH_STORAGE_KEY]: 'secret', [AUTH_USER_CACHE_KEY]: owner }); await f.token.initialize();
    expect(f.storage.set).toHaveBeenCalledExactlyOnceWith(AUTH_SESSION_KEY, expect.any(String));
    expect(f.token.getUserCache()).toEqual(owner); expect(f.data[AUTH_STORAGE_KEY]).toBe('secret');
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('returns authentication metadata without disclosing the credential', async () => {
    const { token } = fixture();
    await token.setToken('secret', { userId: 7, userName: 'Friend' });
    const auth = new AuthService({} as never, {} as never, {} as never, token);
    expect(await auth.getStatus()).toEqual({ authenticated: true, userId: 7, userName: 'Friend', sessionId: expect.any(String) });
  });
  it('does not overwrite newer storage events with an old startup read', async () => {
    const { token, storage } = fixture();
    let finish!: (value: object) => void;
    storage.getMultiple.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    storage.getMultiple.mockResolvedValueOnce({ [AUTH_STORAGE_KEY]: 'new', [AUTH_USER_CACHE_KEY]: { userId: 2, userName: 'Two' }, [AUTH_SESSION_KEY]: 'two' });
    const starting = token.initialize();
    const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    listeners[listeners.length - 1][0]({ [AUTH_STORAGE_KEY]: { newValue: 'new' }, [AUTH_USER_CACHE_KEY]: { newValue: { userId: 2, userName: 'Two' } }, [AUTH_SESSION_KEY]: { newValue: 'two' } }, 'local');
    finish({ [AUTH_STORAGE_KEY]: 'old', [AUTH_SESSION_KEY]: 'old' });
    await starting;
    expect(token.getToken()).toBe('new');
    expect(token.getUserCache()?.userId).toBe(2);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('does not revoke a newer valid account when an obsolete startup read rejects', async () => {
    const f = fixture(snapshot); let reject!: (error: Error) => void;
    f.storage.getMultiple.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = f.token.initialize();
    f.change({ [AUTH_STORAGE_KEY]: 'new-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'new-session' });
    f.bus.emit.mockClear(); reject(new Error('Obsolete read failure')); await pending;
    expect(f.token.getToken()).toBe('new-secret'); expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('new-session');
    expect(f.bus.emit.mock.calls.some(([, payload]) => (payload as { isAuthenticated?: boolean }).isAuthenticated === false)).toBe(false);
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it.each(['reject', 'false'])('ignores an obsolete legacy-session persistence %s after a valid account switch', async failure => {
    const f = fixture({ [AUTH_STORAGE_KEY]: 'secret', [AUTH_USER_CACHE_KEY]: owner }); let finish!: () => void;
    f.storage.set.mockImplementationOnce(() => new Promise<boolean>((resolve, reject) => {
      finish = () => { if (failure === 'reject') reject(new Error('Obsolete write failure')); else resolve(false); };
    }));
    const pending = f.token.initialize(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.change({ [AUTH_STORAGE_KEY]: 'new-secret', [AUTH_USER_CACHE_KEY]: { userId: 9, userName: 'New' }, [AUTH_SESSION_KEY]: 'new-session' });
    f.bus.emit.mockClear(); finish(); await pending;
    expect(f.token.getToken()).toBe('new-secret'); expect(f.token.getUserCache()?.userId).toBe(9); expect(f.token.getSessionId()).toBe('new-session');
    expect(f.bus.emit.mock.calls.some(([, payload]) => (payload as { isAuthenticated?: boolean }).isAuthenticated === false)).toBe(false);
    expect(f.logger.error).not.toHaveBeenCalled();
  });
});
