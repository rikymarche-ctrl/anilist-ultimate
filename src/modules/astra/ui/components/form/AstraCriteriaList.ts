import { injectable } from 'tsyringe';
import { AstraView } from '../../base/AstraView';
import { AstraSection, AstraSeason, AstraSubSection, AstraSettings } from '../../../AstraInterfaces';
import { AstraRadarChart } from '../../AstraRadarChart';
import { html } from '@core/utils/Template';

export interface CriteriaListOptions {
  season: AstraSeason;
  sections: AstraSection[];
  settings: AstraSettings;
  onScoreChange: (id: string, val: number) => void;
}

@injectable()
export class AstraCriteriaList extends AstraView {
  private options: CriteriaListOptions | null = null;

  constructor() {
    super({});
  }

  public mount(parent: HTMLElement, options: CriteriaListOptions): void {
    this.options = options;
    super.mount(parent);
  }

  protected template(): HTMLElement {
    if (!this.options) return document.createElement('div');
    const { season, sections } = this.options;

    return html`
      <div class="astra-field-group ${season.manualOverride ? 'astra-disabled' : ''}">
        ${this.sortSectionsForSymmetry(sections).map(s => this.renderScoreInput(s, season))}
      </div>
    `;
  }

  private sortSectionsForSymmetry(sections: AstraSection[]): AstraSection[] {
    const half = sections.filter(s => !s.subSections || s.subSections.length === 0);
    const full = sections.filter(s => s.subSections && s.subSections.length > 0);
    return [...half, ...full];
  }

  private renderScoreInput(section: AstraSection, season: AstraSeason): HTMLElement {
    if (!this.options) return document.createElement('div');
    const { settings } = this.options;
    let effectiveWeight = section.weight;

    const hasSubSections = section.subSections && section.subSections.length > 0;
    const groupClass = hasSubSections ? 'astra-score-group--full' : '';

    const isFinale = section.id === 'finale' || section.name.toLowerCase().trim() === 'finale';
    if (isFinale && season.isSeriesFinale && settings.enableSeriesFinale) {
      effectiveWeight *= (settings.finaleWeightMultiplier || 2);
    }

    if (hasSubSections) {
      return html`
        <div class="astra-score-group ${groupClass}" data-id="${section.id}">
          <div class="astra-score-group-header astra-accordion-toggle">
            <div class="astra-label-left">
              <i class="fa fa-chevron-down astra-accordion-icon"></i>
              <span class="astra-score-group-title">${section.name} ${this.renderWeightTag(effectiveWeight)}</span>
            </div>
            <span class="astra-group-avg" id="avg-${section.id}">—</span>
          </div>
          <div class="astra-sub-sections">
            ${section.subSections!.map(sub => this.renderSubSectionInput(section.id, sub, season.scores[`${section.id}_${sub.id}`], !!season.manualOverride))}
          </div>
        </div>
      `;
    }

    const value = season.scores[section.id];

    return html`
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

  private renderSubSectionInput(parentId: string, sub: AstraSubSection, value: number | null | undefined, isDisabled: boolean): HTMLElement {
    const fullId = `${parentId}_${sub.id}`;
    return html`
      <div class="astra-score-input astra-score-input--sub ${isDisabled ? 'astra-disabled' : ''}" data-id="${fullId}">
        <div class="astra-sub-label-row">
          <span class="astra-sub-label">${sub.name} <small class="astra-weight-tag">w${sub.weight}</small></span>
          <input type="number" class="astra-score-num-input astra-score-num-input--small" 
            min="0" max="10" step="0.1" 
            value="${this.formatScore(value)}"
            style="color: ${AstraRadarChart.getScoreColor(value ?? null)}"
            ${isDisabled ? 'disabled' : ''}>
        </div>
        <div class="astra-slider-row">
          <input type="range" class="astra-slider astra-slider--mini" min="0" max="10" step="0.1" value="${value || 0}" ${isDisabled ? 'disabled' : ''}>
        </div>
      </div>
    `;
  }

  private formatScore(val: number | null | undefined): string {
    if (val === null || val === undefined || val === 0) return '0';
    return val % 1 === 0 ? val.toString() : val.toFixed(1);
  }

  private renderWeightTag(weight: number): HTMLElement {
    return html`<small class="astra-weight-tag">w${weight.toFixed(weight % 1 === 0 ? 0 : 1)}</small>`;
  }

  protected bindEvents(): void {
    this.$$('.astra-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const id = target.dataset.id || target.closest('[data-id]')?.getAttribute('data-id');
        if (id && this.options) {
          this.options.onScoreChange(id, val);
          const parent = target.closest('.astra-score-input') || target.closest('.astra-score-group');
          const numInput = parent?.querySelector('.astra-score-num-input') as HTMLInputElement;
          if (numInput) {
             numInput.value = this.formatScore(val);
             numInput.style.color = AstraRadarChart.getScoreColor(val);
          }
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
        if (id && this.options) {
          this.options.onScoreChange(id, val);
          const slider = parent?.querySelector('.astra-slider') as HTMLInputElement;
          if (slider) {
            slider.value = val.toString();
            this.updateSliderTrack(slider);
          }
        }
      });
    });

    this.$$('.astra-accordion-toggle').forEach(acc => {
      acc.addEventListener('click', () => acc.closest('.astra-score-group')?.classList.toggle('astra-score-group--collapsed'));
    });
  }

  private updateSliderTrack(slider: HTMLInputElement): void {
    const val = parseFloat(slider.value);
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '10');
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--astra-accent) 0%, var(--astra-accent) ${percent}%, var(--astra-bg-elev-2) ${percent}%, var(--astra-bg-elev-2) 100%)`;
  }
}
