/**
 * @file Toast.ts
 * @description Individual toast notification component with auto-dismiss
 *
 * Renders a typed notification (success, error, info, warning) with
 * title, message, close button, and configurable auto-dismiss timer.
 * Supports pause-on-hover to prevent dismissal during user interaction.
 *
 * @see ToastContainer.ts for the parent stack manager
 * @see ToastService.ts for the programmatic API
 */

import { BaseComponent } from './BaseComponent';
import { escapeHtml } from '@core/utils/Template';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  mediaId?: number;
  progress?: number;
  onClose: (id: string) => void;
  onSaveNote?: (mediaId: number, note: string) => Promise<any>;
}

export class Toast extends BaseComponent<ToastProps> {
  private timer?: number;
  private startTime?: number;
  private remaining?: number;

  protected render(): HTMLElement {
    const { type, title, message, duration } = this.props;

    const toast = this.createElement('div', {
      class: `au-toast au-toast--${type}`,
      'data-toast-id': this.props.id
    });

    const iconClass = this.getIconClass(type);

    toast.innerHTML = `
      <div class="au-toast__icon">
        <i class="${iconClass}"></i>
      </div>
      <div class="au-toast__content">
        <div class="au-toast__body">
          ${title ? `<span class="au-toast__title">${escapeHtml(title)}</span>` : ''}
          <div class="au-toast__message">${escapeHtml(message)}</div>
        </div>
        ${this.props.mediaId ? `
          <div class="au-toast__actions">
            <div class="au-toast__note-field">
              <input type="text" class="au-toast__note-input" placeholder="Quick Note..." />
              <button class="au-toast__note-save" title="Save Note">
                <i class="fa fa-paper-plane"></i>
              </button>
            </div>
          </div>
        ` : ''}
      </div>
      <button class="au-toast__close" aria-label="Close">
        <i class="fa fa-times"></i>
      </button>
      ${duration ? '<div class="au-toast__progress"></div>' : ''}
    `;

    return toast;
  }

  private getIconClass(type: ToastType): string {
    switch (type) {
      case 'success': return 'fa fa-check-circle';
      case 'warning': return 'fa fa-exclamation-triangle';
      case 'error': return 'fa fa-exclamation-circle';
      default: return 'fa fa-info-circle';
    }
  }

  protected attachEvents(): void {
    const closeBtn = this.querySelector('.au-toast__close');
    if (closeBtn) {
      this.addEventListener(closeBtn as HTMLElement, 'click', () => {
        this.dismiss();
      });
    }

    // Pause on hover
    this.addEventListener(this.element, 'mouseenter', () => this.pauseTimer());
    this.addEventListener(this.element, 'mouseleave', () => this.resumeTimer());

    // Note input events
    if (this.props.mediaId) {
      const input = this.querySelector('.au-toast__note-input') as HTMLInputElement;
      const saveBtn = this.querySelector('.au-toast__note-save');

      if (input && saveBtn) {
        const handleSave = async () => {
          const note = input.value.trim();
          if (!note || !this.props.onSaveNote) return;

          try {
            input.disabled = true;
            (saveBtn as HTMLButtonElement).disabled = true;
            saveBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
            
            await this.props.onSaveNote(this.props.mediaId!, note);
            
            saveBtn.innerHTML = '<i class="fa fa-check" style="color: var(--au-success)"></i>';
            input.placeholder = 'Saved!';
            input.value = '';
            
            // Re-enable and auto-dismiss after a short delay
            setTimeout(() => this.dismiss(), 1500);
          } catch (e) {
            saveBtn.innerHTML = '<i class="fa fa-paper-plane"></i>';
            input.disabled = false;
            (saveBtn as HTMLButtonElement).disabled = false;
          }
        };

        this.addEventListener(input, 'keypress', (e) => {
          if (e.key === 'Enter') handleSave();
        });

        this.addEventListener(saveBtn as HTMLElement, 'click', handleSave);

        // Stop propagation of clicks in the input field to prevent auto-dismiss/pause issues if needed
        this.addEventListener(input, 'click', (e) => e.stopPropagation());
      }
    }
  }

  protected onMount(): void {
    if (this.props.duration) {
      this.remaining = this.props.duration;
      this.resumeTimer();
      this.startProgressAnimation();
    }
  }

  private dismiss(): void {
    this.element.classList.add('au-toast--out');
    setTimeout(() => {
      this.props.onClose(this.props.id);
    }, 400); // Match animation duration
  }

  private pauseTimer(): void {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
      if (this.startTime) {
        this.remaining! -= Date.now() - this.startTime;
      }
      
      const progress = this.querySelector('.au-toast__progress') as HTMLElement;
      if (progress) {
        progress.style.animationPlayState = 'paused';
      }
    }
  }

  private resumeTimer(): void {
    if (this.props.duration && this.remaining! > 0) {
      this.startTime = Date.now();
      this.timer = window.setTimeout(() => this.dismiss(), this.remaining);
      
      const progress = this.querySelector('.au-toast__progress') as HTMLElement;
      if (progress) {
        progress.style.animationPlayState = 'running';
      }
    }
  }

  private startProgressAnimation(): void {
    const progress = this.querySelector('.au-toast__progress') as HTMLElement;
    if (progress && this.props.duration) {
      progress.style.animation = `au-toast-progress ${this.props.duration}ms linear forwards`;
    }
  }
}

// Add keyframes for progress bar via JS since it's dynamic
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes au-toast-progress {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
  `;
  document.head.appendChild(style);
}
