/**
 * @file CommentTooltip.ts
 * @description Hoverable tooltip component displaying user notes with secure templates
 */

import { injectable } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { html } from '@core/utils/Template';

export interface UserComment {
  username: string;
  notes: string;
  mediaId: number;
  timestamp: number;
}

@injectable()
export class CommentTooltip extends BaseComponent<{ onRefresh?: () => void }> {
  private currentComment: UserComment | null = null;
  private currentTarget: HTMLElement | null = null;
  private hideTimer: number | null = null;
  private hoverStates = { icon: false, tooltip: false };

  constructor() {
    super({});
  }

  protected render(): HTMLElement {
    return html`
      <div id="anilist-tooltip" class="au-comment-tooltip">
        <div class="tooltip-header">
          <span class="tooltip-user">Loading...</span>
        </div>
        <div class="tooltip-content body-text">...</div>
      </div>
    `;
  }

  public show(element: HTMLElement, comment: UserComment): void {
    this.currentComment = comment;
    this.currentTarget = element;
    this.updateContent();

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.hoverStates.icon = true;
    this.element.classList.add('visible');
    this.updatePosition(element);
  }

  public hide(): void {
    this.element.classList.remove('visible');
    this.hoverStates.icon = false;
    this.hoverStates.tooltip = false;
    this.currentTarget = null;
  }

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (!this.hoverStates.icon && !this.hoverStates.tooltip) {
        this.hide();
      }
    }, 2000);
  }

  public onIconLeave(): void {
    this.hoverStates.icon = false;
    this.scheduleHide();
  }

  public updateContent(comment?: UserComment): void {
    if (comment) this.currentComment = comment;
    if (!this.currentComment) return;

    const { username, notes } = this.currentComment;
    const formattedNotes = this.formatNotes(notes);

    this.element.innerHTML = '';
    this.element.appendChild(html`
      <div style="display: contents;">
        <div class="tooltip-header">
          <span class="tooltip-user">${username}</span>
        </div>
        <div class="tooltip-content body-text">
          ${formattedNotes || html`<span class="no-comment">No notes for this series.</span>`}
        </div>
      </div>
    `);
  }

  private updatePosition(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tooltipHeight = this.element.offsetHeight || 500;
    const viewportHeight = window.innerHeight;

    let top = Math.max(rect.top, 100);
    if (top + tooltipHeight > viewportHeight - 20) {
      top = Math.max(viewportHeight - tooltipHeight - 20, 20);
    }

    this.element.style.position = 'fixed';
    this.element.style.right = '6px';
    this.element.style.top = `${top}px`;
    this.element.style.left = 'auto';
    this.element.style.transform = 'none';
  }

  private formatNotes(notes: string): HTMLElement | string {
    if (!notes) return '';

    const container = document.createElement('div');
    const lines = notes.split('\n');

    lines.forEach((line, index) => {
      const span = document.createElement('span');
      // Simple text content is safe
      span.textContent = line;
      container.appendChild(span);

      if (index < lines.length - 1) {
        container.appendChild(document.createElement('br'));
      }
    });

    return container;
  }

  protected attachEvents(): void {
    this.addEventListener(this.element, 'mouseenter', () => {
      this.hoverStates.tooltip = true;
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    });

    this.addEventListener(this.element, 'mouseleave', () => {
      this.hoverStates.tooltip = false;
      this.scheduleHide();
    });

    // Managed listener: BaseComponent removes it on unmount/destroy.
    this.addEventListener(window, 'resize', () => {
      if (this.element.classList.contains('visible') && this.currentTarget) {
        this.updatePosition(this.currentTarget);
      }
    });
  }
}
