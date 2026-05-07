import { AstraView } from '../base/AstraView';
import { AstraService, AstraSection, AstraSeason, AstraSubSection } from '../../AstraService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { AstraRadarChart } from '../AstraRadarChart';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { AstraRatingStore, AstraRatingState } from '../state/AstraRatingStore';

/**
 * Refactored ScoreForm that connects to AstraRatingStore.
 */
export class AstraScoreForm extends AstraView {
  private store: AstraRatingStore | null = null;
  private openDropdownId: string | null = null;

  constructor(
    private service: AstraService,
    private eventBus: IEventBus
  ) {
    super({});
  }

  public connect(store: AstraRatingStore): void {
    this.store = store;
  }

  public resetState(): void {
    this.openDropdownId = null;
  }

  protected template(state: AstraRatingState): string {
    const { work, currentSeasonIdx, allCustomLists, media } = state;
    const entry = media.mediaListEntry;
    const season = work.seasons[currentSeasonIdx];
    const sections = this.service.getSections();
    const entryCustomLists = entry?.customLists || {};
    // Smart Progress Label Logic
    const watched = work.progress || 0;
    const aired = state.airedCount;
    const total = state.totalCount;
    let progressLabel = `/ ${total || '?'}`;
    
    // Mostra il numero di mezzo solo se diverso dal totale (serie in corso)
    if (aired !== null && aired !== total) {
      progressLabel = `/ ${aired} / ${total || '?'}`;
    }

    const statusOptions = [
      { value: MediaListStatus.CURRENT, label: getStatusLabel(MediaListStatus.CURRENT, work.type), icon: 'fa-play-circle' },
      { value: MediaListStatus.COMPLETED, label: getStatusLabel(MediaListStatus.COMPLETED, work.type), icon: 'fa-check-circle' },
      { value: MediaListStatus.PAUSED, label: getStatusLabel(MediaListStatus.PAUSED, work.type), icon: 'fa-pause-circle' },
      { value: MediaListStatus.DROPPED, label: getStatusLabel(MediaListStatus.DROPPED, work.type), icon: 'fa-times-circle' },
      { value: MediaListStatus.PLANNING, label: getStatusLabel(MediaListStatus.PLANNING, work.type), icon: 'fa-calendar' },
      { value: MediaListStatus.REPEATING, label: getStatusLabel(MediaListStatus.REPEATING, work.type), icon: 'fa-redo' },
    ];
    const currentStatus = statusOptions.find(o => o.value === work.status) || statusOptions[0];

    return `
      <div class="astra-score-form">
        <div class="astra-form-header-section astra-quick-grid-2x2">
          <div class="astra-input-box">
            <span class="astra-label-xs">STATUS</span>
            <div class="astra-dropdown" id="astra-status-dropdown">
              <button class="astra-dropdown-trigger">
                <i class="fa ${currentStatus.icon}"></i>
                <span>${currentStatus.label}</span>
                <i class="fa fa-chevron-down"></i>
              </button>
              <div class="astra-dropdown-menu">
                ${statusOptions.map(o => `
                  <div class="astra-dropdown-item astra-status-option ${work.status === o.value ? 'active' : ''}" data-value="${o.value}">
                    <i class="fa ${o.icon}"></i>
                    <span>${o.label}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="astra-input-split">
            <div class="astra-input-box"><span class="astra-label-xs">START</span><input type="date" class="astra-date-input" id="astra-start-date" value="${this.formatDateForInput(entry?.startedAt)}"></div>
            <div class="astra-input-box"><span class="astra-label-xs">FINISH</span><input type="date" class="astra-date-input" id="astra-finish-date" value="${this.formatDateForInput(entry?.completedAt)}"></div>
          </div>
          <div class="astra-input-split">
            <div class="astra-input-box"><span class="astra-label-xs">PROGRESS</span>
              <div class="astra-stepper">
                <button class="astra-step-btn" data-field="progress" data-step="-1">-</button>
                <div class="astra-stepper-center">
                  <input type="number" class="astra-number-input" id="astra-progress" value="${watched}">
                  <span class="astra-progress-label">${progressLabel}</span>
                </div>
                <button class="astra-step-btn" data-field="progress" data-step="1">+</button>
              </div>
            </div>
            <div class="astra-input-box"><span class="astra-label-xs">REWATCHES</span>
              <div class="astra-stepper">
                <button class="astra-step-btn" data-field="repeat" data-step="-1">-</button>
                <div class="astra-stepper-center"><input type="number" class="astra-number-input" id="astra-repeat" value="${entry?.repeat || 0}"></div>
                <button class="astra-step-btn" data-field="repeat" data-step="1">+</button>
              </div>
            </div>
          </div>
          <div class="astra-input-box">
            <span class="astra-label-xs">CUSTOM LISTS</span>
            <div class="astra-dropdown" id="astra-lists-dropdown">
              <button class="astra-dropdown-trigger"><i class="fa fa-list-ul"></i><span>Manage Lists</span><i class="fa fa-chevron-down"></i></button>
              <div class="astra-dropdown-menu">
                  ${allCustomLists.map(list => `
                    <div class="astra-dropdown-item astra-list-option ${entryCustomLists[list] ? 'active' : ''}" data-list="${list}">
                      <div class="astra-checkbox ${entryCustomLists[list] ? 'checked' : ''}"></div>
                      <span>${list}</span>
                    </div>
                  `).join('')}
                <div class="astra-dropdown-divider"></div>
                <div class="astra-dropdown-item astra-list-option ${entry?.hiddenFromStatusLists ? 'active' : ''}" data-type="hide">
                  <div class="astra-checkbox ${entry?.hiddenFromStatusLists ? 'checked' : ''}"></div>
                  <span>Hide from status lists</span>
                </div>
                <div class="astra-dropdown-item astra-list-option ${entry?.private ? 'active' : ''}" data-type="private">
                  <div class="astra-checkbox ${entry?.private ? 'checked' : ''}"></div>
                  <span>Private</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="astra-form-body-main">
          <div class="astra-form-left-col">
            <div class="astra-form-scroll">
              <div class="astra-criteria-group">
                <div class="astra-field-group ${season.manualOverride ? 'astra-disabled' : ''}">
                  ${this.sortSectionsForSymmetry(sections).map(s => this.renderScoreInput(s, season)).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="astra-radar-mount"></div>
        </div>

        <div class="astra-form-footer">
          <div class="astra-footer-left">
            <div class="astra-notes-area">
              <textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${season.notes || ''}</textarea>
            </div>
            <div class="astra-overall-box">
              <span class="astra-overall-val" id="astra-overall-val" style="display: ${season.manualOverride ? 'none' : 'block'}">0</span>
              <input type="number" class="astra-overall-input" id="astra-manual-score" min="0" max="10" step="0.1" value="${this.formatScore(season.legacyScore || 0)}" style="display: ${season.manualOverride ? 'block' : 'none'}">
            </div>
          </div>
          <div class="astra-footer-right">
            <button class="astra-btn astra-btn--primary astra-btn--full" id="astra-save-btn"><i class="fa fa-save"></i> SAVE ENTRY</button>
          </div>
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

  private formatScore(val: number | null | undefined): string {
    if (val === null || val === undefined || val === 0) return '0';
    return val % 1 === 0 ? val.toString() : val.toFixed(1);
  }

  private renderWeightTag(weight: number): string {
    return `<small class="astra-weight-tag">w${weight.toFixed(weight % 1 === 0 ? 0 : 1)}</small>`;
  }

  private renderSubSectionInput(parentId: string, sub: AstraSubSection, value: number | null | undefined, isDisabled: boolean): string {
    const fullId = `${parentId}_${sub.id}`;
    return `
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

  private formatDateForInput(date: any): string {
    if (!date || !date.year) return '';
    const y = date.year;
    const m = String(date.month).padStart(2, '0');
    const d = String(date.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  protected bindEvents(): void {
    if (!this.store) return;

    this.$$('.astra-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const id = target.dataset.id || target.closest('[data-id]')?.getAttribute('data-id');
        if (id) {
          this.store?.updateScore(id, val);
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
        if (id) {
          this.store?.updateScore(id, val);
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
        const field = (btn as HTMLElement).dataset.field;
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        const input = this.$(`#astra-${field}`) as HTMLInputElement;
        if (input) {
          const newVal = Math.max(0, parseInt(input.value) + step);
          input.value = newVal.toString();
          this.handleInput(field!, newVal);
        }
      });
    });

    this.$('#astra-start-date')?.addEventListener('change', (e) => this.handleInput('start-date', (e.target as HTMLInputElement).value));
    this.$('#astra-finish-date')?.addEventListener('change', (e) => this.handleInput('finish-date', (e.target as HTMLInputElement).value));
    this.$('#astra-progress')?.addEventListener('change', (e) => this.handleInput('progress', parseInt((e.target as HTMLInputElement).value) || 0));
    this.$('#astra-repeat')?.addEventListener('change', (e) => this.handleInput('repeat', parseInt((e.target as HTMLInputElement).value) || 0));
    this.$('#astra-status')?.addEventListener('change', (e) => this.handleInput('status', (e.target as HTMLSelectElement).value));
    this.$('#astra-general-notes')?.addEventListener('input', (e) => this.handleInput('notes', (e.target as HTMLTextAreaElement).value));
    this.$('#astra-manual-score')?.addEventListener('input', (e) => this.handleInput('manual-score', parseFloat((e.target as HTMLInputElement).value) || 0));

    this.$$('.astra-list-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.store) return;
        const currentState = this.store.getState();
        const type = (opt as HTMLElement).dataset.type;
        const listName = (opt as HTMLElement).dataset.list;

        if (type === 'hide') {
          const current = currentState.media.mediaListEntry?.hiddenFromStatusLists || false;
          this.handleInput('hiddenFromStatusLists', !current);
        } else if (type === 'private') {
          const current = currentState.media.mediaListEntry?.private || false;
          this.handleInput('private', !current);
        } else if (listName) {
          const currentLists = { ...(currentState.media.mediaListEntry?.customLists || {}) };
          currentLists[listName] = !currentLists[listName];
          this.handleInput('customLists', currentLists);
        }
      });
    });

    this.$$('.astra-accordion-toggle').forEach(acc => {
      acc.addEventListener('click', () => acc.closest('.astra-score-group')?.classList.toggle('astra-score-group--collapsed'));
    });

    // Restore open dropdown if any
    if (this.openDropdownId) {
      this.$(`#${this.openDropdownId}`)?.classList.add('active');
    }

    this.$$('.astra-dropdown-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = (e.currentTarget as HTMLElement).parentElement;
        const id = parent?.id || null;

        // Close other dropdowns first
        this.$$('.astra-dropdown').forEach(d => {
          if (d !== parent) {
            d.classList.remove('active');
          }
        });

        const isClosing = parent?.classList.contains('active');
        parent?.classList.toggle('active');
        this.openDropdownId = isClosing ? null : id;
      });
    });

    this.$$('.astra-status-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const val = (opt as HTMLElement).dataset.value;
        if (val) this.handleInput('status', val);
        opt.closest('.astra-dropdown')?.classList.remove('active');
      });
    });

    document.addEventListener('click', () => this.$$('.astra-dropdown').forEach(d => d.classList.remove('active')));
    this.$('#astra-save-btn')?.addEventListener('click', () => this.eventBus.emit('astra-save-request'));
  }

  private handleInput(field: string, value: any): void {
    if (!this.store) return;
    const state = this.store.getState();
    const entry = state.media.mediaListEntry;

    if (field === 'status') this.store.updateWork({ status: value });
    else if (field === 'progress') this.store.updateWork({ progress: value });
    else if (field === 'start-date') {
      const [y, m, d] = value.split('-').map(Number);
      entry.startedAt = value ? { year: y, month: m, day: d } : { year: null, month: null, day: null };
      this.store.setDirty(true);
    } else if (field === 'finish-date') {
      const [y, m, d] = value.split('-').map(Number);
      entry.completedAt = value ? { year: y, month: m, day: d } : { year: null, month: null, day: null };
      this.store.setDirty(true);
    } else if (field === 'customLists') {
      this.store.updateMediaListEntry({ customLists: value });
    } else if (field === 'hiddenFromStatusLists') {
      this.store.updateMediaListEntry({ hiddenFromStatusLists: value });
    } else if (field === 'private') {
      this.store.updateMediaListEntry({ private: value });
    } else if (field === 'notes') {
      this.store.updateSeason({ notes: value });
    } else if (field === 'manual-score') {
      this.store.updateSeason({ legacyScore: value });
    }
  }

  public updateSectionScores(consolidated: Record<string, number | null>): void {
    Object.entries(consolidated).forEach(([id, val]) => {
      const el = document.getElementById(`avg-${id}`);
      if (el) {
        const formatted = val === null || val === 0 ? '—' : (val % 1 === 0 ? val.toString() : val.toFixed(1));
        el.textContent = formatted;
        el.style.color = AstraRadarChart.getScoreColor(val);
      }
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
