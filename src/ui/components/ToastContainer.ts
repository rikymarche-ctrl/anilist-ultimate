/**
 * @file ToastContainer.ts
 * @description Fixed-position container managing a stack of Toast components
 *
 * Mounts to document.body, manages add/remove of individual Toast
 * instances, and handles stacking order (newest on top).
 *
 * @see Toast.ts for individual toast rendering
 * @see ToastService.ts for the service layer
 */

import { BaseComponent } from './BaseComponent';
import { Toast, type ToastProps } from './Toast';

export class ToastContainer extends BaseComponent {
  private toasts = new Map<string, Toast>();

  protected render(): HTMLElement {
    return this.createElement('div', { class: 'au-toast-container' });
  }

  /**
   * Add a new toast to the container
   */
  public addToast(props: Omit<ToastProps, 'onClose' | 'onSaveNote'>, onSaveNote?: (mediaId: number, note: string) => Promise<any>): void {
    if (this.toasts.has(props.id)) return;

    const toast = new Toast({
      ...props,
      onClose: (id) => this.removeToast(id),
      onSaveNote
    });

    this.toasts.set(props.id, toast);
    toast.mount(this.element);
  }

  /**
   * Remove a toast from the container
   */
  public removeToast(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.unmount();
      this.toasts.delete(id);
    }
  }

  /**
   * Clear all toasts
   */
  public clear(): void {
    this.toasts.forEach(toast => toast.unmount());
    this.toasts.clear();
  }
}
