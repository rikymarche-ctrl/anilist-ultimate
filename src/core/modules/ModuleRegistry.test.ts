import { describe, it, expect, vi } from 'vitest';
import { ModuleRegistry } from './ModuleRegistry';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { container } from '@core/di/container';

function fixture() {
  const bus = new EventBus();
  const registry = new ModuleRegistry({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } as never, bus);
  return { registry, bus };
}
describe('module lifecycle failure and concurrency', () => {
  it('supplies a usable DI container to a factory that resolves its module', async () => {
    const { registry } = fixture();
    const module = { init: vi.fn(async () => {}), destroy: vi.fn(async () => {}), getName: () => 'resolved' };
    const token = Symbol('test-module');
    container.registerInstance(token, module);
    try {
      registry.register({ name: 'resolved', enabled: true, factory: scope => scope.resolve(token) });
      expect(await registry.initModule('resolved')).toBe(true);
      expect(registry.getInstance('resolved')).toBe(module);
      await registry.destroyAll();
      expect(module.destroy).toHaveBeenCalledTimes(1);
    } finally { container.reset(); }
  });
  it('cleans partially initialized modules on failure', async () => {
    const { registry } = fixture();
    const module = { init: vi.fn(async () => { throw new Error('Partial failure'); }), destroy: vi.fn(async () => {}), getName: () => 'test' };
    registry.register({ name: 'test', enabled: true, factory: () => module });
    expect(await registry.initModule('test')).toBe(false);
    expect(module.destroy).toHaveBeenCalledTimes(1);
    expect(registry.getStatus('test')).toBe('failed');
    expect(registry.getInstance('test')).toBeUndefined();
  });
  it('waits for initialization before destroying without leaving a live module', async () => {
    const { registry } = fixture();
    let finish!: () => void;
    const module = { init: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), destroy: vi.fn(async () => {}), getName: () => 'test' };
    registry.register({ name: 'test', enabled: true, factory: () => module });
    const first = registry.initModule('test');
    const second = registry.initModule('test');
    const destroy = registry.destroyModule('test');
    finish();
    await Promise.all([first, second, destroy]);
    expect(module.init).toHaveBeenCalledTimes(1);
    expect(module.destroy).toHaveBeenCalledTimes(1);
    expect(registry.getStatus('test')).toBe('pending');
  });
  it('global shutdown cancels pending publication and prevents navigation revival', async () => {
    const { registry, bus } = fixture();
    let finish!: () => void;
    const module = { init: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), destroy: vi.fn(async () => {}), getName: () => 'test' };
    registry.register({ name: 'test', enabled: true, pageMatch: () => true, factory: () => module });
    const init = registry.initModule('test');
    const destroy = registry.destroyAll();
    finish();
    expect(await init).toBe(false);
    await destroy;
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath: '/home', timestamp: new Date() });
    expect(module.destroy).toHaveBeenCalledTimes(1);
    expect(module.init).toHaveBeenCalledTimes(1);
    expect(registry.getInstance('test')).toBeUndefined();
  });
});
