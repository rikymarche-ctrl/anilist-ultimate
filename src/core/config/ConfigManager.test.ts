import { describe, it, expect, vi } from 'vitest';
import { ConfigManager } from './ConfigManager';
import { logger } from '@core/logger';
import { DEFAULT_CONFIG } from './defaults';

function fixture() {
  const storage = { get: vi.fn(async () => null as unknown), set: vi.fn(async () => true) };
  const bus = { emit: vi.fn() };
  const config = new ConfigManager(storage as never, bus as never);
  return { config, storage, bus };
}
describe('durable and isolated configuration', () => {
  it('does not mutate default configuration or expose nested internal references', async () => {
    const before = structuredClone(DEFAULT_CONFIG);
    const { config } = fixture();
    const other = fixture().config;
    const returned = config.get('features');
    returned.calendar = !returned.calendar;
    expect(config.get('features')).toEqual(before.features);
    await config.setFeature('calendar', !before.features.calendar);
    expect(DEFAULT_CONFIG).toEqual(before);
    expect(other.get('features')).toEqual(before.features);
    await config.reset();
    expect(config.getAll()).toEqual(before);
  });
  it('does not publish a setting or notify after persistence fails', async () => {
    const { config, storage, bus } = fixture();
    const before = config.get('features');
    const listener = vi.fn();
    config.onChange('features', listener);
    storage.set.mockResolvedValueOnce(false);
    await expect(config.setFeature('calendar', !before.calendar)).rejects.toThrow('storage write failed');
    expect(config.get('features')).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalled();
  });
  it('serializes parallel feature changes without losing an update', async () => {
    const { config } = fixture();
    await Promise.all([config.setFeature('calendar', false), config.setFeature('hoverComments', false)]);
    expect(config.get('features')).toMatchObject({ calendar: false, hoverComments: false });
  });
  it('rejects failed initial reads and ignores malformed stored objects/prototype keys', async () => {
    const { config, storage } = fixture();
    storage.get.mockRejectedValueOnce(new Error('Read failed'));
    await expect(config.load()).rejects.toThrow('Read failed');
    storage.get.mockResolvedValueOnce(JSON.parse('{"features":null,"theme":{"__proto__":{"polluted":true}},"unknown":true}'));
    await config.load();
    expect(config.get('features')).toEqual(DEFAULT_CONFIG.features);
    expect(Object.getPrototypeOf(config.get('theme'))).toBe(Object.prototype);
    expect(config.getAll()).not.toHaveProperty('unknown');
  });
});


describe('configuration validation and async subscribers', () => {
  it('retains valid stored settings while rejecting invalid enum, numbers and color fields', async () => {
    const { config, storage } = fixture();
    storage.get.mockResolvedValueOnce({ debug: { enabled: true, logLevel: 'invalid' }, api: { timeout: -1 }, calendar: { maxCardsPerDay: NaN, timeFormat: 'invalid' }, theme: { accentColor: '<script>' } });
    await config.load(); expect(config.get('debug').enabled).toBe(true);
    expect(config.get('debug').logLevel).toBe(DEFAULT_CONFIG.debug.logLevel);
    expect(config.get('api').timeout).toBe(DEFAULT_CONFIG.api.timeout);
    expect(config.get('calendar')).toEqual(DEFAULT_CONFIG.calendar); expect(config.get('theme')).toEqual(DEFAULT_CONFIG.theme);
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('rejects invalid direct set/applyPatch values before persistence', async () => {
    const { config, storage } = fixture();
    await expect(config.set('api', { ...DEFAULT_CONFIG.api, timeout: Infinity })).rejects.toThrow('Invalid configuration');
    expect(() => config.applyPatch({ theme: { accentColor: 'red' } })).toThrow('Invalid configuration');
    expect(storage.set).not.toHaveBeenCalled(); expect(config.getAll()).toEqual(DEFAULT_CONFIG);
  });
  it('contains async subscriber failures while notifying later listeners and preserving the durable update', async () => {
    const { config } = fixture(); const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined); const next = vi.fn();
    const unsubscribe = config.onChange('features', async () => { throw new Error('Listener failure'); }); config.onChange('features', next);
    await config.setFeature('calendar', false); await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(next).toHaveBeenCalledTimes(1); expect(config.get('features').calendar).toBe(false);
    unsubscribe(); error.mockRestore();
  });
});

describe('configuration publication lifetime hook', () => {
  class RetirableConfig extends ConfigManager {
    private active = true;
    protected override canPublish(): boolean { return this.active; }
    retire(): void { this.active = false; this.clearChangeListeners(); }
  }
  it('finishes accepted persistence while suppressing the retired snapshot and subscribers', async () => {
    let finish!: (value: boolean) => void;
    const storage = { set: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })) };
    const bus = { emit: vi.fn() }; const config = new RetirableConfig(storage as never, bus as never); const changed = vi.fn();
    config.onChange('features', changed); const pending = config.setFeature('calendar', false);
    await Promise.resolve(); config.retire(); finish(true); await pending;
    expect(storage.set).toHaveBeenCalledOnce(); expect(config.get('features')).toEqual(DEFAULT_CONFIG.features);
    expect(changed).not.toHaveBeenCalled(); expect(bus.emit).not.toHaveBeenCalled();
  });

  it('stops later listeners and the event when retirement occurs reentrantly during set', async () => {
    const storage = { set: vi.fn(async () => true) }; const bus = { emit: vi.fn() };
    const config = new RetirableConfig(storage as never, bus as never); const next = vi.fn();
    config.onChange('theme', () => config.retire()); config.onChange('theme', next);
    await config.set('theme', { accentColor: '#abcdef' });
    expect(config.get('theme')).toEqual({ accentColor: '#abcdef' }); expect(next).not.toHaveBeenCalled(); expect(bus.emit).not.toHaveBeenCalled();
  });

  it('keeps an ordinary background manager publishing after accepted writes finish', async () => {
    const { config, storage, bus } = fixture(); const listener = vi.fn(); config.onChange('features', listener);
    await config.applyPatch({ features: { ...DEFAULT_CONFIG.features, calendar: false } });
    expect(storage.set).toHaveBeenCalledOnce(); expect(config.get('features').calendar).toBe(false);
    expect(listener).toHaveBeenCalledOnce(); expect(bus.emit).toHaveBeenCalled();
  });
});
