import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedGlobalObserver, mutationsMatchSelector } from './SharedGlobalObserver';
import { logger } from '@core/logger';

const NativeObserver = MutationObserver;
let instances: ControlledObserver[];
class ControlledObserver implements MutationObserver {
  observe = vi.fn(); disconnect = vi.fn(); takeRecords = () => [];
  constructor(private callback: MutationCallback) { instances.push(this); }
  deliver(records: MutationRecord[] = []) { this.callback(records, this); }
}
function appendRecords(element: HTMLElement): MutationRecord[] {
  const collector = new NativeObserver(() => {});
  collector.observe(document.body, { childList: true, subtree: true });
  document.body.append(element);
  const records = collector.takeRecords(); collector.disconnect(); return records;
}
describe('SharedGlobalObserver callback ownership and filtering', () => {
  let observer: SharedGlobalObserver;
  beforeEach(() => { vi.useFakeTimers(); instances = []; vi.stubGlobal('MutationObserver', ControlledObserver); observer = new SharedGlobalObserver(); });
  afterEach(() => { observer.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('contains synchronous callback errors and lets other subscribers run', () => {
    const error = new Error('callback failed'); const healthy = vi.fn();
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    observer.register('failing', () => { throw error; }); observer.register('healthy', healthy);
    instances[0].deliver(); expect(() => vi.runAllTimers()).not.toThrow();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Callback error'), error); expect(healthy).toHaveBeenCalledOnce();
  });
  it('contains asynchronous callback rejections', async () => {
    const error = new Error('async failed'); const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    observer.register('failing', async () => { throw error; }); instances[0].deliver(); await vi.runAllTimersAsync();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Callback error'), error);
  });
  it('cancels pending callbacks when unregistered and disconnects the last observer', () => {
    const callback = vi.fn(); observer.register('removed', callback); instances[0].deliver(); observer.unregister('removed'); vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled(); expect(instances[0].disconnect).toHaveBeenCalledOnce();
  });
  it('rejects delivery from a disconnected observer after registration restarts', () => {
    const old = vi.fn(); observer.register('old', old); const disconnected = instances[0]; observer.unregister('old');
    const current = vi.fn(); observer.register('current', current); disconnected.deliver(); vi.runAllTimers(); expect(current).not.toHaveBeenCalled();
    instances[1].deliver(); vi.runAllTimers(); expect(current).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled();
  });
  it('shares one native observer and throttles subscriber intervals independently', async () => {
    const fast = vi.fn(); const slow = vi.fn(); observer.register('fast', fast, 10); observer.register('slow', slow, 100);
    instances[0].deliver(); instances[0].deliver(); expect(instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10); expect(fast).toHaveBeenCalledOnce(); expect(slow).not.toHaveBeenCalled();
    instances[0].deliver(); await vi.advanceTimersByTimeAsync(90); expect(fast).toHaveBeenCalledTimes(2); expect(slow).toHaveBeenCalledOnce();
  });
  it('does not schedule full scans for irrelevant mutations and catches subtree insertion', () => {
    const callback = vi.fn(); observer.register('filtered', callback, 10, mutationsMatchSelector('.relevant'));
    const alreadyPresent = document.createElement('aside'); alreadyPresent.className = 'relevant'; document.body.append(alreadyPresent);
    instances[0].deliver(appendRecords(document.createElement('section'))); expect(vi.getTimerCount()).toBe(0);
    const wrapper = document.createElement('section'); wrapper.innerHTML = '<div class="relevant"><span>Inserted</span></div>';
    instances[0].deliver(appendRecords(wrapper)); vi.runAllTimers(); expect(callback).toHaveBeenCalledOnce();
  });
  it('matches nested text/removal changes and isolates throwing filters', () => {
    const element = document.createElement('section'); element.className = 'relevant'; element.innerHTML = '<span>Before</span>'; document.body.append(element);
    const collector = new NativeObserver(() => {}); collector.observe(element, { childList: true, subtree: true }); element.querySelector('span')!.textContent = 'After';
    const records = collector.takeRecords(); collector.disconnect(); expect(mutationsMatchSelector('.relevant')(records)).toBe(true);
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {}); const healthy = vi.fn();
    observer.register('bad-filter', vi.fn(), 10, () => { throw new Error('Filter failed'); }); observer.register('healthy', healthy, 10);
    instances[0].deliver(records); vi.runAllTimers(); expect(healthy).toHaveBeenCalledOnce(); expect(errorLog).toHaveBeenCalled();
  });
  it('does not let a replaced timer delete or invoke the new registration', () => {
    const pending: Array<() => void> = [];
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler) => { pending.push(() => { if (typeof handler === 'function') handler(); }); return pending.length; }) as unknown as typeof window.setTimeout);
    const old = vi.fn(); const current = vi.fn(); observer.register('same', old); instances[0].deliver();
    observer.register('same', current); instances[1].deliver(); pending[0](); expect(old).not.toHaveBeenCalled(); expect(current).not.toHaveBeenCalled();
    pending[1](); expect(current).toHaveBeenCalledOnce();
  });
});
