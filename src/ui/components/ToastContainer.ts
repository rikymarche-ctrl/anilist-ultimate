/**
 * Toast Container Component
 * Manages the stack of notifications
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
  public addToast(props: Omit<ToastProps, 'onClose'>): void {
    if (this.toasts.has(props.id)) return;

    const toast = new Toast({
      ...props,
      onClose: (id) => this.removeToast(id)
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
