/**
 * @file AstraScoreForm.ts
 * @description The main multi-criteria rating form component.
 * Uses EventBus for communication to adhere to decoupling standards.
 */

import { AstraView } from '../base/AstraView';
import { AstraService, AstraWork, AstraSection, AstraSeason, AstraSubSection } from '../../AstraService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { AstraRadarChart } from '../AstraRadarChart';
import type { IEventBus } from '@core/interfaces/IEventBus';

export interface ScoreFormState {
  work: AstraWork;
  seasonIdx: number;
  allCustomLists: string[];
  entry: any; // AniList entry data
}

/**
 * Enterprise-grade rating form component.
 * Orchestrates scoring inputs and dispatches events via a centralized EventBus.
 */
export class AstraScoreForm extends AstraView {
  private localState: ScoreFormState | null = null;

  constructor(
    private service: AstraService,
    private eventBus: IEventBus
  ) {
    super({});
  }

  protected template(state: ScoreFormState): string {
    this.localState = state;
    const { work, seasonIdx, allCustomLists, entry } = state;
    const season = work.seasons[seasonIdx];
    const sections = this.service.getSections();
    const entryCustomLists = entry?.customLists || {};
    const meta = { progress: entry?.progress || 0, total: entry?.media?.episodes || work.progress || 0 };

    return `
      <div class="astra-score-form">
        <div class="astra-form-header-section astra-quick-grid-2x2">
          <div class="astra-input-box">
            <span class="astra-label-xs">STATUS</span>
            <select class="astra-select" id="astra-status">
              ${[MediaListStatus.CURRENT, MediaListStatus.COMPLETED, MediaListStatus.PAUSED, MediaListStatus.DROPPED, MediaListStatus.PLANNING, MediaListStatus.REPEATING].map(s => 
                `<option value="${s}" ${work.status === s ? 'selected' : ''}>${getStatusLabel(s, work.type)}</option>`).join('')}
            </select>
          </div>
          <div class="astra-input-split">
            <div class="astra-input-box"><span class="astra-label-xs">START</span><input type="date" class="astra-date-input" id="astra-start-date" value="${this.formatDateForInput(entry?.startedAt)}"></div>
            <div class="astra-input-box"><span class="astra-label-xs">FINISH</span><input type="date" class="astra-date-input" id="astra-finish-date" value="${this.formatDateForInput(entry?.completedAt)}"></div>
          </div>
          <div class="astra-input-split">
            <div class="astra-input-box"><span class="astra-label-xs">PROGRESS</span>
              <div class="astra-stepper">
                <button class="astra-step-btn" data-step-field="progress" data-step="-1">-</button>
                <div class="astra-stepper-center"><input type="number" class="astra-number-input" id="astra-progress" value="${meta.progress}"><span>/ ${meta.total || '?'}</span></div>
                <button class="astra-step-btn" data-step-field="progress" data-step="1">+</button>
              </div>
            </div>
            <div class="astra-input-box"><span class="astra-label-xs">REWATCHES</span>
              <div class="astra-stepper">
                <button class="astra-step-btn" data-step-field="repeat" data-step="-1">-</button>
                <div class="astra-stepper-center"><input type="number" class="astra-number-input" id="astra-repeat" value="${entry?.repeat || 0}"></div>
                <button class="astra-step-btn" data-step-field="repeat" data-step="1">+</button>
              </div>
            </div>
          </div>
          <div class="astra-input-box">
            <span class="astra-label-xs">CUSTOM LISTS</span>
            <div class="astra-dropdown" id="astra-lists-dropdown">
              <button class="astra-dropdown-trigger"><i class="fa fa-list-ul"></i><span>Manage Lists</span><i class="fa fa-chevron-down"></i></button>
              <div class="astra-dropdown-menu">
                <div class="astra-dropdown-scroll">
                  ${allCustomLists.map(l => `<label class="astra-dropdown-item"><input type="checkbox" class="astra-custom-list-cb" data-name="${l}" ${entryCustomLists[l] ? 'checked' : ''}><span>${l}</span></label>`).join('')}
                </div>
                <div class="astra-dropdown-divider"></div>
                <label class="astra-dropdown-item astra-dropdown-item--special"><input type="checkbox" id="astra-hide-cb" ${entry?.hiddenFromStatusLists ? 'checked' : ''}><span>Hide</span></label>
                <label class="astra-dropdown-item astra-dropdown-item--special"><input type="checkbox" id="astra-private-cb" ${entry?.private ? 'checked' : ''}><span>Private</span></label>
              </div>
            </div>
          </div>
        </div>
        <div class="astra-form-scroll"><div class="astra-field-group ${season.manualOverride ? 'astra-disabled' : ''}">${this.sortSectionsForSymmetry(sections).map(s => this.renderScoreInput(s, season)).join('')}</div></div>
        <div class="astra-form-footer">
          <div class="astra-notes-area"><textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${season.notes || ''}</textarea></div>
          <div class="astra-overall-area">
            <div class="astra-overall-box">
              <span class="astra-overall-val" id="astra-overall-val" style="display: ${season.manualOverride ? 'none' : 'block'}">—</span>
              <input type="number" class="astra-overall-input" id="astra-manual-score" min="0" max="10" step="0.1" value="${(season.legacyScore || 0).toFixed(1)}" style="display: ${season.manualOverride ? 'block' : 'none'}">
            </div>
          </div>
          <button class="astra-btn astra-btn--primary astra-btn--full" id="astra-save-btn"><i class="fa fa-save"></i> Save Entry</button>
        </div>
      </div>
    `;
  }

