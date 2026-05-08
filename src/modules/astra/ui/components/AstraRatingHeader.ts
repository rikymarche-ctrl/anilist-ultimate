/**
 * @file AstraRatingHeader.ts
 * @description Specialized header component for the Astra Rating Modal
 */

import { injectable } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { html } from '@core/utils/Template';

interface HeaderState {
  mediaId: number;
  title: string;
  manualOverride: boolean;
  isSeriesFinale: boolean;
  showFinale: boolean;
  onOverrideToggle: (active: boolean) => void;
  onFinaleToggle: () => void;
  onClose: () => void;
  activeTab?: string;
}

@injectable()
export class AstraRatingHeader extends AstraView {
  protected state: HeaderState | null = null;

  public getState(): HeaderState | null {
    return this.state;
  }

  protected template(state: HeaderState): HTMLElement {
    if (!state || !state.title) return html`<div></div>`;
    this.state = state;
    const isJournal = state.activeTab === 'journal';

    return html`
      <header class="astra-modal-header astra-rating-header">
        <div class="astra-header-main">
          <div class="astra-header-left">
            <div class="astra-header-title-box">
              <h2 class="astra-header-title">
                <a href="https://anilist.co/anime/${state.mediaId}" target="_blank" class="astra-title-link">${state.title}</a>
              </h2>
            </div>
          </div>

          <div class="astra-header-actions">
            ${!isJournal ? html`
            <div class="astra-control-group">
               <button class="astra-finale-pill astra-override-pill ${state.manualOverride ? 'active' : ''}" 
                 id="header-override-btn" 
                 title="Toggle Manual Score Override">
                 <i class="fa fa-exclamation-triangle"></i>
                 <span>OVERRIDE</span>
               </button>

               ${state.showFinale && !state.manualOverride ? html`
               <button class="astra-finale-pill ${state.isSeriesFinale ? 'active' : ''}" 
                 id="header-finale-btn" 
                 title="Toggle Series Finale">
                 <i class="fa fa-flag-checkered"></i>
                 <span>FINALE</span>
               </button>
               ` : ''}
            </div>
            ` : ''}
          </div>
          
          <div style="flex: 1;"></div>
        </div>
      </header>
    `;
  }

  protected bindEvents(): void {
    if (!this.state) return;

    this.$('#header-override-btn')?.addEventListener('click', () => {
      const active = !this.state?.manualOverride;
      this.state?.onOverrideToggle(active);
    });

    this.$('#header-finale-btn')?.addEventListener('click', () => {
      this.state?.onFinaleToggle();
    });
  }
}
