/**
 * @file CommentTooltip.ts
 * @description Hoverable tooltip component displaying user notes with markdown
 *
 * Renders a fixed-position tooltip on the right side of the viewport
 * when a comment icon is hovered. Features auto-hide timer (2s),
 * markdown-to-HTML parsing, and hover-persistence (stays visible
 * while either icon or tooltip is hovered).
 *
 * @security Username is escaped with escapeHtml() before insertion (BUG-003 fixed).
 *
 * @see CommentService.ts for data fetching
 * @see docs/MODULES.md#6-hover-comments-module
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { escapeHtml } from '@core/utils/Template';
import { UserComment } from '../social/CommentService';

interface CommentTooltipProps {
  onRefresh: () => void;
}

export class CommentTooltip extends BaseComponent<CommentTooltipProps> {
  private currentComment: UserComment | null = null;
  private hideTimer: number | null = null;
  private hoverStates = { icon: false, tooltip: false };

  protected render(): HTMLElement {
    const tooltip = this.createElement('div', { id: 'anilist-tooltip' });
    
    // Initial empty state
    tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-user">Loading...</span>
      </div>
      <div class="tooltip-content body-text">...</div>
    `;

    return tooltip;
  }

  public show(element: HTMLElement, comment: UserComment): void {
    this.currentComment = comment;
    this.updateContent();

    // Clear any pending hide timer
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
  }

  public scheduleHide(): void {
    // Clear any existing timer
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    // Hide after 2 seconds if not hovering icon or tooltip
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

    // Simplified header without timestamp and refresh button
    this.element.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-user">${escapeHtml(username)}</span>
      </div>
      <div class="tooltip-content body-text">${formattedNotes || '<span class="no-comment">No notes for this series.</span>'}</div>
    `;
  }

  private updatePosition(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tooltipHeight = this.element.offsetHeight || 500;
    const viewportHeight = window.innerHeight;

    // Calculate vertical position
    let top = Math.max(rect.top, 100); // Don't go too high

    // Prevent tooltip from going off-screen at the bottom
    if (top + tooltipHeight > viewportHeight - 20) {
      top = Math.max(viewportHeight - tooltipHeight - 20, 20);
    }

    // Position tooltip in the right column (fixed position)
    this.element.style.position = 'fixed';
    this.element.style.right = '6px';
    this.element.style.top = `${top}px`;
    this.element.style.left = 'auto';
    this.element.style.transform = 'none';
  }

  private formatNotes(notes: string): string {
    if (!notes) return '';

    // Simple markdown parsing (similar to legacy but optimized)
    return notes
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/__(.*?)__/g, '<b>$1</b>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      .replace(/\n/g, '<br>');
  }

  protected attachEvents(): void {
    // Keep tooltip visible when mouse is inside
    this.addEventListener(this.element, 'mouseenter', () => {
      this.hoverStates.tooltip = true;
      // Clear any pending hide timer
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    });

    this.addEventListener(this.element, 'mouseleave', () => {
      this.hoverStates.tooltip = false;
      this.scheduleHide();
    });
  }
}
