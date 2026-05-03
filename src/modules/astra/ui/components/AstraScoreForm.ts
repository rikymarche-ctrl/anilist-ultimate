/**
 * @file AstraScoreForm.ts
 * @description The main multi-criteria rating form component
 */

import { AstraView } from '../base/AstraView';
import { AstraService, AstraWork, AstraSection } from '../../AstraService';
import { MediaListStatus } from '@/api/AnilistTypes';

export class AstraScoreForm extends AstraView {
  constructor(private service: AstraService) {
    super({});
  }

  protected template(state: { work: AstraWork, seasonIdx: number }): string {
    const { work, seasonIdx } = state;
    const season = work.seasons[seasonIdx];
    const sections = this.service.getSections();
    const overallScore = this.service.calcSeasonOverall(season.scores, season.skip, season.isSeriesFinale);

    return `
      <div class="astra-score-form-layout">
        <div class="astra-rating-scroll-area">
          <div class="astra-quick-status-row">
             ${this.renderStatusSelect(work.status)}
             <div class="astra-score-preview-pill">
               <span class="label">Overall</span>
               <span class="value" id="astra-live-score">${overallScore ? overallScore.toFixed(2) : '—'}</span>
             </div>
          </div>

          <div class="astra-sections-grid">
            ${sections.map(s => this.renderSection(s, season.scores)).join('')}
          </div>

          <div class="astra-notes-wrapper">
            <span class="astra-label-xs">SEASON NOTES</span>
            <textarea id="astra-season-notes" placeholder="How was this season?">${season.notes || ''}</textarea>
          </div>
        </div>

        <div class="astra-rating-actions">
           <button class="astra-btn astra-btn--primary astra-btn--full" id="astra-save-btn">
             <i class="fa fa-save"></i> Save Changes
           </button>
        </div>
      </div>
    `;
  }

  private renderStatusSelect(current: MediaListStatus): string {
    return `
      <div class="astra-status-box">
        <select class="astra-select-v2" id="astra-work-status">
          <option value="${MediaListStatus.CURRENT}" ${current === MediaListStatus.CURRENT ? 'selected' : ''}>Watching</option>
          <option value="${MediaListStatus.COMPLETED}" ${current === MediaListStatus.COMPLETED ? 'selected' : ''}>Completed</option>
          <option value="${MediaListStatus.PLANNING}" ${current === MediaListStatus.PLANNING ? 'selected' : ''}>Planning</option>
          <option value="${MediaListStatus.DROPPED}" ${current === MediaListStatus.DROPPED ? 'selected' : ''}>Dropped</option>
        </select>
      </div>
    `;
  }

  private renderSection(section: AstraSection, scores: Record<string, number | null>): string {
    const score = scores[section.id] || 0;
    return `
      <div class="astra-score-card" data-section-id="${section.id}">
        <div class="astra-score-info">
          <span class="name">${section.name}</span>
          <span class="val" id="val-${section.id}">${score > 0 ? score.toFixed(1) : '—'}</span>
        </div>
        <div class="astra-slider-container">
          <input type="range" class="astra-range" min="0" max="10" step="0.5" value="${score}" data-id="${section.id}">
        </div>
      </div>
    `;
  }

  protected bindEvents(): void {
    this.$$('.astra-range').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const id = target.dataset.id;
        const val = parseFloat(target.value);
        
        const display = this.$(`#val-${id}`);
        if (display) display.textContent = val > 0 ? val.toFixed(1) : '—';
        
        this.onScoreChange(id!, val);
      });
    });
  }

  private onScoreChange(sectionId: string, value: number): void {
     // Notify controller or update store
     window.dispatchEvent(new CustomEvent('astra-live-score-update', {
       detail: { sectionId, value }
     }));
  }
}
