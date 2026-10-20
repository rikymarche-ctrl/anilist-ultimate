import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AstraOverlayService } from './AstraOverlayService';
const services: AstraOverlayService[] = [];
type OverlayLifecycle = { remove(id: string): void; dispose(): void };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { for (const service of services.splice(0)) (service as unknown as OverlayLifecycle).dispose?.(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; document.body.style.overflow = ''; document.documentElement.style.overflow = ''; });
function setup() { const service = new AstraOverlayService(); services.push(service); return service; }
describe('Astra overlay lifecycle', () => {
  it('restores the previous overflow and priority only after the last overlay closes', async () => {
    document.body.style.setProperty('overflow', 'scroll', 'important');
    const service = setup(); service.create('dashboard'); service.create('other');
    service.hide('dashboard'); await vi.advanceTimersByTimeAsync(350); expect(document.body.style.overflow).toBe('hidden');
    service.hide('other'); await vi.advanceTimersByTimeAsync(350);
    expect(document.body.style.overflow).toBe('scroll'); expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });
  it('preserves a newer native overflow change', async () => {
    const service = setup(); service.create('dashboard'); document.body.style.setProperty('overflow', 'auto', 'important');
    service.hide('dashboard'); await vi.advanceTimersByTimeAsync(350);
    expect(document.body.style.overflow).toBe('auto'); expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });
  it('keeps scrolling locked until the rating modal and dashboard have both closed', async () => {
    const service = setup();
    service.acquireScrollLock('rating-modal'); service.create('dashboard');
    service.releaseScrollLock('rating-modal');
    expect(document.body.style.overflow).toBe('hidden'); expect(document.documentElement.style.overflow).toBe('hidden');
    service.hide('dashboard'); await vi.advanceTimersByTimeAsync(350);
    expect(document.body.style.overflow).toBe(''); expect(document.documentElement.style.overflow).toBe('');
  });
  it('cancels hide and pending frame ownership when an overlay is removed and recreated', async () => {
    const service = setup(); const first = service.create('dashboard'); const oldClose = vi.fn();
    service.show('dashboard'); service.hide('dashboard', oldClose);
    (service as unknown as OverlayLifecycle).remove('dashboard'); const current = service.create('dashboard'); service.show('dashboard');
    await vi.runAllTimersAsync(); expect(current.isConnected).toBe(true); expect(first.isConnected).toBe(false);
    expect(current.classList.contains('astra-modal-overlay--open')).toBe(true); expect(first.classList.contains('astra-modal-overlay--open')).toBe(false);
    expect(oldClose).not.toHaveBeenCalled();
  });
  it('does not run repeated hide callbacks or let an old hide remove a reopened overlay', async () => {
    const service = setup(); const overlay = service.create('dashboard'); const completed = vi.fn();
    service.hide('dashboard', completed); service.hide('dashboard', completed); service.show('dashboard');
    await vi.runAllTimersAsync(); expect(completed).not.toHaveBeenCalled(); expect(overlay.isConnected).toBe(true);
  });
  it('makes copied timeout and frame callbacks inert after removal and recreation', () => {
    const service = setup(); const timers = vi.spyOn(globalThis, 'setTimeout'); const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    const old = service.create('dashboard'); const completed = vi.fn(); service.show('dashboard'); service.hide('dashboard', completed);
    const oldTimer = timers.mock.calls.find(call => call[1] === 350)?.[0]; const oldFrame = frames.mock.calls[0][0];
    (service as unknown as OverlayLifecycle).remove('dashboard'); const current = service.create('dashboard');
    if (typeof oldTimer === 'function') oldTimer(); oldFrame(0);
    expect(current.isConnected).toBe(true); expect(old.classList.contains('astra-modal-overlay--open')).toBe(false); expect(completed).not.toHaveBeenCalled();
  });
  it('disposes overlays, frames, timers and scroll lock once, then rejects new creation', async () => {
    const service = setup(); service.create('dashboard'); service.show('dashboard'); service.hide('dashboard');
    (service as unknown as OverlayLifecycle).dispose(); (service as unknown as OverlayLifecycle).dispose(); await vi.runAllTimersAsync();
    expect(document.querySelector('.astra-modal-overlay')).toBeNull(); expect(document.body.style.overflow).toBe(''); expect(vi.getTimerCount()).toBe(0);
    expect(() => service.create('dashboard')).toThrow();
  });
});
