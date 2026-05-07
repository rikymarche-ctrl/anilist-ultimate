/**
 * @file PillUIBuilder.ts
 * @description Centralized builder for Astra action pills.
 */

import { injectable } from 'tsyringe';

/**
 * Options for pill building
 */
export interface PillOptions {
  mediaId: number;
  isUserListCard: boolean;
  socialEnabled: boolean;
  socialShowAvatars: boolean;
  score: number | null;
  astraEnabled: boolean;
}

@injectable()
export class PillUIBuilder {
  /**
   * Builds the HTML structure for an Astra pill
   */
  public build(options: PillOptions): string {
    const { isUserListCard, socialEnabled, score, astraEnabled } = options;
    
    const ratingHTML = astraEnabled ? `
      <div class="pill-section" data-action="edit-entry" title="Astra Rating">
        <i class="fa-solid fa-star"></i>
        <span class="score-value">${score !== null ? score.toFixed(1) : '-'}</span>
      </div>
    ` : '';

    const markWatchedHTML = isUserListCard ? `
      <div class="pill-section" data-action="mark-watched" title="Increment Progress">
        <i class="fa-solid fa-plus"></i>
      </div>
    ` : '';

    const socialHTML = socialEnabled ? `
      <div class="pill-section" data-action="social-activity" title="Social Activity">
        <i class="fa-solid fa-users"></i>
      </div>
    ` : '';

    // Add separator if we have multiple sections
    const sections = [ratingHTML, markWatchedHTML, socialHTML].filter(h => h !== '');
    
    return `
      <div class="action-pill" style="z-index: 1000 !important; pointer-events: auto !important;">
        ${sections.join('<div class="pill-separator" aria-hidden="true"></div>')}
      </div>
    `;
  }

  /**
   * Injects the pill into a target element
   */
  public inject(container: HTMLElement, options: PillOptions): HTMLElement {
    // Ensure container can hold absolute positioned pill
    const style = window.getComputedStyle(container);
    if (style.position === 'static') {
      container.style.position = 'relative';
    }
    
    // Safety: ensure pill is not hidden by container overflow
    container.style.overflow = 'visible';

    const wrapper = document.createElement('div');
    wrapper.className = 'au-pill-wrapper';
    wrapper.setAttribute('data-au-media-id', String(options.mediaId));
    wrapper.style.zIndex = '999'; // Triple safety
    wrapper.innerHTML = this.build(options);
    
    container.appendChild(wrapper);
    return wrapper;
  }
}
