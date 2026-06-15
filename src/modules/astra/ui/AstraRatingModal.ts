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
import { AstraService } from '../AstraService';
import type { AstraSection, AstraSubSection, AstraWork, AstraSeason } from '../AstraInterfaces';
import { AstraRadarChart } from './AstraRadarChart';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import { log } from '@core/logger';
import { AstraDashboard } from './AstraDashboard';
import { MediaWithViewerResponse, MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import * as EventBusTypes from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

import { AstraRatingState } from './AstraRatingState';
import { AstraRatingHeader } from './components/AstraRatingHeader';

@injectable()
@singleton()
export class AstraRatingModal {
  private overlay: HTMLElement | null = null;
  private header: AstraRatingHeader;
  private state: AstraRatingState | null = null;
  private currentSeasonIdx: number = 0;
  private activeTab: string = 'rating';
  private isSaving: boolean = false;
  private media: any = null;
  private initialProgress: number = 0; // Track initial progress for PROGRESS_UPDATED event
  private isNewWork: boolean = false; // Track if we are creating a new entry
  private livePreviewRaf: number | null = null; // Coalesces live-preview redraws during slider drag
  private documentClickHandler: (() => void) | null = null;
  private documentEscHandler: ((e: KeyboardEvent) => Promise<void>) | null = null;

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: EventBusTypes.IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    this.header = new AstraRatingHeader({});
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

  /**
   * Opens the Astra rating modal view and initializes data.
   *
   * @param mediaId The AniList media ID to load.
   * @param initialTab The initial tab to show ('rating' or 'journal').
   * @returns A promise that resolves when the modal open operation has completed.
   */
  public async open(mediaId: number, initialTab: 'rating' | 'journal' = 'rating'): Promise<void> {
    this.activeTab = initialTab;
    const data = await this.fetchAniListData(mediaId);
    if (!data) return;

    const { media, allCustomLists } = data;
    const mediaType =
      media.type === 'MANGA' && media.format === 'NOVEL'
        ? 'novel'
        : (media.type.toLowerCase() as 'anime' | 'manga');

    // Normalize customLists to string[]
    const customListsRaw = media.mediaListEntry?.customLists;
    const customLists: string[] = Array.isArray(customListsRaw)
      ? customListsRaw
      : customListsRaw
        ? Object.keys(customListsRaw).filter((key) => customListsRaw[key])
        : [];

    const existingWork = await this.astraService.getFullWork(mediaId);
    const worksCount = this.astraService.getWorks().length;

    let workData: AstraWork;
    if (existingWork) {
      log.info(
        `[AstraRatingModal] Loaded existing work for mediaId ${mediaId}: ${existingWork.title} (Total works in DB: ${worksCount})`
      );
      workData = existingWork;
      this.isNewWork = false;
    } else {
      log.warn(
        `[AstraRatingModal] No existing work found for mediaId ${mediaId} in DB of ${worksCount} items. Creating default fallback.`
      );
      this.isNewWork = true;
      workData = {
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
        episodes: media.episodes ?? undefined,
        chapters: media.chapters ?? undefined,
        progress: media.mediaListEntry?.progress ?? 0,
        updatedAt: Date.now(),
        seasons: [
          {
            id: 's_1',
            label: 'Season 1',
            scores: {},
            notes: media.mediaListEntry?.notes || '',
            legacyScore:
              (media.mediaListEntry?.score || 0) > 10
                ? (media.mediaListEntry?.score || 0) / 10
                : media.mediaListEntry?.score || 0,
          },
        ],
      };
    }

    this.state = new AstraRatingState(workData, (isDirty) => {
      // Any logic needed when dirty state changes (e.g., UI indicators)
      log.debug(`[AstraRatingModal] State dirty: ${isDirty}`);
    });

    this.currentSeasonIdx = 0;
    this.media = media;
    this.initialProgress = media.mediaListEntry?.progress || 0; // Save initial progress
    this.render(media, allCustomLists);
  }

  private async fetchAniListData(
    mediaId: number
  ): Promise<{ media: MediaWithViewerResponse['Media']; allCustomLists: string[] } | null> {
    const GQL = `query($id: Int) {
      Viewer {
        mediaListOptions {
          animeList { customLists }
        }
      }
      Media(id: $id) {
        id title { userPreferred } type format episodes chapters status countryOfOrigin
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
        allCustomLists: resp.Viewer?.mediaListOptions?.animeList?.customLists || [],
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

    const work = this.state!.data;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const entry = media.mediaListEntry;

    const meta = {
      progress: entry?.progress || 0,
      totalEpisodes: media.episodes,
      airedEpisodes: media.nextAiringEpisode
        ? media.nextAiringEpisode.episode - 1
        : media.status === 'FINISHED'
          ? media.episodes
          : media.episodes || 0,
    };

    const entryCustomLists = entry?.customLists || {};

    this.overlay.innerHTML = `
      <div class="astra-modal astra-modal--rating">
        <nav class="astra-modal-nav">
          <div class="astra-nav-back" id="astra-dashboard-link">
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style="width: 32px; height: 32px; transform: rotate(-90deg);">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
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
        </nav>

        <div class="astra-modal-main">
          <div id="astra-header-container"></div>

          <div class="astra-modal-body">
            <!-- RATING TAB -->
            ${this.renderRatingTab(work, season, entry, sections, allCustomLists, meta, entryCustomLists)}

            ${this.renderJournalTab(meta, season)}
          </div>

          </div>
        </div>
      </div>
    `;

    this.renderHeader();

    const cover = this.overlay.querySelector('#astra-cover');
    if (cover) {
      cover.addEventListener('click', () => {
        if (!this.state?.data.cover) return;
        const hiResCover = this.state.data.cover.replace('/medium/', '/large/');
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

    // Trigger animation
    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  private renderHeader(): void {
    if (!this.overlay || !this.state || !this.media) return;
    const work = this.state.data;
    const season = work.seasons[this.currentSeasonIdx];
    const headerContainer = this.overlay.querySelector('#astra-header-container') as HTMLElement;

    if (headerContainer) {
      headerContainer.innerHTML = ''; // Clear existing header to prevent duplication
      this.header.mount(headerContainer, {
        mediaId: this.media.id,
        title: this.media.title.userPreferred,
        manualOverride: season.manualOverride,
        isSeriesFinale: season.isSeriesFinale,
        showFinale:
          this.astraService.getSettings().enableSeriesFinale &&
          this.astraService.hasFinaleSection(),
        onOverrideToggle: (active: boolean) => {
          this.state?.setManualOverride(this.currentSeasonIdx, active);
          this.render(this.media, []);
        },
        onFinaleToggle: () => {
          const newState = !season.isSeriesFinale;
          this.state?.updateSeasonField(this.currentSeasonIdx, 'isSeriesFinale', newState);
          this.renderHeader();
          this.updateLivePreview();
        },
        onClose: () => this.close(),
        activeTab: this.activeTab,
      });
    }
  }

  private renderRatingTab(
    work: AstraWork,
    season: AstraSeason,
    entry: any,
    sections: AstraSection[],
    allCustomLists: string[],
    meta: any,
    entryCustomLists: Record<string, boolean>
  ): string {
    return `
      <div id="astra-tab-rating" class="astra-tab-content ${this.activeTab === 'rating' ? 'astra-tab-content--active' : ''}">
        <div class="astra-header-section">
          <img src="${work.cover}" class="astra-header-cover" id="astra-cover">
          <div class="astra-media-header">
            <div class="astra-quick-grid-2x2">
              <div class="astra-grid-cell">
                <div class="astra-input-box">
                  <span class="astra-label-xs">STATUS</span>
                  <div class="astra-dropdown astra-status-dropdown" id="astra-status-dropdown">
                    <button type="button" class="astra-dropdown-trigger">
                      <i class="fa ${this.statusIcon(work.status)}" id="astra-status-icon"></i>
                      <span class="astra-dropdown-label" id="astra-status-label">${getStatusLabel(work.status, work.type)}</span>
                      <i class="fa fa-chevron-down"></i>
                    </button>
                    <div class="astra-dropdown-menu">
                      <div class="astra-dropdown-scroll">
                        ${[
                          MediaListStatus.CURRENT,
                          MediaListStatus.COMPLETED,
                          MediaListStatus.PAUSED,
                          MediaListStatus.DROPPED,
                          MediaListStatus.PLANNING,
                          MediaListStatus.REPEATING,
                        ]
                          .map(
                            (s) => `
                          <div class="astra-dropdown-item astra-status-option ${work.status === s ? 'active' : ''}" data-value="${s}">
                            <i class="fa ${this.statusIcon(s)}"></i>
                            <span>${getStatusLabel(s, work.type)}</span>
                          </div>`
                          )
                          .join('')}
                      </div>
                    </div>
                  </div>
                  <input type="hidden" id="astra-status" value="${work.status}">
                </div>
              </div>

              <div class="astra-grid-cell">
                <div class="astra-input-split">
                  ${this.renderDateField('astra-start-date', 'START DATE', this.formatDateForInput(entry?.startedAt))}
                  ${this.renderDateField('astra-finish-date', 'FINISH DATE', this.formatDateForInput(entry?.completedAt))}
                </div>
              </div>

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
                        ${allCustomLists
                          .map(
                            (listName: string) => `
                          <label class="astra-dropdown-item">
                            <input type="checkbox" class="astra-custom-list-cb" data-name="${listName}" ${entryCustomLists[listName] ? 'checked' : ''}>
                            <span>${listName}</span>
                          </label>
                        `
                          )
                          .join('')}
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
              <div class="astra-field-group ${season.manualOverride ? 'astra-disabled' : ''}">
                ${this.sortSectionsForSymmetry(sections)
                  .map((s) => this.renderScoreInput(s, season.scores, sections.length))
                  .join('')}
              </div>
            </div>

            <div class="astra-form-footer">
              <div class="astra-notes-area">
                <textarea class="astra-textarea" id="astra-general-notes" placeholder="General thoughts...">${season.notes || ''}</textarea>
              </div>
              <div class="astra-overall-area">
                <div class="astra-overall-box">
                  <span class="astra-overall-val" style="display: ${season.manualOverride ? 'none' : 'block'}">—</span>
                  <input type="number" class="astra-overall-input" id="astra-manual-score" 
                    min="0" max="10" step="0.1" value="${(season.legacyScore || 0).toFixed(1)}"
                    style="display: ${season.manualOverride ? 'block' : 'none'}">
                </div>
              </div>
            </div>
          </div>

          <div class="astra-sidebar">
            <div class="astra-radar-container">
              ${AstraRadarChart.getHTML(season.scores, sections, season.skip, 300)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderJournalTab(meta: any, season: AstraSeason): string {
    return `
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
    `;
  }

  /**
   * Optimizes the rendering order of sections for visual symmetry in a 2-column grid.
   * Groups half-width sections together to fill pairs, pushing full-width sections to the bottom.
   */
  private sortSectionsForSymmetry(sections: AstraSection[]): AstraSection[] {
    const half = sections.filter((s) => !s.subSections || s.subSections.length === 0);
    const full = sections.filter((s) => s.subSections && s.subSections.length > 0);
    return [...half, ...full];
  }

  private renderScoreInput(
    section: AstraSection,
    seasonScores: Record<string, number | null>,
    totalSections: number
  ): string {
    const season = this.state!.data.seasons[this.currentSeasonIdx];
    const settings = this.astraService.getSettings();
    let effectiveWeight = section.weight;

    const hasSubSections = section.subSections && section.subSections.length > 0;
    const isFullWidth = hasSubSections || totalSections === 1;
    const groupClass = isFullWidth ? 'astra-score-group--full' : '';

    // Dynamic Finale Weighting
    const isFinale = section.id === 'finale' || section.name.toLowerCase().trim() === 'finale';
    if (isFinale && season.isSeriesFinale && settings.enableSeriesFinale) {
      effectiveWeight *= settings.finaleWeightMultiplier || 2;
    }

    // Compact "series finale" toggle, relocated from the header into the Finale section itself.
    const finaleToggleHtml =
      isFinale && settings.enableSeriesFinale && !season.manualOverride
        ? `<button type="button" class="astra-finale-toggle ${season.isSeriesFinale ? 'active' : ''}" id="astra-section-finale-btn" title="Mark as series finale (weight ×${settings.finaleWeightMultiplier || 2})"><i class="fa fa-flag-checkered"></i></button>`
        : '';

    if (hasSubSections) {
      return `
        <div class="astra-score-group ${groupClass}" data-id="${section.id}">
          <div class="astra-score-group-header astra-accordion-toggle">
            <div class="astra-label-left">
              <i class="fa fa-chevron-down astra-accordion-icon"></i>
              <span class="astra-score-group-title">${section.name} ${this.renderWeightTag(effectiveWeight)}</span>
              ${finaleToggleHtml}
            </div>
            <span class="astra-group-avg" id="avg-${section.id}">—</span>
          </div>
          <div class="astra-sub-sections">
            ${section.subSections!.map((sub) => this.renderSubSectionInput(section.id, sub, seasonScores[`${section.id}_${sub.id}`])).join('')}
          </div>
        </div>
      `;
    }

    const value = seasonScores[section.id];

    return `
      <div class="astra-score-group ${groupClass}" data-id="${section.id}">
        <div class="astra-score-group-header">
          <div class="astra-label-left">
            <span class="astra-score-group-title">${section.name} ${this.renderWeightTag(effectiveWeight)}</span>
            ${finaleToggleHtml}
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

  private renderSubSectionInput(
    parentId: string,
    sub: AstraSubSection,
    value: number | null
  ): string {
    const fullId = `${parentId}_${sub.id}`;
    const season = this.state!.data.seasons[this.currentSeasonIdx];
    const isDisabled = season.manualOverride;

    return `
      <div class="astra-score-input astra-score-input--sub ${isDisabled ? 'astra-disabled' : ''}" data-id="${fullId}">
        <div class="astra-score-label">
          <div class="astra-label-left">
            <span class="astra-sub-label">${sub.name} ${this.renderWeightTag(sub.weight)}</span>
          </div>
          <input type="number" class="astra-score-num-input" 
            min="0" max="10" step="0.1" 
            value="${value === null || value === undefined ? '0.0' : value.toFixed(1)}"
            style="color: ${AstraRadarChart.getScoreColor(value)}"
            ${isDisabled ? 'disabled' : ''}>
        </div>
        <div class="astra-slider-row">
          <input type="range" class="astra-slider" min="0" max="10" step="0.1" value="${value || 0}" ${isDisabled ? 'disabled' : ''}>
        </div>
      </div>
    `;
  }

  /**
   * Closes the rating modal view, auto-saves any unsaved modifications,
   * and cleans up global event listeners.
   *
   * @returns A promise that resolves when the close process completes.
   */
  public async close(): Promise<void> {
    if (!this.overlay || !this.state) return;

    // Auto-save ONLY if dirty (changes made) and NOT a newly created empty work
    // Or if it's a new work that the user actually modified
    const currentWork = this.state.data;
    if (
      this.state.isDirty &&
      (!this.isNewWork || Object.keys(currentWork.seasons[0].scores).length > 0)
    ) {
      try {
        log.info('[AstraRatingModal] Auto-saving changes on close...');
        await this.save();
      } catch (err) {
        log.error('[AstraRatingModal] Auto-save on close failed', err);
      }
    } else {
      log.debug('[AstraRatingModal] Closing without save (no changes or new empty work)');
    }

    // Cleanup global listeners
    if (this.documentEscHandler) {
      document.removeEventListener('keydown', this.documentEscHandler);
      this.documentEscHandler = null;
    }
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
      this.documentClickHandler = null;
    }

    this.overlay.classList.add('astra-modal-overlay--closing');
    this.overlay.classList.remove('astra-modal-overlay--open');

    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;

      // Only reset overflow if no other Astra modals are open
      if (!document.querySelector('.astra-modal-overlay')) {
        document.body.style.overflow = '';
      }
    }, 350);
  }

  /**
   * Get all focusable elements in the modal
   */
  private getFocusableElements(): HTMLElement[] {
    if (!this.overlay) return [];

    const selectors =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
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
      const focusMediaId = this.media?.id;
      this.close();
      this.dashboard.open(focusMediaId ? { mediaId: focusMediaId } : undefined);
    });

    const closeBtns = this.overlay!.querySelectorAll('.astra-modal-close');
    const navItems = this.overlay!.querySelectorAll('.astra-nav-item');
    const sliders = this.overlay!.querySelectorAll('.astra-slider');
    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const repeatInput = this.overlay!.querySelector('#astra-repeat') as HTMLInputElement;
    const accordions = this.overlay!.querySelectorAll('.astra-accordion-toggle');

    const allSaveBtns = [
      this.overlay!.querySelector('#astra-save'),
      this.overlay!.querySelector('#astra-nav-save'),
    ].filter(Boolean);

    accordions.forEach((acc) => {
      acc.addEventListener('click', () => {
        const group = acc.closest('.astra-score-group');
        group?.classList.toggle('astra-score-group--collapsed');
      });
    });

    closeBtns.forEach((btn) => btn.addEventListener('click', async () => await this.close()));

    this.overlay!.addEventListener('click', async (e) => {
      if (e.target === this.overlay) await this.close();
    });

    // ESC key to close modal (accessibility)
    this.documentEscHandler = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        await this.close();
      }
    };
    document.addEventListener('keydown', this.documentEscHandler);

    // Global document click to close active dropdowns
    this.documentClickHandler = () => {
      if (this.overlay) {
        this.overlay.querySelectorAll('.astra-dropdown.active').forEach((d) => {
          d.classList.remove('active');
        });
      }
    };
    document.addEventListener('click', this.documentClickHandler);

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
    navItems.forEach((item) => {
      item.addEventListener('click', async () => {
        const tab = (item as HTMLElement).dataset.tab;
        if (!tab || tab === this.activeTab) return;

        // Auto-save before switching tab
        await this.save();

        this.activeTab = tab;
        this.overlay!.querySelectorAll('.astra-nav-item').forEach((i) =>
          i.classList.remove('active')
        );
        item.classList.add('active');
        this.overlay!.querySelectorAll('.astra-tab-content').forEach((c) =>
          c.classList.remove('astra-tab-content--active')
        );
        this.overlay!.querySelector(`#astra-tab-${tab}`)?.classList.add(
          'astra-tab-content--active'
        );

        // Toggle sidebar save button visibility
        const navSave = this.overlay!.querySelector('#astra-nav-save') as HTMLElement;
        if (navSave) navSave.style.display = tab === 'journal' ? 'flex' : 'none';

        // Re-render header to update Override/Finale visibility
        this.renderHeader();
      });
    });

    // Dropdown
    const dropdown = this.overlay!.querySelector('#astra-lists-dropdown');
    const trigger = dropdown?.querySelector('.astra-dropdown-trigger');
    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = dropdown?.classList.contains('active');
      if (this.overlay) {
        this.overlay.querySelectorAll('.astra-dropdown.active').forEach((d) =>
          d.classList.remove('active')
        );
      }
      if (!wasActive) {
        dropdown?.classList.add('active');
      }
    });

    dropdown?.querySelector('.astra-dropdown-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Status custom dropdown (single-select, mirrors the Custom Lists styling/animation)
    const statusDropdown = this.overlay!.querySelector('#astra-status-dropdown');
    const statusTrigger = statusDropdown?.querySelector('.astra-dropdown-trigger');
    statusTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = statusDropdown?.classList.contains('active');
      if (this.overlay) {
        this.overlay.querySelectorAll('.astra-dropdown.active').forEach((d) =>
          d.classList.remove('active')
        );
      }
      if (!wasActive) {
        statusDropdown?.classList.add('active');
      }
    });
    statusDropdown
      ?.querySelector('.astra-dropdown-menu')
      ?.addEventListener('click', (e) => e.stopPropagation());
    statusDropdown?.querySelectorAll('.astra-status-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const value = (opt as HTMLElement).dataset.value as MediaListStatus;
        const hidden = this.overlay!.querySelector('#astra-status') as HTMLInputElement;
        const label = this.overlay!.querySelector('#astra-status-label');
        const icon = this.overlay!.querySelector('#astra-status-icon');
        if (hidden) hidden.value = value;
        if (label) label.textContent = (opt.textContent || '').trim();
        if (icon) icon.className = `fa ${this.statusIcon(value)}`;
        statusDropdown
          .querySelectorAll('.astra-status-option')
          .forEach((o) => o.classList.remove('active'));
        opt.classList.add('active');
        statusDropdown.classList.remove('active');
        this.state?.updateField('status', value);
      });
    });

    // Custom date pickers
    this.overlay!.querySelectorAll('.astra-datepicker').forEach((dp) =>
      this.bindDatePicker(dp as HTMLElement)
    );

    // Header events are now handled by AstraRatingHeader component
    const manualScoreInput = this.overlay!.querySelector('#astra-manual-score') as HTMLInputElement;

    manualScoreInput?.addEventListener('input', () => {
      if (!this.state) return;
      let val = parseFloat(manualScoreInput.value);
      if (isNaN(val)) val = 0;
      val = Math.max(0, Math.min(10, val));
      this.state.updateSeasonField(this.currentSeasonIdx, 'legacyScore', val);
      this.updateLivePreview();
    });

    // Sliders & Number Inputs
    const scoreInputs = this.overlay!.querySelectorAll('.astra-score-num-input');

    sliders.forEach((slider) => {
      const el = slider as HTMLInputElement;
      el.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const val = parseFloat(target.value);
        const id = target.dataset.id || target.closest('[data-id]')?.getAttribute('data-id');

        if (id && this.state) {
          this.state.setScore(this.currentSeasonIdx, id, val);

          // Sync number input if it exists (for subsections)
          const parent = target.closest('.astra-score-input');
          const numInput = parent?.querySelector('.astra-score-num-input') as HTMLInputElement;
          if (numInput) numInput.value = val.toFixed(1);

          this.updateLivePreview();
        }
        this.updateSliderTrack(target);
      });
      this.updateSliderTrack(el);
    });

    scoreInputs.forEach((input) => {
      const el = input as HTMLInputElement;
      el.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        let val = parseFloat(target.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(10, val));

        const parent = target.closest('.astra-score-input');
        const id = parent?.getAttribute('data-id');
        if (id && this.state) {
          this.state.setScore(this.currentSeasonIdx, id, val);

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

    // Finale Toggle (relocated into the Finale section header)
    const finaleBtn = this.overlay!.querySelector('#astra-section-finale-btn');
    finaleBtn?.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger accordion collapse if finale has sub-sections
      if (!this.state) return;
      const season = this.state.data.seasons[this.currentSeasonIdx];
      const newState = !season.isSeriesFinale;
      this.state.updateSeasonField(this.currentSeasonIdx, 'isSeriesFinale', newState);
      finaleBtn.classList.toggle('active', newState);

      // Reflect the new effective weight on the Finale section's weight tag.
      const settings = this.astraService.getSettings();
      const finaleSection = this.astraService
        .getSections()
        .find((s) => s.id === 'finale' || s.name.toLowerCase().trim() === 'finale');
      if (finaleSection) {
        const eff = newState
          ? finaleSection.weight * (settings.finaleWeightMultiplier || 2)
          : finaleSection.weight;
        const tag = this.overlay!.querySelector(
          `.astra-score-group[data-id="${finaleSection.id}"] .astra-weight-tag`
        ) as HTMLElement | null;
        if (tag) tag.textContent = `w${eff % 1 === 0 ? eff.toFixed(0) : eff.toFixed(1)}`;
      }

      this.updateLivePreview();
    });

    // Stepper
    this.overlay!.querySelectorAll('.astra-step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.state) return;
        const field = (btn as HTMLElement).dataset.stepField;
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        const input = field === 'progress' ? progressInput : repeatInput;
        const newVal = Math.max(0, parseInt(input.value) + step);
        input.value = newVal.toString();

        // This will be caught by the general change listener if we had one,
        // but for now we manually update the state since these inputs don't have change listeners attached here yet
        if (field === 'progress') {
          this.state.updateField('progress' as any, newVal);
          this.renderEpisodeJournal();
        } else {
          this.state.updateField('repeat' as any, newVal);
        }
      });
    });

    allSaveBtns.forEach((btn) => {
      btn?.addEventListener('click', async () => await this.handleQuickSave());
    });
  }

  private async handleQuickSave(): Promise<void> {
    const saveBtn = this.overlay!.querySelector('#astra-save') as HTMLButtonElement;
    const navSaveBtn = this.overlay!.querySelector('#astra-nav-save') as HTMLButtonElement;

    const btns = [saveBtn, navSaveBtn].filter(Boolean);
    const originalContents = btns.map((b) => b.innerHTML);

    btns.forEach((b) => {
      b.disabled = true;
      if (b.id === 'astra-save') {
        b.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
      } else {
        b.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      }
    });

    try {
      if (this.state) this.state.isDirty = true; // Force save

      // Safety timeout: 15 seconds max for saving
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Save operation timed out')), 5000)
      );

      await Promise.race([this.save(), timeoutPromise]);

      // Visual feedback for success
      btns.forEach((b) => {
        b.innerHTML = '<i class="fa fa-check"></i>' + (b.id === 'astra-save' ? ' Saved!' : '');
        b.classList.add('astra-save-success');
      });

      setTimeout(() => {
        btns.forEach((b, i) => {
          b.disabled = false;
          b.innerHTML = originalContents[i];
          b.classList.remove('astra-save-success');
        });
      }, 2000);
    } catch (err) {
      btns.forEach((b, i) => {
        b.disabled = false;
        b.innerHTML = originalContents[i];
      });
      log.error('[AstraRatingModal] Save failed or timed out', err);
      this.toast.error(
        err instanceof Error && err.message === 'Save operation timed out'
          ? 'Save timed out (AniList might be slow)'
          : 'Failed to save entry'
      );
    }
  }

  private async save(): Promise<void> {
    if (this.isSaving || !this.state || !this.overlay) return;

    // Safety check for invalidated context
    if (!chrome.runtime?.id) {
      log.warn('[AstraRatingModal] Extension context invalidated. Save aborted.');
      return;
    }

    // Only save if there are actual changes
    if (!this.state.isDirty) {
      log.debug('[AstraRatingModal] Skipping save: no changes detected (isDirty=false)');
      return;
    }

    this.isSaving = true;

    try {
      const currentWork = this.state.data;
      const statusSelect = this.overlay.querySelector('#astra-status') as HTMLSelectElement;
      const progressInput = this.overlay.querySelector('#astra-progress') as HTMLInputElement;
      const repeatInput = this.overlay.querySelector('#astra-repeat') as HTMLInputElement;
      const generalNotes = this.overlay.querySelector(
        '#astra-general-notes'
      ) as HTMLTextAreaElement;
      const currentSeason = currentWork.seasons[this.currentSeasonIdx];

      // Update work status and general info
      if (statusSelect) this.state.updateField('status', statusSelect.value as MediaListStatus);
      if (generalNotes)
        this.state.updateSeasonField(this.currentSeasonIdx, 'notes', generalNotes.value);

      // Update episode notes
      const epTextareas = this.overlay.querySelectorAll('.astra-ep-textarea');
      if (epTextareas.length > 0) {
        if (!currentSeason.episodeNotes) currentSeason.episodeNotes = {};
        epTextareas.forEach((ta) => {
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
      const privateEntry =
        (this.overlay.querySelector('#astra-private-cb') as HTMLInputElement)?.checked || false;
      const hidden =
        (this.overlay.querySelector('#astra-hide-cb') as HTMLInputElement)?.checked || false;
      const startDateInput = this.overlay.querySelector('#astra-start-date') as HTMLInputElement;
      const finishDateInput = this.overlay.querySelector('#astra-finish-date') as HTMLInputElement;

      const startedAt = startDateInput ? this.parseDateFromInput(startDateInput.value) : null;
      const completedAt = finishDateInput ? this.parseDateFromInput(finishDateInput.value) : null;

      const customLists: string[] = [];
      this.overlay.querySelectorAll('.astra-custom-list-cb:checked').forEach((cb) => {
        customLists.push((cb as HTMLInputElement).dataset.name!);
      });
      if (this.state) this.state.updateField('customLists', customLists);

      // Save to local Astra service
      log.debug('[AstraRatingModal] Persisting to local storage...');
      await this.astraService.saveWork(currentWork);
      if (this.state) this.state.resetDirty();
      log.success('[AstraRatingModal] Local storage updated.');

      // Sync to AniList
      const overall = this.astraService.calcSeasonScore(currentSeason) || 0;
      const progress = progressInput ? parseInt(progressInput.value) : currentWork.progress || 0;

      const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$repeat:Int,$private:Boolean,$hidden:Boolean,$start:FuzzyDateInput,$end:FuzzyDateInput,$lists:[String]) {
      SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,repeat:$repeat,private:$private,hiddenFromStatusLists:$hidden,startedAt:$start,completedAt:$end,customLists:$lists) { id status progress score }
    }`;

      log.debug('[AstraRatingModal] Syncing with AniList API...', { mediaId: currentWork.mediaId });
      await this.api.mutate(GQL_SAVE, {
        mediaId: currentWork.mediaId,
        status: statusSelect?.value || currentWork.status,
        progress: progress,
        score: Math.round(overall * 10),
        repeat,
        private: privateEntry,
        hidden,
        start: startedAt,
        end: completedAt,
        lists: customLists,
      });
      log.success('[AstraRatingModal] AniList sync successful.');

      // Emit events for sync
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, {
        mediaId: currentWork.mediaId,
        timestamp: new Date(),
      });

      const userId = (await this.api.getCurrentUserId()) || 0;

      log.info('[AstraRatingModal] Emitting PROGRESS_UPDATED', {
        mediaId: currentWork.mediaId,
        progress,
        previousProgress: this.initialProgress,
        userId,
        status: (statusSelect?.value as MediaListStatus) || currentWork.status,
      });

      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        mediaId: currentWork.mediaId,
        progress,
        previousProgress: this.initialProgress,
        userId,
        status: (statusSelect?.value as MediaListStatus) || currentWork.status,
      });
    } catch (err) {
      log.error('[AstraRatingModal] Failed to sync with AniList', err);
      // We don't throw here to avoid blocking local save
    } finally {
      this.isSaving = false;
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

  /** Renders a custom date field: styled trigger + popover calendar, backed by a hidden input. */
  private renderDateField(id: string, label: string, iso: string): string {
    return `
      <div class="astra-input-box">
        <span class="astra-label-xs">${label}</span>
        <div class="astra-dropdown astra-datepicker" data-target="${id}">
          <button type="button" class="astra-dropdown-trigger astra-datepicker-trigger">
            <i class="fa fa-calendar"></i>
            <span class="astra-dropdown-label astra-dp-label">${this.formatDateDisplay(iso)}</span>
            <i class="fa fa-chevron-down"></i>
          </button>
          <div class="astra-dropdown-menu astra-datepicker-menu"></div>
        </div>
        <input type="hidden" id="${id}" value="${iso}">
      </div>
    `;
  }

  private statusIcon(status: MediaListStatus): string {
    switch (status) {
      case MediaListStatus.CURRENT:
        return 'fa-circle-play';
      case MediaListStatus.COMPLETED:
        return 'fa-circle-check';
      case MediaListStatus.PAUSED:
        return 'fa-circle-pause';
      case MediaListStatus.DROPPED:
        return 'fa-circle-stop';
      case MediaListStatus.PLANNING:
        return 'fa-clock';
      case MediaListStatus.REPEATING:
        return 'fa-arrows-rotate';
      default:
        return 'fa-circle-play';
    }
  }

  private formatDateDisplay(iso: string): string {
    if (!iso) return 'Not set';
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return 'Not set';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${d} ${months[m - 1]} ${y}`;
  }

  private toIso(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private buildCalendarHtml(year: number, month: number, selectedIso: string): string {
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const startDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const now = new Date();
    const todayIso = this.toIso(now.getFullYear(), now.getMonth(), now.getDate());

    let cells = '';
    for (let i = 0; i < startDow; i++)
      cells += `<span class="astra-cal-day astra-cal-day--empty"></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = this.toIso(year, month, d);
      const cls = ['astra-cal-day'];
      if (iso === selectedIso) cls.push('astra-cal-day--selected');
      if (iso === todayIso) cls.push('astra-cal-day--today');
      cells += `<button type="button" class="${cls.join(' ')}" data-day="${iso}">${d}</button>`;
    }

    return `
      <div class="astra-cal-header">
        <span class="astra-cal-title">${monthNames[month]} ${year}</span>
        <div class="astra-cal-nav">
          <button type="button" class="astra-cal-nav-btn" data-nav="prev"><i class="fa fa-chevron-left"></i></button>
          <button type="button" class="astra-cal-nav-btn" data-nav="next"><i class="fa fa-chevron-right"></i></button>
        </div>
      </div>
      <div class="astra-cal-grid astra-cal-dow">${dow.map((d) => `<span class="astra-cal-dow-cell">${d}</span>`).join('')}</div>
      <div class="astra-cal-grid astra-cal-days">${cells}</div>
      <div class="astra-cal-footer">
        <button type="button" class="astra-cal-action" data-clear>Clear</button>
        <button type="button" class="astra-cal-action astra-cal-action--accent" data-today>Today</button>
      </div>
    `;
  }

  private bindDatePicker(dp: HTMLElement): void {
    const trigger = dp.querySelector('.astra-dropdown-trigger');
    const menu = dp.querySelector('.astra-datepicker-menu') as HTMLElement;
    const hidden = this.overlay!.querySelector(`#${dp.dataset.target}`) as HTMLInputElement;
    const labelEl = dp.querySelector('.astra-dp-label') as HTMLElement;
    if (!trigger || !menu || !hidden) return;

    const renderMonth = () => {
      const iso = hidden.value;
      let year: number;
      let month: number;
      if (dp.dataset.viewYear && dp.dataset.viewMonth) {
        year = Number(dp.dataset.viewYear);
        month = Number(dp.dataset.viewMonth);
      } else if (iso) {
        const [y, m] = iso.split('-').map(Number);
        year = y;
        month = m - 1;
      } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth();
      }
      dp.dataset.viewYear = String(year);
      dp.dataset.viewMonth = String(month);
      menu.innerHTML = this.buildCalendarHtml(year, month, hidden.value);
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = dp.classList.contains('active');
      this.overlay!.querySelectorAll('.astra-dropdown.active').forEach((d) =>
        d.classList.remove('active')
      );
      if (!wasActive) {
        renderMonth();
        dp.classList.add('active');
      }
    });

    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;

      const navBtn = target.closest('[data-nav]') as HTMLElement | null;
      if (navBtn) {
        let year = Number(dp.dataset.viewYear);
        let month = Number(dp.dataset.viewMonth) + (navBtn.dataset.nav === 'next' ? 1 : -1);
        if (month < 0) {
          month = 11;
          year--;
        } else if (month > 11) {
          month = 0;
          year++;
        }
        dp.dataset.viewYear = String(year);
        dp.dataset.viewMonth = String(month);
        menu.innerHTML = this.buildCalendarHtml(year, month, hidden.value);
        return;
      }

      const dayBtn = target.closest('[data-day]') as HTMLElement | null;
      if (dayBtn) {
        this.setDateValue(hidden, labelEl, dayBtn.dataset.day!);
        dp.classList.remove('active');
        return;
      }

      if (target.closest('[data-clear]')) {
        this.setDateValue(hidden, labelEl, '');
        dp.classList.remove('active');
        return;
      }

      if (target.closest('[data-today]')) {
        const now = new Date();
        this.setDateValue(
          hidden,
          labelEl,
          this.toIso(now.getFullYear(), now.getMonth(), now.getDate())
        );
        delete dp.dataset.viewYear;
        delete dp.dataset.viewMonth;
        dp.classList.remove('active');
        return;
      }
    });
  }

  private setDateValue(hidden: HTMLInputElement, labelEl: HTMLElement, iso: string): void {
    hidden.value = iso;
    labelEl.textContent = this.formatDateDisplay(iso);
    if (this.state) this.state.isDirty = true;
  }

  private renderEpisodeJournal(): void {
    const list = this.overlay!.querySelector('.astra-ep-list');
    if (!list || !this.media) return;

    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const progress = parseInt(progressInput.value) || 0;
    if (!this.state) return;
    const season = this.state.data.seasons[this.currentSeasonIdx];

    const airedEpisodes = this.media.nextAiringEpisode
      ? this.media.nextAiringEpisode.episode - 1
      : this.media.status === 'FINISHED'
        ? this.media.episodes
        : this.media.episodes || 0;

    list.innerHTML = this.renderEpisodeList(
      progress,
      this.media.episodes,
      season.episodeNotes || {},
      airedEpisodes
    );
  }

  private renderEpisodeList(
    progress: number,
    total: number | null,
    notes: Record<number, { text: string }>,
    airedCount: number | null
  ): string {
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
              placeholder="${isNotAired ? 'Episode not yet aired' : isLocked ? 'Watch this episode to add notes' : `Notes for episode ${i}...`}" 
              ${isLocked || isNotAired ? 'disabled' : ''}>${note}</textarea>
          </div>
        </div>
      `;
    }
    return html;
  }

  private updateLivePreview(): void {
    // Coalesce rapid calls (e.g. per-pixel slider drag) into one redraw per frame.
    // Rebuilding the radar SVG synchronously on every input event was blocking the
    // main thread and dropping pointer-move events, making sliders stick mid-drag.
    if (this.livePreviewRaf !== null) return;
    this.livePreviewRaf = requestAnimationFrame(() => {
      this.livePreviewRaf = null;
      this.performLivePreview();
    });
  }

  private performLivePreview(): void {
    if (!this.state) return;
    const work = this.state.data;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const overall = this.astraService.calcSeasonScore(season);

    const overallVal = this.overlay!.querySelector('.astra-overall-val') as HTMLElement;
    if (overallVal) {
      overallVal.textContent = overall === null || overall === undefined ? '—' : overall.toFixed(1);
      overallVal.style.color = AstraRadarChart.getScoreColor(overall);
    }

    const radarContainer = this.overlay!.querySelector('.astra-radar-container');
    if (radarContainer) {
      // Create a consolidated scores object that uses calculated averages for sections with sub-sections
      const consolidatedScores: Record<string, number | null> = {};
      sections.forEach((s) => {
        consolidatedScores[s.id] = this.astraService.calcSectionScore(s, season.scores);
      });

      radarContainer.innerHTML = AstraRadarChart.getHTML(
        consolidatedScores,
        sections,
        season.skip,
        250
      );
    }

    sections.forEach((s) => {
      const val = this.astraService.calcSectionScore(s, season.scores);

      // Update group avg if exists
      const groupAvg = this.overlay!.querySelector(`#avg-${s.id}`) as HTMLElement;
      if (groupAvg) {
        groupAvg.textContent = val === null || val === undefined ? '—' : val.toFixed(1);
        groupAvg.style.color = AstraRadarChart.getScoreColor(val);
      }

      const row = this.overlay!.querySelector(`.astra-score-input[data-id="${s.id}"]`);
      if (row) {
        const numInput = row.querySelector('.astra-score-num-input') as HTMLInputElement;
        if (numInput) {
          if (document.activeElement !== numInput) {
            numInput.value = val === undefined || val === null ? '0.0' : val.toFixed(1);
          }
          numInput.style.color = AstraRadarChart.getScoreColor(val);
        }
      }

      // Handle sub-sections inputs
      if (s.subSections) {
        s.subSections.forEach((sub) => {
          const subId = `${s.id}_${sub.id}`;
          const subRow = this.overlay!.querySelector(`.astra-score-input[data-id="${subId}"]`);
          if (subRow) {
            const subVal = season.scores[subId];
            const subNumInput = subRow.querySelector('.astra-score-num-input') as HTMLInputElement;
            if (subNumInput) {
              if (document.activeElement !== subNumInput) {
                subNumInput.value =
                  subVal === undefined || subVal === null ? '0.0' : subVal.toFixed(1);
              }
              subNumInput.style.color = AstraRadarChart.getScoreColor(subVal);
            }
          }
        });
      }
    });
  }
}
