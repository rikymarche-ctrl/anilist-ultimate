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
import { html } from '@core/utils/Template';
import { logger } from '@core/logger';

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
  onSaveNote?: (mediaId: number, note: string) => Promise<void>;
}

export class Toast extends BaseComponent<ToastProps> {
  private timer?: number;
  private startTime?: number;
  private remaining?: number;
  private closeTimer?: number;
  private savedTimer?: number;
  private generation = 0;
  private isSaving = false;
  private dismissing = false;

  protected render(): HTMLElement {
    const { type, title, message, duration, mediaId } = this.props;
    const iconClass = this.getIconClass(type);

    return html`
      <div class="au-toast au-toast--${type}" data-toast-id="${this.props.id}">
        <div class="au-toast__icon">
          <i class="${iconClass}"></i>
        </div>
        <div class="au-toast__content">
          <div class="au-toast__body">
            ${title ? html`<span class="au-toast__title">${title}</span>` : ''}
            <div class="au-toast__message">${message}</div>
          </div>
          ${mediaId ? html`
            <div class="au-toast__actions">
              <div class="au-toast__note-field">
                <input type="text" class="au-toast__note-input" id="toast-note-${this.props.id}" placeholder="Quick Note..." />
                <button class="au-toast__note-save" id="toast-save-${this.props.id}" title="Save Note">
                  <i class="fa-solid fa-paper-plane"></i>
                </button>
              </div>
            </div>
          ` : ''}
        </div>
        <button class="au-toast__close" aria-label="Close" id="toast-close-${this.props.id}">
          <i class="fa-solid fa-xmark"></i>
        </button>
        ${duration ? html`<div class="au-toast__progress"></div>` : ''}
      </div>
    `;
  }

  private getIconClass(type: ToastType): string {
    switch (type) {
      case 'success': return 'fa-solid fa-circle-check';
      case 'warning': return 'fa-solid fa-triangle-exclamation';
      case 'error': return 'fa-solid fa-circle-exclamation';
      default: return 'fa-solid fa-circle-info';
    }
  }

  protected attachEvents(): void {
    const closeBtn = this.$(`#toast-close-${this.props.id}`);
    if (closeBtn) {
      this.addEventListener(closeBtn as HTMLElement, 'click', () => {
        this.dismiss();
      });
    }

    // Pause on hover
    this.addEventListener(this.element, 'mouseenter', () => this.pauseTimer());
    this.addEventListener(this.element, 'mouseleave', () => {
      if (!this.isPausedByInput()) {
        this.resumeTimer();
      }
    });

    // Note input events
    if (this.props.mediaId) {
      const input = this.$(`#toast-note-${this.props.id}`) as HTMLInputElement;
      const saveBtn = this.$(`#toast-save-${this.props.id}`);

      if (input && saveBtn) {
        const handleSave = async () => {
          const note = input.value.trim();
          if (!note || !this.props.onSaveNote || this.isSaving || this.dismissing || !this.mounted) return;
          const generation = this.generation;
          this.isSaving = true;
          this.pauseTimer();

          try {
            input.disabled = true;
            (saveBtn as HTMLButtonElement).disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            await this.props.onSaveNote(this.props.mediaId!, note);
            if (!this.mounted || generation !== this.generation) return;
            
            saveBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--au-success)"></i>';
            input.placeholder = 'Saved!';
            input.value = '';
            
            // Re-enable and auto-dismiss quickly after saving
            this.savedTimer = window.setTimeout(() => this.dismiss(), 500);
          } catch {
            if (!this.mounted || generation !== this.generation) return;
            // Keep the note for retry and show the failure on the button.
            this.isSaving = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: var(--au-error)"></i>';
            saveBtn.setAttribute('title', 'Save failed. Try again.');
            input.disabled = false;
            (saveBtn as HTMLButtonElement).disabled = false;
            // Resume auto-dismiss, but not under a pointer that is still hovering (pause-on-hover).
            if (!this.element.matches(':hover')) this.resumeTimer();
          } finally {
            if (generation === this.generation) this.isSaving = false;
          }
        };

        this.addEventListener(input, 'focus', () => this.pauseTimer());
        this.addEventListener(input, 'blur', () => {
          // Only resume if mouse is also not over the toast
          const isHovered = this.element.matches(':hover');
          if (!isHovered) {
            this.resumeTimer();
          }
        });

        this.addEventListener(input, 'keypress', (e: Event) => {
          if ((e as KeyboardEvent).key === 'Enter') void handleSave().catch((error: unknown) => logger.error('[Toast] Save failed', error));
        });

        this.addEventListener(saveBtn as HTMLElement, 'click', () => {
          void handleSave().catch((error: unknown) => logger.error('[Toast] Save failed', error));
        });

        // Stop propagation of clicks in the input field to prevent auto-dismiss/pause issues if needed
        this.addEventListener(input, 'click', (e) => e.stopPropagation());
      }
    }
  }

  private isPausedByInput(): boolean {
    const input = this.$('.au-toast__note-input') as HTMLInputElement;
    return input === document.activeElement;
  }

  protected onMount(): void {
    this.dismissing = false;
    if (this.props.duration) {
      this.remaining = this.props.duration;
      this.resumeTimer();
      this.startProgressAnimation();
    }
  }

  protected override onUnmount(): void {
    this.generation++;
    this.isSaving = false;
    for (const timer of [this.timer, this.closeTimer, this.savedTimer]) {
      if (timer !== undefined) window.clearTimeout(timer);
    }
    this.timer = this.closeTimer = this.savedTimer = undefined;
  }

  private dismiss(): void {
    if (!this.mounted || this.dismissing) return;
    this.dismissing = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    if (this.savedTimer !== undefined) window.clearTimeout(this.savedTimer);
    this.timer = this.savedTimer = undefined;
    this.element.classList.add('au-toast--out');
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = undefined;
      this.props.onClose(this.props.id);
    }, 400); // Match animation duration
  }

  private pauseTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
      if (this.startTime !== undefined) {
        this.remaining! -= Date.now() - this.startTime;
      }
      
      const progress = this.$('.au-toast__progress') as HTMLElement;
      if (progress) {
        progress.style.animationPlayState = 'paused';
      }
    }
  }

  private resumeTimer(): void {
    if (!this.mounted || this.isPausedByInput() || this.timer !== undefined || this.isSaving || this.dismissing) return;
    
    if (this.props.duration && this.remaining! > 0) {
      this.startTime = Date.now();
      this.timer = window.setTimeout(() => this.dismiss(), this.remaining);
      
      const progress = this.$('.au-toast__progress') as HTMLElement;
      if (progress) {
        progress.style.animationPlayState = 'running';
      }
    }
  }

  private startProgressAnimation(): void {
    const progress = this.$('.au-toast__progress') as HTMLElement;
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
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(style);
  }
}
