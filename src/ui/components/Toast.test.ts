import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';
import { ToastContainer } from './ToastContainer';
import { BaseComponent } from './BaseComponent';

describe('toast lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });
  function fixture(duration = 1000, onSaveNote?: (mediaId: number, note: string) => Promise<void>) {
    const close = vi.fn(); const toast = new Toast({ id: 'test', type: 'info', message: 'Message', duration, mediaId: onSaveNote ? 1 : undefined, onSaveNote, onClose: close });
    toast.mount(document.body); return { toast, element: toast.getElement(), close };
  }

  it('does not multiply auto-dismiss timers on repeated mouseleave and closes once', async () => {
    const { toast, element, close } = fixture();
    element.dispatchEvent(new Event('mouseleave')); element.dispatchEvent(new Event('mouseleave'));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); element.querySelector<HTMLButtonElement>('.au-toast__close')!.click();
    await vi.advanceTimersByTimeAsync(400); expect(close).toHaveBeenCalledOnce(); toast.unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it('counts hover pause correctly even when the timer started at zero', async () => {
    const { toast, element, close } = fixture(); await vi.advanceTimersByTimeAsync(400);
    element.dispatchEvent(new Event('mouseenter')); await vi.advanceTimersByTimeAsync(1000);
    element.dispatchEvent(new Event('mouseleave')); await vi.advanceTimersByTimeAsync(599); expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(401); expect(close).toHaveBeenCalledOnce(); toast.unmount();
  });

  it('serializes note submission and ignores its completion after unmount', async () => {
    let resolve!: () => void; const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const { toast, element, close } = fixture(1000, save); const input = element.querySelector<HTMLInputElement>('input')!;
    input.value = 'Keep this'; const button = element.querySelector<HTMLButtonElement>('.au-toast__note-save')!;
    button.click(); input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    expect(save).toHaveBeenCalledOnce(); toast.unmount(); resolve(); await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe('Keep this'); expect(vi.getTimerCount()).toBe(0); expect(close).not.toHaveBeenCalled();
  });

  it('preserves a note and allows retry after a save failure', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { toast, element } = fixture(1000, save); const input = element.querySelector<HTMLInputElement>('input')!;
    const button = element.querySelector<HTMLButtonElement>('.au-toast__note-save')!; input.value = 'Keep'; button.click();
    await Promise.resolve(); await Promise.resolve(); expect(input.disabled).toBe(false); expect(input.value).toBe('Keep');
    button.click(); await Promise.resolve(); await Promise.resolve(); expect(save).toHaveBeenCalledTimes(2); expect(input.value).toBe('');
    toast.unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a failed save on the button and resumes auto-dismiss', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const { toast, element, close } = fixture(1000, save); const input = element.querySelector<HTMLInputElement>('input')!;
    const button = element.querySelector<HTMLButtonElement>('.au-toast__note-save')!; input.value = 'Keep';
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(button.querySelector('.fa-circle-exclamation')).not.toBeNull(); expect(button.title).toBe('Save failed. Try again.');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); await vi.advanceTimersByTimeAsync(400);
    expect(close).toHaveBeenCalledOnce(); toast.unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps auto-dismiss paused after a failed save while the pointer is still over the toast', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const { toast, element, close } = fixture(1000, save); const input = element.querySelector<HTMLInputElement>('input')!;
    const button = element.querySelector<HTMLButtonElement>('.au-toast__note-save')!; input.value = 'Keep';
    element.dispatchEvent(new Event('mouseenter')); button.click();
    await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000); expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    element.dispatchEvent(new Event('mouseleave')); await vi.advanceTimersByTimeAsync(1400);
    expect(close).toHaveBeenCalledOnce(); toast.unmount();
  });

  it('unmounting the stack also cancels all child timers', () => {
    const container = new ToastContainer({}); container.mount(document.body);
    container.addToast({ id: 'a', type: 'info', message: 'One', duration: 1000 });
    container.addToast({ id: 'b', type: 'info', message: 'Two', duration: 2000 });
    expect(vi.getTimerCount()).toBe(2); container.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('BaseComponent event cleanup', () => {
  afterEach(() => { document.body.replaceChildren(); });
  it('removes listeners registered in the capture phase', () => {
    const listener = vi.fn();
    class Component extends BaseComponent {
      protected render() { return document.createElement('div'); }
      protected attachEvents() { this.addEventListener(document, 'click', listener, { capture: true }); }
    }
    const component = new Component({}); component.mount(document.body); component.unmount(); document.body.click();
    expect(listener).not.toHaveBeenCalled();
  });
});
