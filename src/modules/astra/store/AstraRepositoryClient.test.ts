import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AstraRepositoryClient } from './AstraRepositoryClient';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '../utils/AstraConstants';
import type { AstraSnapshot } from './AstraPersistence';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import { logger } from '@core/logger';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

const bridge = vi.hoisted(() => ({ active: false }));
vi.mock('@core/storage/LocalStorageBridge', () => ({ needsLocalStorageBridge: () => bridge.active }));
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
type RuntimeListener = (message: unknown) => void;
const clients: AstraRepositoryClient[] = [];
const snapshot = (title = 'Private work'): AstraSnapshot => ({ ownerId: 7, revision: 1, settings: { ...DEFAULT_SETTINGS }, sections: structuredClone(DEFAULT_SECTIONS),
  summaries: [{ id: 'w_1', mediaId: 1, title, type: 'anime', status: MediaListStatus.CURRENT, currentScore: 8, updatedAt: 1 }] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
beforeEach(() => { bridge.active = false; });
afterEach(() => {
  for (const client of clients.splice(0)) (client as unknown as { dispose?: () => void }).dispose?.();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function fixture() {
  let session = 'session-A';
  const storageEvents = { addListener: vi.fn<(listener: StorageListener) => void>(), removeListener: vi.fn<(listener: StorageListener) => void>() };
  const runtimeEvents = { addListener: vi.fn<(listener: RuntimeListener) => void>(), removeListener: vi.fn<(listener: RuntimeListener) => void>() };
  const sendMessage = vi.fn(async (_message: unknown): Promise<unknown> => ({ success: true, data: snapshot() }));
  vi.stubGlobal('chrome', { storage: { onChanged: storageEvents }, runtime: { onMessage: runtimeEvents, sendMessage } });
  const storage = { onChange: vi.fn() };
  const auth = { getSessionId: () => session, ensureInitialized: vi.fn(async () => {}), refresh: vi.fn(async () => {}) };
  const bus = new EventBus(); const on = vi.spyOn(bus, 'on');
  const client = new AstraRepositoryClient(bus, storage as never, auth as unknown as AuthStateClient); clients.push(client);
  return { client, storageEvents, runtimeEvents, sendMessage, storage, auth, bus, on,
    change: () => { session = 'session-B'; bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 7, timestamp: new Date() }); } };
}
const dispose = (client: AstraRepositoryClient) => (client as unknown as { dispose(): void }).dispose();

describe('Astra repository client document ownership', () => {
  it.each([false, true])('removes the exact native listener and auth subscription for bridge=%s', mode => {
    bridge.active = mode; const f = fixture();
    expect(f.sendMessage).not.toHaveBeenCalled(); dispose(f.client); dispose(f.client);
    const events = mode ? f.runtimeEvents : f.storageEvents;
    expect(events.removeListener).toHaveBeenCalledExactlyOnceWith(events.addListener.mock.calls[0][0]);
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });
  it('makes copied native and auth callbacks inert after disposal', async () => {
    const f = fixture(); await f.client.init(); const listener = f.storageEvents.addListener.mock.calls[0][0];
    const authListener = f.on.mock.calls[0][1]; dispose(f.client); f.sendMessage.mockClear();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    listener({ astra_account_7_au_astra_revision: { newValue: 2 } }, 'local'); authListener(); await settle();
    expect(f.sendMessage).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('rejects readiness and new commands after disposal without starting RPC', async () => {
    const f = fixture(); const ready = deferred<void>(); f.auth.ensureInitialized.mockReturnValue(ready.promise);
    const pending = f.client.init(); dispose(f.client); ready.resolve();
    await expect(pending).rejects.toThrow('disposed'); await expect(f.client.init()).rejects.toThrow('disposed');
    await expect(f.client.getFullWork(1)).rejects.toThrow('disposed'); await expect(f.client.updateSettings({ autoSync: true })).rejects.toThrow('disposed');
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it('does not restore a private snapshot when an RPC response arrives after disposal', async () => {
    const f = fixture(); const held = deferred<unknown>(); f.sendMessage.mockReturnValueOnce(held.promise);
    const pending = f.client.init(); await settle(); dispose(f.client); const event = vi.spyOn(f.bus, 'emit');
    held.resolve({ success: true, data: snapshot() }); await expect(pending).rejects.toThrow('disposed');
    expect(f.client.getWorks()).toEqual([]); expect(event).not.toHaveBeenCalled();
  });
  it('clears snapshot and inherited work cache without touching storage', async () => {
    const f = fixture(); await f.client.init(); expect(f.client.getWorks()).toHaveLength(1);
    const cache = (f.client as unknown as { fullWorkCache: Map<number, unknown> }).fullWorkCache; cache.set(1, { notes: 'Private note' });
    dispose(f.client); expect(f.client.getWorks()).toEqual([]); expect(cache.size).toBe(0);
    expect(f.storage.onChange).not.toHaveBeenCalled();
  });
  it('does not refresh or return a pending command result after disposal', async () => {
    const f = fixture(); const held = deferred<unknown>(); f.sendMessage.mockReturnValueOnce(held.promise);
    const pending = f.client.deleteWork(1); await settle(); dispose(f.client); held.resolve({ success: true, data: undefined });
    await expect(pending).rejects.toThrow('disposed'); expect(f.sendMessage).toHaveBeenCalledOnce();
  });
  it.each([{}, 'bad', [null], [17], null])('ignores malformed bridge keys %j', async keys => {
    bridge.active = true; const f = fixture(); await f.client.init(); f.sendMessage.mockClear();
    expect(() => f.runtimeEvents.addListener.mock.calls[0][0]({ type: MSG.LOCAL_CHANGED, keys })).not.toThrow();
    await settle(); expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it('retires a full-work read on a same-owner relogin', async () => {
    const f = fixture(); const held = deferred<unknown>(); f.sendMessage.mockReturnValueOnce(held.promise);
    const pending = f.client.getFullWork(1); await settle(); f.change(); held.resolve({ success: true, data: { notes: 'Old session private' } });
    await expect(pending).rejects.toThrow('account changed'); expect(f.client.getWorks()).toEqual([]);
  });
  it.each(['RPC', 'auth'] as const)('contains late %s rejection as a disposed operation', async phase => {
    const f = fixture(); const held = deferred<unknown>();
    if (phase === 'RPC') f.sendMessage.mockReturnValueOnce(held.promise);
    else f.auth.ensureInitialized.mockReturnValueOnce(held.promise as Promise<void>);
    const pending = f.client.getFullWork(1); await settle(); dispose(f.client);
    held.reject(new Error('Raw late private error')); await expect(pending).rejects.toThrow('disposed');
  });
  it('contains reentrant disposal during a snapshot notification without further publication', async () => {
    const f = fixture(); f.bus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, () => dispose(f.client));
    await expect(f.client.init()).rejects.toThrow('disposed'); expect(f.client.getWorks()).toEqual([]);
    expect(f.sendMessage).toHaveBeenCalledOnce();
  });
  it('injects dependencies and lets the creating DI scope dispose the concrete client', async () => {
    const f = fixture(); dispose(f.client); f.storageEvents.addListener.mockClear(); f.storageEvents.removeListener.mockClear();
    const scope = container.createChildContainer(); scope.registerInstance(TOKENS.EventBus, f.bus);
    scope.registerInstance(TOKENS.LocalStorage, f.storage); scope.registerInstance(TOKENS.AuthTokenService, f.auth);
    const client = scope.resolve(AstraRepositoryClient); clients.push(client);
    expect(f.sendMessage).not.toHaveBeenCalled(); await scope.dispose();
    expect(f.storageEvents.removeListener).toHaveBeenCalledExactlyOnceWith(f.storageEvents.addListener.mock.calls[0][0]);
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0); await expect(client.init()).rejects.toThrow('disposed');
  });
});
