import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraView } from '../base/AstraView';
import { AstraService } from '../../AstraService';
import { AstraRadarChart } from '../AstraRadarChart';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { AstraRatingStore, AstraRatingState } from '../state/AstraRatingStore';
import { html } from '@core/utils/Template';

// Sub-components
import { AstraStatusSelector } from './form/AstraStatusSelector';
import { AstraProgressStepper } from './form/AstraProgressStepper';
import { AstraCriteriaList } from './form/AstraCriteriaList';

/**
 * ScoreForm that connects to AstraRatingStore.
 */
@injectable()
export class AstraScoreForm extends AstraView {
  private store: AstraRatingStore | null = null;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(AstraStatusSelector) private statusSelector: AstraStatusSelector,
    @inject(AstraProgressStepper) private progressStepper: AstraProgressStepper,
    @inject(AstraProgressStepper) private repeatStepper: AstraProgressStepper,
    @inject(AstraCriteriaList) private criteriaList: AstraCriteriaList
  ) {
    super({});
  }

  public connect(store: AstraRatingStore): void {
    this.store = store;
  }

  public resetState(): void {
  }

  protected template(state: AstraRatingState): HTMLElement {
    if (!state || !state.media) return html`<div></div>`;
    const { work, currentSeasonIdx, media } = state;
    const entry = media.mediaListEntry;
    const season = work.seasons[currentSeasonIdx];

    return html`
      <div class="astra-score-form">
        <div class="astra-form-header-section astra-quick-grid-2x2">
          <div id="status-selector-mount"></div>
          
          <div class="astra-input-split">
            <div class="astra-input-box"><span class="astra-label-xs">START</span><input type="date" class="astra-date-input" id="astra-start-date" value="${this.formatDateForInput(entry?.startedAt)}"></div>
            <div class="astra-input-box"><span class="astra-label-xs">FINISH</span><input type="date" class="astra-date-input" id="astra-finish-date" value="${this.formatDateForInput(entry?.completedAt)}"></div>
          </div>
          
          <div class="astra-input-split">
            <div id="progress-stepper-mount"></div>
            <div id="repeat-stepper-mount"></div>
          </div>

          <div class="astra-input-box">
            <span class="astra-label-xs">CUSTOM LISTS</span>
            <div class="astra-dropdown" id="astra-lists-dropdown">
              <button class="astra-dropdown-trigger"><i class="fa fa-list-ul"></i><span>Manage Lists</span><i class="fa fa-chevron-down"></i></button>
              <div class="astra-dropdown-menu">
                  ${state.allCustomLists.map(list => html`
                    <div class="astra-dropdown-item astra-list-option ${(entry?.customLists || {})[list] ? 'active' : ''}" data-list="${list}">
                      <div class="astra-checkbox ${(entry?.customLists || {})[list] ? 'checked' : ''}"></div>
                      <span>${list}</span>
                    </div>
                  `)}
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
                <div id="criteria-list-mount"></div>
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
            <button class="astra-btn astra-btn--primary astra-btn--full" id="astra-save-btn"><i class="fa fa-refresh"></i> SYNC TO ANILIST</button>
          </div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    const state = this.props as AstraRatingState;
    if (!state) return;
    const { work, currentSeasonIdx, media } = state;
    const season = work.seasons[currentSeasonIdx];

    this.statusSelector.mount(this.$('#status-selector-mount')!, {
      status: work.status,
      type: work.type,
      onStatusChange: (val) => this.handleInput('status', val)
    });

    this.progressStepper.mount(this.$('#progress-stepper-mount')!, {
      label: 'PROGRESS',
      field: 'progress',
      value: work.progress || 0,
      max: state.totalCount,
      aired: state.airedCount,
      onValueChange: (val) => this.handleInput('progress', val)
    });

    this.repeatStepper.mount(this.$('#repeat-stepper-mount')!, {
      label: 'REWATCHES',
      field: 'repeat',
      value: media.mediaListEntry?.repeat || 0,
      onValueChange: (val) => this.handleInput('repeat', val)
    });

    this.criteriaList.mount(this.$('#criteria-list-mount')!, {
      season,
      sections: this.service.getSections(),
      settings: this.service.getSettings(),
      onScoreChange: (id, val) => this.store?.updateScore(id, val)
    });
  }

  protected override onUnmount(): void {
    this.statusSelector.unmount();
    this.progressStepper.unmount();
    this.repeatStepper.unmount();
    this.criteriaList.unmount();
    super.onUnmount();
  }

  private formatScore(val: number | null | undefined): string {
    if (val === null || val === undefined || val === 0) return '0';
    return val % 1 === 0 ? val.toString() : val.toFixed(1);
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

    this.$('#astra-start-date')?.addEventListener('change', (e) => this.handleInput('start-date', (e.target as HTMLInputElement).value));
    this.$('#astra-finish-date')?.addEventListener('change', (e) => this.handleInput('finish-date', (e.target as HTMLInputElement).value));
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

    this.$$('.astra-dropdown-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = (e.currentTarget as HTMLElement).parentElement;
        parent?.classList.toggle('active');
      });
    });

    // Managed listener: removed on unmount to avoid stacking document listeners on re-mount.
    this.addEventListener(document, 'click', () => this.$$('.astra-dropdown').forEach(d => d.classList.remove('active')));
    this.$('#astra-save-btn')?.addEventListener('click', () => this.eventBus.emit('astra-save-request'));
  }

  private handleInput(field: string, value: any): void {
    if (!this.store) return;
    const state = this.store.getState();
    const entry = state.media.mediaListEntry;

    if (field === 'status') this.store.updateWork({ status: value });
    else if (field === 'progress') this.store.updateWork({ progress: value });
    else if (field === 'repeat') this.store.updateMediaListEntry({ repeat: value });
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
}
