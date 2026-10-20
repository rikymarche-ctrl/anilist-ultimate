import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { ConfigManager } from './ConfigManager';
import { ConfigClient } from './ConfigClient';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import { validateConfigPatch } from './ConfigProtocol';
import { DEFAULT_CONFIG } from './defaults';

function fixture() {
  let stored: unknown = null;
  const storage = { get: vi.fn(async () => structuredClone(stored)), set: vi.fn(async (_key: string, value: unknown) => { stored = structuredClone(value); return true; }),
    onChange: vi.fn((_key: string, _callback: () => void) => () => {}) };
  const writer = new ConfigManager(storage as never, new EventBus());
  const handle = createBackgroundMessageHandler(Promise.resolve(), vi.fn(), vi.fn(), undefined, undefined, () => writer);
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: unknown) => new Promise(resolve => { handle(message, { id: chrome.runtime.id, url: 'https://anilist.co/home' }, resolve); })) as never);
  const first = new ConfigClient(storage as never, new EventBus());
  const second = new ConfigClient(storage as never, new EventBus());
  return { first, second, writer, storage };
}
describe('configuration single writer and cross-tab patches', () => {
  beforeEach(() => { chrome.runtime.id = 'extension-test'; vi.clearAllMocks(); });
  it('preserves concurrent feature edits from two clients', async () => {
    const { first, second, writer } = fixture();
    await Promise.all([first.load(), second.load()]);
    await Promise.all([first.setFeature('calendar', false), second.setFeature('hoverComments', false)]);
    expect(writer.get('features')).toMatchObject({ calendar: false, hoverComments: false });
    await Promise.all([first.load(), second.load()]);
    expect(first.getAll()).toEqual(second.getAll());
  });
  it('sends only changed nested preferences, retaining independent edits from another tab', async () => {
    const { first, second, writer } = fixture();
    await Promise.all([first.load(), second.load()]);
    const one = first.get('calendar'); one.hideEmptyDays = true;
    const two = second.get('calendar'); two.showTime = false;
    await Promise.all([first.set('calendar', one), second.set('calendar', two)]);
    expect(writer.get('calendar')).toMatchObject({ hideEmptyDays: true, showTime: false });
  });
  it('does not publish failed changes and refreshes peer state after a storage signal', async () => {
    const { first, second, storage } = fixture();
    await first.load();
    storage.set.mockResolvedValueOnce(false);
    await expect(first.setFeature('calendar', false)).rejects.toThrow('configuration operation failed');
    expect(first.get('features')).toEqual(DEFAULT_CONFIG.features);
    await second.set('theme', { accentColor: '#123456' });
    const changed = vi.fn(); first.onChange('theme', changed);
    const listener = storage.onChange.mock.calls[0][1] as () => void;
    listener();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await first.load();
    expect(changed).toHaveBeenCalledWith({ accentColor: '#123456' }, DEFAULT_CONFIG.theme);
    expect(first.get('theme')).toEqual({ accentColor: '#123456' });
  });
  it.each([{ unknown: true }, { features: { calendar: 'false' } }, { calendar: { timeFormat: 'invalid' } }, { api: { timeout: -1 } }, JSON.parse('{"theme":{"__proto__":{"polluted":true}}}')])('rejects invalid patches %j', patch => {
    expect(() => validateConfigPatch(patch)).toThrow();
  });

  it('routes public applyPatch through the background writer instead of changing frontend storage directly', async () => {
    const { first, writer } = fixture(); await first.load();
    await first.applyPatch({ theme: { accentColor: '#abcdef' } });
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'patch', value: { theme: { accentColor: '#abcdef' } } }));
    expect(writer.get('theme')).toEqual({ accentColor: '#abcdef' });
  });

  it('unsubscribes exact storage callbacks and makes retired callbacks/subscribers inert', async () => {
    const { first, storage } = fixture(); const unsubscribe = vi.fn();
    const localStorage = { ...storage, onChange: vi.fn((_key: string, _callback: () => void) => unsubscribe) };
    const client = new ConfigClient(localStorage as never, new EventBus());
    const subscriber = vi.fn(); client.onChange('theme', subscriber);
    const callback = localStorage.onChange.mock.calls[0][1] as unknown as () => void;
    client.dispose(); client.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1); callback();
    await expect(client.load()).rejects.toThrow('disposed'); await expect(client.reset()).rejects.toThrow('disposed');
    await expect(client.applyPatch({ theme: { accentColor: '#abcdef' } })).rejects.toThrow('disposed');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled(); expect(subscriber).not.toHaveBeenCalled();
    await first.load();
  });

  it('lets an accepted write finish but rejects retired acknowledgement and queued operations without publishing', async () => {
    const { first } = fixture(); const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit');
    const storage = { onChange: () => () => {} }; const client = new ConfigClient(storage as never, bus);
    let finish!: (value: unknown) => void; let durable = false;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((async () => {
      const result = await new Promise(resolve => { finish = resolve; }); durable = true; return result;
    }) as never);
    const active = client.setFeature('calendar', false); const queued = client.reset();
    const result = expect(active).rejects.toThrow('disposed'); const queuedResult = expect(queued).rejects.toThrow('disposed');
    await Promise.resolve(); client.dispose();
    finish({ success: true, data: { ...structuredClone(DEFAULT_CONFIG), theme: { accentColor: '#abcdef' } } });
    await result; await queuedResult;
    expect(durable).toBe(true); expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.getAll()).toEqual(DEFAULT_CONFIG); expect(emit).not.toHaveBeenCalled();
    void first;
  });

  it('stops reentrant callbacks and bus events when a snapshot subscriber disposes its client', async () => {
    const { storage, writer } = fixture(); const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit');
    const client = new ConfigClient(storage as never, bus); const next = vi.fn(); const feature = vi.fn();
    client.onChange('theme', () => client.dispose()); client.onChange('theme', next); client.onChange('features', feature);
    // Theme precedes features in this response to prove the entire publication loop stops.
    const snapshot = Object.assign({ theme: { accentColor: '#abcdef' } }, structuredClone(DEFAULT_CONFIG));
    snapshot.theme.accentColor = '#abcdef'; snapshot.features.calendar = false;
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, data: snapshot } as never);
    await expect(client.load()).rejects.toThrow('disposed');
    expect(next).not.toHaveBeenCalled(); expect(feature).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
    await writer.setFeature('calendar', false); expect(writer.get('features').calendar).toBe(false);
  });

  it('rejects a retired in-flight RPC failure as disposed and never dispatches the queued patch', async () => {
    const { first } = fixture(); let fail!: (error: Error) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((() => new Promise((_resolve, reject) => { fail = reject; })) as never);
    const active = first.load(); const queued = first.applyPatch({ theme: { accentColor: '#abcdef' } });
    const result = expect(active).rejects.toThrow('disposed'); const queuedResult = expect(queued).rejects.toThrow('disposed');
    await Promise.resolve(); first.dispose(); fail(new Error('Runtime disconnected')); await result; await queuedResult;
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
