import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseModule } from './BaseModule';
import { EventBus } from '@core/events/EventBus';
import { logger } from '@core/logger';
class Probe extends BaseModule {
  constructor() { super(new EventBus()); }
  async init(): Promise<void> {} getName(): string { return 'probe'; }
  wait(): Promise<HTMLElement | null> { return this.waitForElement('.late-element'); }
  observe(callback: MutationCallback): void { this.registerObserver('probe', document.body, { childList: true }, callback, 10); }
  suspend(): void { this.suspendObserver('probe'); } resume(): void { this.resumeObserver('probe'); }
}
describe('common module resource cleanup', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('settles pending element waiters when destroyed instead of polling the next page', async () => {
    const module = new Probe(); const waiting = module.wait(); await module.destroy();
    expect(await waiting).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels old resume timers during destruction and does not unsuspend a new observer', async () => {
    const module = new Probe(); module.observe(vi.fn()); module.suspend(); module.resume(); await module.destroy();
    const callback = vi.fn(); module.observe(callback); module.suspend(); document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(100); expect(callback).not.toHaveBeenCalled(); await module.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('activates a replacement observer even when the previous observer had a pending resume', async () => {
    const module = new Probe(); module.observe(vi.fn()); module.suspend(); module.resume();
    const callback = vi.fn(); module.observe(callback);
    expect(vi.getTimerCount()).toBe(0);
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(100); expect(callback).toHaveBeenCalledOnce(); await module.destroy();
  });
  it('contains asynchronous callback failures at their execution boundary', async () => {
    const module = new Probe(); const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    module.observe(async () => { throw new Error('Callback failed'); }); document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(20); expect(error).toHaveBeenCalledWith('Module observer callback failed', expect.any(Error)); await module.destroy();
  });
});
