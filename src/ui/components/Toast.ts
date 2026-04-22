/**
 * Toast Component
 * Individual notification item
 */

import { BaseComponent } from './BaseComponent';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  onClose: (id: string) => void;
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
        ${title ? `<span class="au-toast__title">${title}</span>` : ''}
        <div class="au-toast__message">${message}</div>
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
