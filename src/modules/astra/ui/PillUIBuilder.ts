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
}

@injectable()
export class PillUIBuilder {
  /**
   * Builds the HTML structure for an Astra pill
   */
  public build(options: PillOptions): string {
    const { isUserListCard } = options;
    const socialSectionHTML = `
      <div class="pill-section" data-action="social-activity" title="Social Activity">
        <i class="fa-solid fa-users"></i>
      </div>
    `;

    const markWatchedHTML = isUserListCard ? `
      <div class="pill-section" data-action="mark-watched" title="Increment Progress">
        <i class="fa-solid fa-plus"></i>
      </div>
    ` : '';

    return `
      <div class="action-pill">
        ${markWatchedHTML}
        <div class="pill-section" data-action="edit-entry" title="Quick Rate (Astra)">
          <i class="fa-solid fa-pen"></i>
        </div>
        ${socialSectionHTML}
      </div>
    `;
  }

  /**
   * Injects the pill into a target element
   */
  public inject(container: HTMLElement, options: PillOptions): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'au-pill-wrapper';
    wrapper.setAttribute('data-au-media-id', String(options.mediaId));
    wrapper.innerHTML = this.build(options);
    
    container.appendChild(wrapper);
    return wrapper;
  }
}
