import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '../../../core/di/tokens';
import { AstraService, AstraWork } from '../AstraService';
import { AstraRadarChart } from './AstraRadarChart';
import { anilistClient } from '../../../api/AnilistClient';
import { log } from '../../../core/logger';

@injectable()
@singleton()
export class AstraRatingModal {
  private overlay: HTMLElement | null = null;
  private currentWork: AstraWork | null = null;
  private currentSeasonIdx: number = 0;
  private activeTab: string = 'rating';

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService
  ) {}

  public async open(mediaId: number): Promise<void> {
    const data = await this.fetchAniListData(mediaId);
    if (!data) return;

    const { media, allCustomLists } = data;
    this.currentWork = await this.astraService.getWork(mediaId) || {
      id: `w_${Math.random().toString(36).slice(2, 11)}`,
      mediaId,
      title: media.title.userPreferred,
      type: 'anime',
      cover: media.coverImage.extraLarge || media.coverImage.large,
      status: media.mediaListEntry?.status || 'PLANNING',
      tags: [],
      notes: '',
      updatedAt: Date.now(),
      seasons: [{
        id: 's_1',
        label: 'Season 1',
        scores: {},
        notes: media.mediaListEntry?.notes || '',
      }]
    };

    this.currentSeasonIdx = 0;
    this.render(media, allCustomLists);
  }

  private async fetchAniListData(mediaId: number): Promise<any> {
    const GQL = `query($id: Int) {
      Viewer {
        mediaListOptions {
          animeList { customLists }
        }
      }
      Media(id: $id) {
        id title { userPreferred } type format episodes status
        nextAiringEpisode { episode }
        coverImage { large extraLarge color }
        mediaListEntry { 
          status progress score(format: POINT_100) notes 
          repeat private hiddenFromStatusLists
          startedAt { year month day }
          completedAt { year month day }
          customLists
        }
      }
    }`;

    try {
      const resp = await anilistClient.query(GQL, { id: mediaId }) as any;
      return {
        media: resp.Media,
        allCustomLists: resp.Viewer?.mediaListOptions?.animeList?.customLists || []
      };
    } catch (err) {
      log.error('[AstraRatingModal] Failed to fetch AniList data', err);
      return null;
    }
  }

  private render(media: any, allCustomLists: string[]): void {
    if (this.overlay) this.overlay.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    document.body.appendChild(this.overlay);

    const work = this.currentWork!;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const entry = media.mediaListEntry;

    const meta = {
      progress: entry?.progress || 0,
      totalEpisodes: media.episodes,
      airedEpisodes: media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : (media.status === 'FINISHED' ? media.episodes : (media.episodes || 0)),
    };

    const entryCustomLists = entry?.customLists || {};

    this.overlay.innerHTML = `
      <div class="astra-modal">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand"><i class="fa fa-compass"></i></div>
          <button class="astra-nav-item ${this.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa fa-sliders"></i>
            <span>Rating</span>
          </button>
          <button class="astra-nav-item ${this.activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa fa-book"></i>
            <span>Journal</span>
          </button>
        </nav>

        <div class="astra-modal-main">
          <header class="astra-modal-header">
            <div class="astra-modal-title">
              <a href="https://anilist.co/anime/${media.id}" target="_blank">${media.title.userPreferred}</a>
            </div>
            <button class="astra-modal-close"><i class="fa fa-times"></i></button>
          </header>

          <div class="astra-modal-body">
            <!-- RATING TAB -->
            <div id="astra-tab-rating" class="astra-tab-content ${this.activeTab === 'rating' ? 'astra-tab-content--active' : ''}">
              <div class="astra-media-header">
                <img src="${work.cover}" class="astra-header-cover">
                <div class="astra-header-info">
                  <div class="astra-quick-row">
                    <div class="astra-input-box">
                      <span class="astra-label-sm">Status</span>
                      <select class="astra-select" id="astra-status">
                        <option value="CURRENT" ${work.status === 'CURRENT' ? 'selected' : ''}>Watching</option>
                        <option value="COMPLETED" ${work.status === 'COMPLETED' ? 'selected' : ''}>Completed</option>
                        <option value="PAUSED" ${work.status === 'PAUSED' ? 'selected' : ''}>Paused</option>
                        <option value="DROPPED" ${work.status === 'DROPPED' ? 'selected' : ''}>Dropped</option>
                        <option value="PLANNING" ${work.status === 'PLANNING' ? 'selected' : ''}>Planning</option>
                        <option value="REPEATING" ${work.status === 'REPEATING' ? 'selected' : ''}>Repeating</option>
                      </select>
                    </div>
                    <div class="astra-input-box">
                      <span class="astra-label-sm">Progress</span>
                      <div class="astra-stepper">
                        <button class="astra-step-btn" data-step-field="progress" data-step="-1">-</button>
                        <input type="number" class="astra-number-input" id="astra-progress" value="${meta.progress}">
                        <button class="astra-step-btn" data-step-field="progress" data-step="1">+</button>
                      </div>
                    </div>
                    <span class="astra-muted" style="margin-bottom: 8px;">/ ${meta.totalEpisodes || '?'}</span>

                    <div class="astra-quick-divider"></div>

                    <div class="astra-input-box astra-input-box--stacked">
                      <div class="astra-stacked-field">
                        <span class="astra-label-xs">Start</span>
                        <input type="date" class="astra-date-input astra-date-input--mini" id="astra-start-date" value="${this.formatDateForInput(entry?.startedAt)}">
                      </div>
                      <div class="astra-stacked-field">
                        <span class="astra-label-xs">Finish</span>
                        <input type="date" class="astra-date-input astra-date-input--mini" id="astra-finish-date" value="${this.formatDateForInput(entry?.completedAt)}">
                      </div>
                    </div>

                    <div class="astra-input-box">
                      <span class="astra-label-sm">Rewatches</span>
                      <div class="astra-stepper">
                        <button class="astra-step-btn" data-step-field="repeat" data-step="-1">-</button>
                        <input type="number" class="astra-number-input" id="astra-repeat" value="${entry?.repeat || 0}">
                        <button class="astra-step-btn" data-step-field="repeat" data-step="1">+</button>
                      </div>
                    </div>

                    <div class="astra-quick-divider"></div>

                    <div class="astra-input-box">
                      <span class="astra-label-sm">Custom Lists</span>
                      <div class="astra-dropdown" id="astra-lists-dropdown">
                        <button class="astra-dropdown-trigger">
                          <i class="fa fa-list-ul"></i>
                          <span class="astra-dropdown-label">Manage Lists</span>
                          <i class="fa fa-chevron-down"></i>
                        </button>
                        <div class="astra-dropdown-menu">
                          <div class="astra-dropdown-scroll">
                            ${allCustomLists.map((listName: string) => `
                              <label class="astra-dropdown-item">
                                <input type="checkbox" class="astra-custom-list-cb" data-name="${listName}" ${entryCustomLists[listName] ? 'checked' : ''}>
                                <span>${listName}</span>
                              </label>
                            `).join('')}
                          </div>
                          <div class="astra-dropdown-divider"></div>
                          <label class="astra-dropdown-item astra-dropdown-item--special">
                            <input type="checkbox" id="astra-hide-cb" ${entry?.hiddenFromStatusLists ? 'checked' : ''}>
                            <span>Hide from status lists</span>
                          </label>
                          <label class="astra-dropdown-item astra-dropdown-item--special">
                            <input type="checkbox" id="astra-private-cb" ${entry?.private ? 'checked' : ''}>
                            <span>Private</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="astra-form-layout">
                <div class="astra-form">
                  <div class="astra-form-scroll">
                    <div class="astra-field-group">
                      ${sections.map(s => this.renderScoreInput(s, season.scores[s.id], season.isSeriesFinale)).join('')}
                    </div>

                  </div>

                  <div class="astra-form-footer">
                    <div class="astra-notes-area">
                      <span class="astra-label-sm">Rating Notes</span>
                      <textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${season.notes}</textarea>
                    </div>
                    <div class="astra-overall-box">
                      <span class="astra-overall-label">Weighted Score</span>
                      <span class="astra-overall-val">—</span>
                    </div>
                  </div>
                </div>

                <div class="astra-sidebar">
                  <div class="astra-radar-container">
                    ${AstraRadarChart.getHTML(season.scores, sections, season.skip, 250)}
                  </div>

                </div>
              </div>
            </div>

            <!-- JOURNAL TAB -->
            <div id="astra-tab-journal" class="astra-tab-content ${this.activeTab === 'journal' ? 'astra-tab-content--active' : ''}">
              <div class="astra-ep-log-header">
                <h3>Episode Journal</h3>
                <p class="astra-muted">Track your thoughts for every single episode.</p>
              </div>
              <div class="astra-ep-list">
                ${this.renderEpisodeList(meta.progress, meta.totalEpisodes, season.episodeNotes || {}, meta.airedEpisodes)}
              </div>
            </div>
          </div>

          <footer class="astra-modal-footer">
            <button class="astra-btn astra-btn--secondary" id="astra-cancel">Cancel</button>
            <button class="astra-btn astra-btn--primary" id="astra-save">Save Entry</button>
          </footer>
        </div>
      </div>
    `;

    this.attachEvents();
    this.updateLivePreview();
    this.overlay.classList.add('astra-modal-overlay--open');
  }

  private renderScoreInput(section: any, value: number | null, isSeriesFinale?: boolean): string {
    const isFinale = section.id === 'finale';
    const settings = this.astraService.getSettings();
    const showToggle = isFinale && settings.enableSeriesFinale;

    return `
      <div class="astra-score-input" data-id="${section.id}">
        <div class="astra-score-label">
          <div class="astra-label-left">
            <span>${section.name}</span>
            ${showToggle ? `
              <button class="astra-finale-toggle ${isSeriesFinale ? 'active' : ''}" title="Toggle Season/Series Finale">
                <i class="fa fa-flag-checkered"></i>
              </button>
            ` : ''}
            ${isFinale && isSeriesFinale ? `<span class="astra-finale-type">Series</span>` : ''}
          </div>
          <input type="number" class="astra-score-num-input" 
            min="0" max="10" step="0.1" 
            value="${(value === null || value === undefined) ? '0.0' : value.toFixed(1)}"
            style="color: ${AstraRadarChart.getScoreColor(value)}">
        </div>
        <div class="astra-slider-row">
          <input type="range" class="astra-slider" min="0" max="10" step="0.1" value="${value || 0}">
        </div>
      </div>
    `;
  }

  private attachEvents(): void {
    const closeBtn = this.overlay!.querySelector('.astra-modal-close');
    const cancelBtn = this.overlay!.querySelector('#astra-cancel');
    const saveBtn = this.overlay!.querySelector('#astra-save');
    const navItems = this.overlay!.querySelectorAll('.astra-nav-item');
    const sliders = this.overlay!.querySelectorAll('.astra-slider');
    const statusSelect = this.overlay!.querySelector('#astra-status') as HTMLSelectElement;
    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const repeatInput = this.overlay!.querySelector('#astra-repeat') as HTMLInputElement;

    const close = () => {
      this.overlay!.classList.remove('astra-modal-overlay--open');
      setTimeout(() => this.overlay!.remove(), 300);
      document.body.style.overflow = '';
    };

    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    
    this.overlay!.addEventListener('click', (e) => {
      if (e.target === this.overlay) close();
    });

    document.body.style.overflow = 'hidden';

    // Tabs
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = (item as HTMLElement).dataset.tab;
        if (!tab) return;
        this.activeTab = tab;
        this.overlay!.querySelectorAll('.astra-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.overlay!.querySelectorAll('.astra-tab-content').forEach(c => c.classList.remove('astra-tab-content--active'));
        this.overlay!.querySelector(`#astra-tab-${tab}`)?.classList.add('astra-tab-content--active');
      });
    });

    // Dropdown
    const dropdown = this.overlay!.querySelector('#astra-lists-dropdown');
    const trigger = dropdown?.querySelector('.astra-dropdown-trigger');
    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown?.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      dropdown?.classList.remove('active');
    }, { once: false });

    dropdown?.querySelector('.astra-dropdown-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Sliders & Number Inputs
    const scoreInputs = this.overlay!.querySelectorAll('.astra-score-num-input');
    
    sliders.forEach(slider => {
      const el = slider as HTMLInputElement;
      el.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const parent = target.closest('.astra-score-input');
        const id = parent?.getAttribute('data-id');
        if (id) {
          this.currentWork!.seasons[this.currentSeasonIdx].scores[id] = val;
          
          // Sync number input
          const numInput = parent?.querySelector('.astra-score-num-input') as HTMLInputElement;
          if (numInput) numInput.value = val.toFixed(1);
          
          this.updateLivePreview();
          this.updateSliderTrack(target);
        }
      });
      this.updateSliderTrack(el);
    });

    scoreInputs.forEach(input => {
      const el = input as HTMLInputElement;
      el.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        let val = parseFloat(target.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(10, val));
        
        const parent = target.closest('.astra-score-input');
        const id = parent?.getAttribute('data-id');
        if (id) {
          this.currentWork!.seasons[this.currentSeasonIdx].scores[id] = val;
          
          // Sync slider
          const slider = parent?.querySelector('.astra-slider') as HTMLInputElement;
          if (slider) {
            slider.value = val.toString();
            this.updateSliderTrack(slider);
          }
          
          this.updateLivePreview();
        }
      });

      el.addEventListener('blur', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value) || 0;
        target.value = Math.max(0, Math.min(10, val)).toFixed(1);
      });
    });

    // Finale Toggle
    const finaleToggle = this.overlay!.querySelector('.astra-finale-toggle');
    finaleToggle?.addEventListener('click', () => {
      const season = this.currentWork!.seasons[this.currentSeasonIdx];
      season.isSeriesFinale = !season.isSeriesFinale;
      this.updateLivePreview();
      finaleToggle.classList.toggle('active', season.isSeriesFinale);
    });

    // Stepper
    this.overlay!.querySelectorAll('.astra-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = (btn as HTMLElement).dataset.stepField;
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        const input = field === 'progress' ? progressInput : repeatInput;
        const newVal = Math.max(0, parseInt(input.value) + step);
        input.value = newVal.toString();
        if (field === 'progress') this.renderEpisodeJournal();
      });
    });

    saveBtn?.addEventListener('click', async () => {
      (saveBtn as HTMLButtonElement).disabled = true;
      (saveBtn as HTMLButtonElement).innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
      
      this.currentWork!.status = statusSelect.value;
      const currentSeason = this.currentWork!.seasons[this.currentSeasonIdx];

      const generalNotes = this.overlay!.querySelector('#astra-general-notes') as HTMLTextAreaElement;
      if (generalNotes) currentSeason.notes = generalNotes.value;

      const epTextareas = this.overlay!.querySelectorAll('.astra-ep-textarea');
      currentSeason.episodeNotes = {};
      epTextareas.forEach(ta => {
        const epNum = parseInt((ta as HTMLElement).dataset.ep || '0');
        const text = (ta as HTMLTextAreaElement).value.trim();
        if (text) {
          currentSeason.episodeNotes![epNum] = { text };
        }
      });

      // Collect advanced fields
      const repeat = parseInt(repeatInput.value);
      const privateEntry = (this.overlay!.querySelector('#astra-private-cb') as HTMLInputElement).checked;
      const hidden = (this.overlay!.querySelector('#astra-hide-cb') as HTMLInputElement).checked;
      const startedAt = this.parseDateFromInput((this.overlay!.querySelector('#astra-start-date') as HTMLInputElement).value);
      const completedAt = this.parseDateFromInput((this.overlay!.querySelector('#astra-finish-date') as HTMLInputElement).value);
      
      const customLists: string[] = [];
      this.overlay!.querySelectorAll('.astra-custom-list-cb:checked').forEach(cb => {
        customLists.push((cb as HTMLInputElement).dataset.name!);
      });

      await this.astraService.saveWork(this.currentWork!);
      const overall = this.astraService.calcSeasonOverall(currentSeason.scores, currentSeason.skip, currentSeason.isSeriesFinale) || 0;
      
      const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$start:FuzzyDateInput,$end:FuzzyDateInput,$lists:[String]) {
        SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,startedAt:$start,completedAt:$end,customLists:$lists) { id status progress score }
      }`;

      try {
        await anilistClient.query(GQL_SAVE, {
          mediaId: this.currentWork!.mediaId,
          status: statusSelect.value,
          progress: parseInt(progressInput.value),
          score: Math.round(overall * 10),
          repeat,
          private: privateEntry,
          hidden,
          start: startedAt,
          end: completedAt,
          lists: customLists
        });
        window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
      } catch (err) {
        log.error('[AstraRatingModal] Failed to sync with AniList', err);
      }
      
      close();
    });
  }

  private updateSliderTrack(slider: HTMLInputElement): void {
    const val = parseFloat(slider.value);
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '10');
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--astra-accent) 0%, var(--astra-accent) ${percent}%, var(--astra-bg-elev-2) ${percent}%, var(--astra-bg-elev-2) 100%)`;
  }

  private formatDateForInput(date: any): string {
    if (!date || !date.year) return '';
    const y = date.year;
    const m = String(date.month).padStart(2, '0');
    const d = String(date.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private parseDateFromInput(val: string): any {
    if (!val) return null;
    const [y, m, d] = val.split('-').map(Number);
    return { year: y, month: m, day: d };
  }

  private renderEpisodeJournal(): void {
    const list = this.overlay!.querySelector('.astra-ep-list');
    if (!list) return;
  }

  private renderEpisodeList(progress: number, total: number | null, notes: Record<number, { text: string }>, airedCount: number | null): string {
    const visibleCount = total || Math.max(progress, airedCount || 0, Object.keys(notes).length);
    let html = '';
    
    for (let i = 1; i <= visibleCount; i++) {
      const note = notes[i]?.text || '';
      const hasAired = airedCount === null || i <= airedCount;
      const isWatched = i <= progress;
      const isNotAired = !hasAired;
      const isLocked = hasAired && !isWatched;
      
      html += `
        <div class="astra-ep-row ${isLocked ? 'astra-ep-row--locked' : ''} ${isNotAired ? 'astra-ep-row--not-aired' : ''}">
          <div class="astra-ep-num">
            <span class="astra-label-sm">EP</span>
            <span class="astra-ep-digit">${i}</span>
            ${isNotAired ? '<span class="astra-ep-badge">NA</span>' : ''}
            ${isLocked ? '<span class="astra-ep-badge"><i class="fa fa-lock"></i></span>' : ''}
          </div>
          <div class="astra-ep-body">
            <textarea class="astra-ep-textarea" data-ep="${i}" 
              placeholder="${isNotAired ? 'Episode not yet aired' : (isLocked ? 'Watch this episode to add notes' : `Notes for episode ${i}...`)}" 
              ${isLocked || isNotAired ? 'disabled' : ''}>${note}</textarea>
          </div>
        </div>
      `;
    }
    return html;
  }

  private updateLivePreview(): void {
    const work = this.currentWork!;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const overall = this.astraService.calcSeasonOverall(season.scores, season.skip, season.isSeriesFinale);

    const overallVal = this.overlay!.querySelector('.astra-overall-val') as HTMLElement;
    if (overallVal) {
      overallVal.textContent = (overall === null || overall === undefined) ? '—' : overall.toFixed(1);
      overallVal.style.color = AstraRadarChart.getScoreColor(overall);
    }

    const radarContainer = this.overlay!.querySelector('.astra-radar-container');
    if (radarContainer) {
      radarContainer.innerHTML = AstraRadarChart.getHTML(season.scores, sections, season.skip, 250);
    }

    sections.forEach(s => {
      const row = this.overlay!.querySelector(`.astra-score-input[data-id="${s.id}"]`);
      if (row) {
        const numInput = row.querySelector('.astra-score-num-input') as HTMLInputElement;
        const val = season.scores[s.id];
        if (numInput) {
          if (document.activeElement !== numInput) {
            numInput.value = (val === undefined || val === null) ? '0.0' : val.toFixed(1);
          }
          numInput.style.color = AstraRadarChart.getScoreColor(val);
        }
      }
    });
  }
}
