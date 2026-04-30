/**
 * @file AstraRatingModal.ts
 * @description Modal form for rating individual works across multiple scoring sections
 *
 * Provides:
 *   - Slider inputs for each Astra section/sub-section
 *   - Season management (add, delete, toggle series finale)
 *   - Episode journal with per-episode notes and scores
 *   - Radar chart preview of current scores
 *   - Date range inputs and custom notes
 *   - Focus trap and ESC-to-close accessibility
 *
 * @warning ~750 lines — should be split. Focus trap has a known
 *          Shift+Tab inversion bug. See docs/BUGS.md#bug-023.
 *
 * @see AstraService.ts for score persistence
 * @see AstraRadarChart.ts for the SVG chart
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 */

import { injectable, singleton, inject, container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraSection, AstraService, AstraSubSection, AstraWork } from '../AstraService';
import { AstraRadarChart } from './AstraRadarChart';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { log } from '@core/logger';
import { AstraDashboard } from './AstraDashboard';
import { MediaWithViewerResponse, MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import * as EventBusTypes from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

@injectable()
@singleton()
export class AstraRatingModal {
  private overlay: HTMLElement | null = null;
  private currentWork: AstraWork | null = null;
  private currentSeasonIdx: number = 0;
  private activeTab: string = 'rating';

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: EventBusTypes.IEventBus
  ) {
    // BUG-020: Ensure UI stays consistent on resize
    window.addEventListener('resize', () => {
      if (this.overlay) {
        this.updateLivePreview();
      }
    });
  }

  private get dashboard(): AstraDashboard {
    return container.resolve<AstraDashboard>(TOKENS.AstraDashboard);
  }

  public async open(mediaId: number): Promise<void> {
    const data = await this.fetchAniListData(mediaId);
    if (!data) return;

    const { media, allCustomLists } = data;
    const mediaType = media.type === 'MANGA' && media.format === 'NOVEL' ? 'novel' : media.type.toLowerCase() as 'anime' | 'manga';

    // Normalize customLists to string[]
    const customListsRaw = media.mediaListEntry?.customLists;
    const customLists: string[] = Array.isArray(customListsRaw)
      ? customListsRaw
      : customListsRaw
        ? Object.keys(customListsRaw).filter(key => customListsRaw[key])
        : [];

    this.currentWork = await this.astraService.getWork(mediaId) || {
      id: `w_${Math.random().toString(36).slice(2, 11)}`,
      mediaId,
      title: media.title.userPreferred,
      type: mediaType,
      country: media.countryOfOrigin,
      cover: media.coverImage.extraLarge || media.coverImage.large,
      status: media.mediaListEntry?.status || MediaListStatus.PLANNING,
      customLists,
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

  private async fetchAniListData(mediaId: number): Promise<{ media: MediaWithViewerResponse['Media']; allCustomLists: string[] } | null> {
    const GQL = `query($id: Int) {
      Viewer {
        mediaListOptions {
          animeList { customLists }
        }
      }
      Media(id: $id) {
        id title { userPreferred } type format episodes status countryOfOrigin
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
      const resp = await this.api.query<MediaWithViewerResponse>(GQL, { id: mediaId });
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
      <div class="astra-modal astra-modal--rating">
        <nav class="astra-modal-nav">
          <div class="astra-nav-back" id="astra-dashboard-link" title="Go to Astra Dashboard">
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width: 28px; height: 28px; transform: rotate(-90deg);">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
              <rect x="11" y="14" width="2" height="3" rx="1" opacity="0.6"/>
            </svg>
            <div class="astra-nav-back-text">Back to Dashboard</div>
          </div>
          <button class="astra-nav-item ${this.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa fa-sliders"></i>
            <span>Rating</span>
          </button>
          <button class="astra-nav-item ${this.activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa fa-book"></i>
            <span>Journal</span>
          </button>
          <div class="astra-nav-spacer"></div>
          <button class="astra-modal-close" title="Close modal" id="astra-modal-close-btn">
            <i class="fa fa-times"></i>
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
            <div class="astra-header-section">
              <img src="${work.cover}" class="astra-header-cover" id="astra-cover">
              <div class="astra-media-header">
                <div class="astra-quick-grid-2x2">
                  <!-- Row 1 Left: Status (Full Width of Cell) -->
                  <div class="astra-grid-cell">
                    <div class="astra-input-box">
                      <span class="astra-label-xs">STATUS</span>
                      <select class="astra-select" id="astra-status">
                        <option value="${MediaListStatus.CURRENT}" ${work.status === MediaListStatus.CURRENT ? 'selected' : ''}>${getStatusLabel(MediaListStatus.CURRENT, work.type)}</option>
                        <option value="${MediaListStatus.COMPLETED}" ${work.status === MediaListStatus.COMPLETED ? 'selected' : ''}>${getStatusLabel(MediaListStatus.COMPLETED, work.type)}</option>
                        <option value="${MediaListStatus.PAUSED}" ${work.status === MediaListStatus.PAUSED ? 'selected' : ''}>${getStatusLabel(MediaListStatus.PAUSED, work.type)}</option>
                        <option value="${MediaListStatus.DROPPED}" ${work.status === MediaListStatus.DROPPED ? 'selected' : ''}>${getStatusLabel(MediaListStatus.DROPPED, work.type)}</option>
                        <option value="${MediaListStatus.PLANNING}" ${work.status === MediaListStatus.PLANNING ? 'selected' : ''}>${getStatusLabel(MediaListStatus.PLANNING, work.type)}</option>
                        <option value="${MediaListStatus.REPEATING}" ${work.status === MediaListStatus.REPEATING ? 'selected' : ''}>${getStatusLabel(MediaListStatus.REPEATING, work.type)}</option>
                      </select>
                    </div>
                  </div>

                  <!-- Row 1 Right: Dates (Split 50/50) -->
                  <div class="astra-grid-cell">
                    <div class="astra-input-split">
                      <div class="astra-input-box">
                        <span class="astra-label-xs">START DATE</span>
                        <input type="date" class="astra-date-input" id="astra-start-date" value="${this.formatDateForInput(entry?.startedAt)}">
                      </div>
                      <div class="astra-input-box">
                        <span class="astra-label-xs">FINISH DATE</span>
                        <input type="date" class="astra-date-input" id="astra-finish-date" value="${this.formatDateForInput(entry?.completedAt)}">
                      </div>
                    </div>
                  </div>

                  <!-- Row 2 Left: Progress (Split 50/50 with Stats) -->
                  <div class="astra-grid-cell">
                    <div class="astra-input-split">
                      <div class="astra-input-box">
                        <span class="astra-label-xs">PROGRESS</span>
                        <div class="astra-stepper">
                          <button class="astra-step-btn" data-step-field="progress" data-step="-1">-</button>
                          <div class="astra-stepper-center">
                            <input type="number" class="astra-number-input" id="astra-progress" value="${meta.progress}">
                            <span class="astra-muted-inline">/ ${meta.totalEpisodes || '?'}</span>
                          </div>
                          <button class="astra-step-btn" data-step-field="progress" data-step="1">+</button>
                        </div>
                      </div>
                      <div class="astra-input-box">
                        <span class="astra-label-xs">REWATCHES</span>
                        <div class="astra-stepper">
                          <button class="astra-step-btn" data-step-field="repeat" data-step="-1">-</button>
                          <div class="astra-stepper-center">
                            <input type="number" class="astra-number-input" id="astra-repeat" value="${entry?.repeat || 0}">
                          </div>
                          <button class="astra-step-btn" data-step-field="repeat" data-step="1">+</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Row 2 Right: Custom Lists (Full Width of Cell) -->
                  <div class="astra-grid-cell">
                    <div class="astra-input-box">
                      <span class="astra-label-xs">CUSTOM LISTS</span>
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
                            <span>Private Entry</span>
                          </label>
                        </div>
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
                      ${sections.map(s => this.renderScoreInput(s, season.scores, sections.length, season.isSeriesFinale)).join('')}
                    </div>

                  </div>

                  <div class="astra-form-footer">
                    <div class="astra-notes-area">
                      <span class="astra-label-sm">Rating Notes</span>
                      <textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${season.notes || ''}</textarea>
                    </div>
                    <div class="astra-overall-area">
                      <span class="astra-label-sm">Weighted Score</span>
                      <div class="astra-overall-box">
                        <span class="astra-overall-val">—</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="astra-sidebar">
                  <div class="astra-radar-container">
                    ${AstraRadarChart.getHTML(season.scores, sections, season.skip, 300)}
                  </div>
                  <button class="astra-btn astra-btn--full" id="astra-save">Save Entry</button>
                </div>
              </div>
            </div>

            <!-- JOURNAL TAB -->
            <div id="astra-tab-journal" class="astra-tab-content ${this.activeTab === 'journal' ? 'astra-tab-content--active' : ''}">
              <div class="astra-ep-log-header">
                <div class="astra-journal-title-box">
                  <h3>Episode Journal</h3>
                  <p class="astra-muted">Track your thoughts for every single episode.</p>
                </div>
              </div>
              <div class="astra-ep-list">
                ${this.renderEpisodeList(meta.progress, meta.totalEpisodes, season.episodeNotes || {}, meta.airedEpisodes)}
              </div>
            </div>
          </div>

          </div>
        </div>
      </div>
    `;

    const cover = this.overlay.querySelector('#astra-cover');
    if (cover) {
      cover.addEventListener('click', () => {
        if (!this.currentWork?.cover) return;
        const hiResCover = this.currentWork.cover.replace('/medium/', '/large/');
        const fullOverlay = document.createElement('div');
        fullOverlay.className = 'astra-cover-full-overlay';
        fullOverlay.innerHTML = `
          <div class="astra-cover-full-container">
            <img src="${hiResCover}" class="astra-cover-full-img">
          </div>
        `;
        fullOverlay.onclick = () => fullOverlay.remove();
        document.body.appendChild(fullOverlay);
      });
    }

    this.attachEvents();
    this.updateLivePreview();
    this.overlay.classList.add('astra-modal-overlay--open');
  }

  private renderScoreInput(section: AstraSection, seasonScores: Record<string, number | null>, totalSections: number, isSeriesFinale?: boolean): string {
    const hasSubSections = section.subSections && section.subSections.length > 0;
    const isFullWidth = hasSubSections || totalSections === 1;
    const groupClass = isFullWidth ? 'astra-score-group--full' : '';

    if (hasSubSections) {
      return `
        <div class="astra-score-group ${groupClass}" data-id="${section.id}">
          <div class="astra-score-group-header astra-accordion-toggle">
            <div class="astra-label-left">
              <i class="fa fa-chevron-down astra-accordion-icon"></i>
              <span class="astra-score-group-title">${section.name}</span>
            </div>
            <span class="astra-group-avg" id="avg-${section.id}">—</span>
          </div>
          <div class="astra-sub-sections">
            ${section.subSections!.map(sub => this.renderSubSectionInput(section.id, sub, seasonScores[`${section.id}_${sub.id}`])).join('')}
          </div>
        </div>
      `;
    }

    const isFinale = section.id === 'finale';
    const settings = this.astraService.getSettings();
    const showToggle = isFinale && settings.enableSeriesFinale;
    const value = seasonScores[section.id];

    return `
      <div class="astra-score-group ${groupClass}" data-id="${section.id}">
        <div class="astra-score-group-header">
          <div class="astra-label-left">
            <span class="astra-score-group-title">${section.name}</span>
            ${showToggle ? `
              <button class="astra-finale-toggle ${isSeriesFinale ? 'active' : ''}" title="Toggle Season/Series Finale">
                <i class="fa fa-flag-checkered"></i>
              </button>
            ` : ''}
          </div>
          <span class="astra-group-avg" id="avg-${section.id}">—</span>
        </div>
        <div class="astra-main-section" style="padding: 12px;">
          <input type="range" class="astra-slider" data-id="${section.id}" min="0" max="10" step="0.5" value="${value || 0}">
        </div>
      </div>
    `;
  }

  private renderSubSectionInput(parentId: string, sub: AstraSubSection, value: number | null): string {
    const fullId = `${parentId}_${sub.id}`;
    return `
      <div class="astra-score-input astra-score-input--sub" data-id="${fullId}">
        <div class="astra-score-label">
          <div class="astra-label-left">
            <span class="astra-sub-label">${sub.name} <small>w${sub.weight}</small></span>
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

  public async close(): Promise<void> {
    if (!this.overlay) return;

    // Auto-save on close
    try {
      await this.save();
    } catch (err) {
      log.error('[AstraRatingModal] Auto-save on close failed', err);
    }

    this.overlay.classList.remove('astra-modal-overlay--open');
    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;

      // Only reset overflow if no other Astra modals are open
      if (!document.querySelector('.astra-modal-overlay')) {
        document.body.style.overflow = '';
      }
    }, 300);
  }

  /**
   * Get all focusable elements in the modal
   */
  private getFocusableElements(): HTMLElement[] {
    if (!this.overlay) return [];

    const selectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const modal = this.overlay.querySelector('.astra-modal');
    if (!modal) return [];

    return Array.from(modal.querySelectorAll(selectors)) as HTMLElement[];
  }

  /**
   * Setup focus trap to keep focus within modal
   */
  private setupFocusTrap(): void {
    if (!this.overlay) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = this.getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Shift + Tab: wrap to last element
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
      // Tab: wrap to first element
      else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    this.overlay.addEventListener('keydown', handleKeyDown);
  }

  private attachEvents(): void {
    if (!this.overlay) return;

    // Dashboard link
    const dashboardLink = this.overlay.querySelector('#astra-dashboard-link');
    dashboardLink?.addEventListener('click', () => {
      this.close();
      this.dashboard.open();
    });

    const closeBtns = this.overlay!.querySelectorAll('.astra-modal-close');
    const saveBtn = this.overlay!.querySelector('#astra-save');
    const navItems = this.overlay!.querySelectorAll('.astra-nav-item');
    const sliders = this.overlay!.querySelectorAll('.astra-slider');
    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const repeatInput = this.overlay!.querySelector('#astra-repeat') as HTMLInputElement;
    const accordions = this.overlay!.querySelectorAll('.astra-accordion-toggle');

    accordions.forEach(acc => {
      acc.addEventListener('click', () => {
        const group = acc.closest('.astra-score-group');
        group?.classList.toggle('astra-score-group--collapsed');
      });
    });

    closeBtns.forEach(btn => btn.addEventListener('click', async () => await this.close()));

    this.overlay!.addEventListener('click', async (e) => {
      if (e.target === this.overlay) await this.close();
    });

    // ESC key to close modal (accessibility)
    const handleEscKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        await this.close();
      }
    };
    document.addEventListener('keydown', handleEscKey);

    // Setup focus trap
    this.setupFocusTrap();

    // Auto-focus first focusable element
    requestAnimationFrame(() => {
      const focusableElements = this.getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    });

    document.body.style.overflow = 'hidden';

    // Tabs
    navItems.forEach(item => {
      item.addEventListener('click', async () => {
        const tab = (item as HTMLElement).dataset.tab;
        if (!tab || tab === this.activeTab) return;

        // Auto-save before switching tab
        await this.save();

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
      const btn = saveBtn as HTMLButtonElement;
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';

      try {
        await this.save();
        await this.close();
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = originalText;
        alert('Failed to save changes. Check console for details.');
      }
    });
  }

  /**
   * Centralized save logic
   */
  private async save(): Promise<void> {
    if (!this.currentWork || !this.overlay) return;

    const statusSelect = this.overlay.querySelector('#astra-status') as HTMLSelectElement;
    const progressInput = this.overlay.querySelector('#astra-progress') as HTMLInputElement;
    const repeatInput = this.overlay.querySelector('#astra-repeat') as HTMLInputElement;
    const generalNotes = this.overlay.querySelector('#astra-general-notes') as HTMLTextAreaElement;
    const currentSeason = this.currentWork.seasons[this.currentSeasonIdx];

    // Update work status and general info
    if (statusSelect) this.currentWork.status = statusSelect.value as MediaListStatus;
    if (generalNotes) currentSeason.notes = generalNotes.value;

    // Update episode notes
    const epTextareas = this.overlay.querySelectorAll('.astra-ep-textarea');
    if (epTextareas.length > 0) {
      if (!currentSeason.episodeNotes) currentSeason.episodeNotes = {};
      epTextareas.forEach(ta => {
        const epNum = parseInt((ta as HTMLElement).dataset.ep || '0');
        const text = (ta as HTMLTextAreaElement).value.trim();
        if (text) {
          currentSeason.episodeNotes![epNum] = { ...currentSeason.episodeNotes![epNum], text };
        } else if (currentSeason.episodeNotes![epNum]) {
          // If text is cleared, we might want to keep the score but clear the text
          currentSeason.episodeNotes![epNum].text = '';
        }
      });
    }

    // Advanced fields
    const repeat = repeatInput ? parseInt(repeatInput.value) : 0;
    const privateEntry = (this.overlay.querySelector('#astra-private-cb') as HTMLInputElement)?.checked || false;
    const hidden = (this.overlay.querySelector('#astra-hide-cb') as HTMLInputElement)?.checked || false;
    const startDateInput = this.overlay.querySelector('#astra-start-date') as HTMLInputElement;
    const finishDateInput = this.overlay.querySelector('#astra-finish-date') as HTMLInputElement;

    const startedAt = startDateInput ? this.parseDateFromInput(startDateInput.value) : null;
    const completedAt = finishDateInput ? this.parseDateFromInput(finishDateInput.value) : null;

    const customLists: string[] = [];
    this.overlay.querySelectorAll('.astra-custom-list-cb:checked').forEach(cb => {
      customLists.push((cb as HTMLInputElement).dataset.name!);
    });
    this.currentWork.customLists = customLists;

    // Save to local Astra service
    await this.astraService.saveWork(this.currentWork);

    // Sync to AniList
    const overall = this.astraService.calcSeasonOverall(currentSeason.scores, currentSeason.skip, currentSeason.isSeriesFinale) || 0;
    const progress = progressInput ? parseInt(progressInput.value) : (this.currentWork.progress || 0);

    const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$start:FuzzyDateInput,$end:FuzzyDateInput,$lists:[String]) {
      SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,startedAt:$start,completedAt:$end,customLists:$lists) { id status progress score }
    }`;

    try {
      await this.api.mutate(GQL_SAVE, {
        mediaId: this.currentWork.mediaId,
        status: statusSelect?.value || this.currentWork.status,
        progress: progress,
        score: Math.round(overall * 10),
        repeat,
        private: privateEntry,
        hidden,
        start: startedAt,
        end: completedAt,
        lists: customLists
      });

      // Emit events for sync
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { mediaId: this.currentWork.mediaId, timestamp: new Date() });

      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId: this.currentWork.mediaId,
        progress,
        previousProgress: 0,
        userId: 0,
        status: (this.overlay?.querySelector('#astra-status') as HTMLSelectElement)?.value as MediaListStatus || this.currentWork.status
      });
    } catch (err) {
      log.error('[AstraRatingModal] Failed to sync with AniList', err);
      // We don't throw here to avoid blocking local save
    }
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
      // Create a consolidated scores object that uses calculated averages for sections with sub-sections
      const consolidatedScores: Record<string, number | null> = {};
      sections.forEach(s => {
        consolidatedScores[s.id] = this.astraService.calcSectionScore(s, season.scores);
      });

      radarContainer.innerHTML = AstraRadarChart.getHTML(consolidatedScores, sections, season.skip, 250);
    }

    sections.forEach(s => {
      const val = this.astraService.calcSectionScore(s, season.scores);

      // Update group avg if exists
      const groupAvg = this.overlay!.querySelector(`#avg-${s.id}`) as HTMLElement;
      if (groupAvg) {
        groupAvg.textContent = (val === null || val === undefined) ? '—' : val.toFixed(1);
        groupAvg.style.color = AstraRadarChart.getScoreColor(val);
      }

      const row = this.overlay!.querySelector(`.astra-score-input[data-id="${s.id}"]`);
      if (row) {
        const numInput = row.querySelector('.astra-score-num-input') as HTMLInputElement;
        if (numInput) {
          if (document.activeElement !== numInput) {
            numInput.value = (val === undefined || val === null) ? '0.0' : val.toFixed(1);
          }
          numInput.style.color = AstraRadarChart.getScoreColor(val);
        }
      }

      // Handle sub-sections inputs
      if (s.subSections) {
        s.subSections.forEach(sub => {
          const subId = `${s.id}_${sub.id}`;
          const subRow = this.overlay!.querySelector(`.astra-score-input[data-id="${subId}"]`);
          if (subRow) {
            const subVal = season.scores[subId];
            const subNumInput = subRow.querySelector('.astra-score-num-input') as HTMLInputElement;
            if (subNumInput) {
              if (document.activeElement !== subNumInput) {
                subNumInput.value = (subVal === undefined || subVal === null) ? '0.0' : subVal.toFixed(1);
              }
              subNumInput.style.color = AstraRadarChart.getScoreColor(subVal);
            }
          }
        });
      }
    });
  }
}