  private sortSectionsForSymmetry(sections: AstraSection[]): AstraSection[] {
    const half = sections.filter(s => !s.subSections || s.subSections.length === 0);
    const full = sections.filter(s => s.subSections && s.subSections.length > 0);
    return [...half, ...full];
  }

  private renderScoreInput(section: AstraSection, season: AstraSeason): string {
    const settings = this.service.getSettings();
    let effectiveWeight = section.weight;

    const hasSubSections = section.subSections && section.subSections.length > 0;
    const groupClass = hasSubSections ? 'astra-score-group--full' : '';

    const isFinale = section.id === 'finale' || section.name.toLowerCase().trim() === 'finale';
    if (isFinale && season.isSeriesFinale && settings.enableSeriesFinale) {
      effectiveWeight *= (settings.finaleWeightMultiplier || 2);
    }

    if (hasSubSections) {
      return `
        <div class="astra-score-group ${groupClass}" data-id="${section.id}">
          <div class="astra-score-group-header astra-accordion-toggle">
            <div class="astra-label-left">
              <i class="fa fa-chevron-down astra-accordion-icon"></i>
              <span class="astra-score-group-title">${section.name} ${this.renderWeightTag(effectiveWeight)}</span>
            </div>
            <span class="astra-group-avg" id="avg-${section.id}">—</span>
          </div>
          <div class="astra-sub-sections">
            ${section.subSections!.map(sub => this.renderSubSectionInput(section.id, sub, season.scores[`${section.id}_${sub.id}`], !!season.manualOverride)).join('')}
          </div>
        </div>
      `;
    }

    const value = season.scores[section.id];

    return `
      <div class="astra-score-group ${groupClass}" data-id="${section.id}">
        <div class="astra-score-group-header">
          <div class="astra-label-left">
            <span class="astra-score-group-title">${section.name} ${this.renderWeightTag(effectiveWeight)}</span>
          </div>
          <span class="astra-group-avg" id="avg-${section.id}">—</span>
        </div>
        <div class="astra-main-section" style="padding: 12px;">
          <input type="range" class="astra-slider" data-id="${section.id}" min="0" max="10" step="0.1" value="${value || 0}" ${season.manualOverride ? 'disabled' : ''}>
        </div>
      </div>
    `;
  }

