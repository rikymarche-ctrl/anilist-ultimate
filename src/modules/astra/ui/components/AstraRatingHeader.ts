/**
 * @file AstraRatingHeader.ts
 * @description Specialized header component for the Astra Rating Modal
 */

import { AstraView } from '../base/AstraView';

interface HeaderState {
  mediaId: number;
  title: string;
  manualOverride: boolean;
  isSeriesFinale: boolean;
  showFinale: boolean;
  onOverrideToggle: (active: boolean) => void;
  onFinaleToggle: () => void;
  onClose: () => void;
}

export class AstraRatingHeader extends AstraView {
  private state: HeaderState | null = null;

  protected template(state: HeaderState): string {
    this.state = state;
    return `
      <header class="astra-modal-header astra-rating-header">
        <div class="astra-header-main">
          <div class="astra-header-left">
            <div class="astra-header-title-box">
              <h2 class="astra-header-title">
                <a href="https://anilist.co/anime/${state.mediaId}" target="_blank" class="astra-title-link">${state.title}</a>
              </h2>
              <div class="astra-header-meta">
                ${state.manualOverride ? '<span class="astra-meta-badge astra-meta-badge--warning"><i class="fa fa-exclamation-triangle"></i> Manual Override</span>' : ''}
                ${state.isSeriesFinale ? `<span class="astra-meta-badge astra-meta-badge--success ${state.manualOverride ? 'astra-meta-badge--disabled' : ''}"><i class="fa fa-flag-checkered"></i> Series Finale</span>` : ''}
              </div>
            </div>
            
            <div class="astra-header-actions">
              <div class="astra-control-group">
                 <label class="astra-toggle-pill" title="Manual Score Override">
                   <input type="checkbox" id="header-override-cb" ${state.manualOverride ? 'checked' : ''}>
                   <div class="astra-toggle-track">
                     <div class="astra-toggle-thumb"></div>
                     <span class="astra-toggle-label">OVERRIDE</span>
                   </div>
                 </label>

                 ${state.showFinale ? `
                 <button class="astra-finale-pill ${state.isSeriesFinale ? 'active' : ''} ${state.manualOverride ? 'astra-disabled' : ''}" 
                   id="header-finale-btn" 
                   title="${state.manualOverride ? 'Cannot toggle finale during manual override' : 'Toggle Series Finale'}"
                   ${state.manualOverride ? 'disabled' : ''}>
                   <i class="fa fa-flag-checkered"></i>
                   <span>FINALE</span>
                 </button>
                 ` : ''}
              </div>
            </div>
          </div>
          
          <button class="astra-header-close" id="header-close-btn" title="Close">
            <i class="fa fa-times"></i>
          </button>
        </div>
      </header>
    `;
  }

  protected bindEvents(): void {
    if (!this.state) return;

    this.$('#header-override-cb')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.state?.onOverrideToggle(checked);
    });

    this.$('#header-finale-btn')?.addEventListener('click', () => {
      this.state?.onFinaleToggle();
    });

    this.$('#header-close-btn')?.addEventListener('click', () => {
      this.state?.onClose();
    });
  }
}
