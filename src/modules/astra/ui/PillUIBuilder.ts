import { injectable } from 'tsyringe';
import { html } from '@core/utils/Template';

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
   * Builds the secure HTMLElement structure for an Astra pill
   */
  public build(options: PillOptions): HTMLElement {
    const { isUserListCard, socialEnabled, score, astraEnabled } = options;
    
    const markWatchedHTML = isUserListCard ? html`
      <div class="pill-section" data-action="mark-watched" title="Increment Progress">
        <i class="fa fa-plus"></i>
      </div>
    ` : null;

    const ratingHTML = astraEnabled ? html`
      <div class="pill-section" data-action="edit-entry" title="Astra Rating">
        <i class="fa fa-pencil"></i>
        ${score !== null ? html`<span class="score-value">${score.toFixed(1)}</span>` : ''}
      </div>
    ` : null;

    const socialHTML = socialEnabled ? html`
      <div class="pill-section" data-action="social-activity" title="Social Activity">
        <i class="fa fa-users"></i>
      </div>
    ` : null;

    // Filter out null sections
    const sections = [markWatchedHTML, ratingHTML, socialHTML].filter(s => s !== null) as HTMLElement[];
    
    const pill = html`
      <div class="action-pill" style="z-index: 1000 !important; pointer-events: auto !important;">
      </div>
    `;

    // Add sections with separators
    sections.forEach((section, index) => {
      pill.appendChild(section);
      if (index < sections.length - 1) {
        const separator = document.createElement('div');
        separator.className = 'pill-separator';
        separator.setAttribute('aria-hidden', 'true');
        pill.appendChild(separator);
      }
    });

    return pill;
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
    
    // Safety: ensure pill is not hidden by container overflow if it's explicitly hidden
    if (style.overflow === 'hidden') {
      container.style.overflow = 'visible';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'au-pill-wrapper';
    wrapper.setAttribute('data-au-media-id', String(options.mediaId));
    wrapper.style.zIndex = '3';
    
    const pill = this.build(options);
    wrapper.appendChild(pill);
    
    container.appendChild(wrapper);
    return wrapper;
  }
}