  private renderWeightTag(weight: number): string {
    return `<small class="astra-weight-tag">w${weight.toFixed(weight % 1 === 0 ? 0 : 1)}</small>`;
  }

  private renderSubSectionInput(parentId: string, sub: AstraSubSection, value: number | null | undefined, isDisabled: boolean): string {
    const fullId = `${parentId}_${sub.id}`;
    return `
      <div class="astra-score-input astra-score-input--sub ${isDisabled ? 'astra-disabled' : ''}" data-id="${fullId}">
        <div class="astra-score-label">
          <div class="astra-label-left">
            <span class="astra-sub-label">${sub.name} ${this.renderWeightTag(sub.weight)}</span>
          </div>
          <input type="number" class="astra-score-num-input" 
            min="0" max="10" step="0.1" 
            value="${(value === null || value === undefined) ? '0.0' : value.toFixed(1)}"
            style="color: ${AstraRadarChart.getScoreColor(value ?? null)}"
            ${isDisabled ? 'disabled' : ''}>
        </div>
        <div class="astra-slider-row">
          <input type="range" class="astra-slider" min="0" max="10" step="0.1" value="${value || 0}" ${isDisabled ? 'disabled' : ''}>
        </div>
      </div>
    `;
  }

  private formatDateForInput(date: any): string {
    if (!date || !date.year) return '';
    const y = date.year;
    const m = String(date.month).padStart(2, '0');
    const d = String(date.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  protected bindEvents(): void {
    if (!this.localState) return;

    this.$$('.astra-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const id = target.dataset.id || target.closest('[data-id]')?.getAttribute('data-id');
        if (id) {
          this.onScoreUpdate(id, val);
          const parent = target.closest('.astra-score-input');
          const numInput = parent?.querySelector('.astra-score-num-input') as HTMLInputElement;
          if (numInput) numInput.value = val.toFixed(1);
        }
        this.updateSliderTrack(target);
      });
      this.updateSliderTrack(slider as HTMLInputElement);
    });

    this.$$('.astra-score-num-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        let val = parseFloat(target.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(10, val));
        const parent = target.closest('.astra-score-input');
        const id = parent?.getAttribute('data-id');
        if (id) {
          this.onScoreUpdate(id, val);
          const slider = parent?.querySelector('.astra-slider') as HTMLInputElement;
          if (slider) {
            slider.value = val.toString();
            this.updateSliderTrack(slider);
          }
        }
      });
    });

    this.$$('.astra-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = (btn as HTMLElement).dataset.stepField;
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        const input = this.$(`#astra-${field}`) as HTMLInputElement;
        if (input) {
          const newVal = Math.max(0, parseInt(input.value) + step);
          input.value = newVal.toString();
          this.onFieldUpdate(field!, newVal);
        }
      });
    });

    this.$$('.astra-accordion-toggle').forEach(acc => {
      acc.addEventListener('click', () => {
        const group = acc.closest('.astra-score-group');
        group?.classList.toggle('astra-score-group--collapsed');
      });
    });

    const dropdown = this.$('#astra-lists-dropdown');
    this.$('.astra-dropdown-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown?.classList.toggle('active');
    });

    this.$('#astra-save-btn')?.addEventListener('click', () => {
      this.eventBus.emit('astra-save-request');
    });
    
    this.$('#astra-status')?.addEventListener('change', (e) => {
      this.onFieldUpdate('status', (e.target as HTMLSelectElement).value);
    });
  }

  private onScoreUpdate(id: string, value: number): void {
    this.eventBus.emit('astra-live-score-update', { id, value });
  }

  private onFieldUpdate(field: string, value: any): void {
    this.eventBus.emit('astra-field-update', { field, value });
  }

  private updateSliderTrack(slider: HTMLInputElement): void {
    const val = parseFloat(slider.value);
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '10');
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--astra-accent) 0%, var(--astra-accent) ${percent}%, var(--astra-bg-elev-2) ${percent}%, var(--astra-bg-elev-2) 100%)`;
  }
}
