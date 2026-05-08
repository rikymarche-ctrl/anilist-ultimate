/**
 * @file AstraRatingController.ts
 * @description Enterprise controller for the Astra Rating Modal.
 * Refactored to align with Core Standards: DI, SOC, and secure templates.
 */

import { injectable, singleton, inject, delay } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService } from '../AstraService';
import type { AstraWork } from '../AstraInterfaces';
import { AstraView } from './base/AstraView';
import type { IAstraRatingService } from '../interfaces/IAstraRatingService';
import { AstraScoreForm } from './components/AstraScoreForm';
import { AstraEpisodeJournal } from './components/AstraEpisodeJournal';
import { AstraRadarPreview } from './components/AstraRadarPreview';
import { AstraRatingHeader } from './components/AstraRatingHeader';
import { AstraRadarChart } from './AstraRadarChart';
import { MediaListStatus } from '@/api/AnilistTypes';
import { log } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ToastService } from '@core/services/ToastService';
import { AstraRatingStore } from './state/AstraRatingStore';
import { AstraSyncManager } from '../services/AstraSyncManager';
import { html, when } from '@core/utils/Template';

/**
 * Enterprise implementation of the Rating Modal Controller.
 * Orchestrates sub-components and manages the modal lifecycle.
 */
@injectable()
@singleton()
export class AstraRatingController extends AstraView {
  private overlay: HTMLElement | null = null;
  private store: AstraRatingStore | null = null;
  private isSaving: boolean = false;
  private isOpening: boolean = false;

  constructor(
    @inject(delay(() => AstraService)) private service: AstraService,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.AstraSyncManager) private syncManager: AstraSyncManager,
    @inject(AstraRatingHeader) private header: AstraRatingHeader,
    @inject(AstraScoreForm) private scoreForm: AstraScoreForm,
    @inject(AstraEpisodeJournal) private journalView: AstraEpisodeJournal,
    @inject(AstraRadarPreview) private radarPreview: AstraRadarPreview
  ) {
    super({});
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN_MODAL, (detail: any) => this.open(detail.mediaId));
  }

  /**
   * Opens the rating modal for a specific media entry.
   * 
   * @param mediaId AniList media ID
   */
  public async open(mediaId: number): Promise<void> {
    if (this.overlay || this.isOpening) return;
    this.isOpening = true;

    try {
      log.info(`[AstraRatingController] Opening modal for mediaId: ${mediaId}`);

    const data = await this.ratingService.fetchInitialData(mediaId);
    if (!data) {
      this.toast.error('Failed to load AniList data.');
      return;
    }

    const { media, allCustomLists } = data;
    const mediaType = media.type === 'MANGA' && media.format === 'NOVEL' ? 'novel' : media.type.toLowerCase() as 'anime' | 'manga';

    const work = await this.service.getFullWork(mediaId) || this.createDefaultWork(media, mediaType);

    // AUTO-SYNC: Merge latest AniList data into local work immediately on open
    if (media.mediaListEntry) {
      await this.syncManager.pull(mediaId, work);
    }

    const totalCount = media.episodes || null;
    let airedCount: number | null = null;
    if (media.nextAiringEpisode) {
      airedCount = media.nextAiringEpisode.episode - 1;
    } else if (media.status === 'FINISHED') {
      airedCount = totalCount;
    }

    this.store = new AstraRatingStore({
      work,
      media,
      allCustomLists,
      currentSeasonIdx: work.seasons.length - 1,
      activeTab: 'rating',
      airedCount,
      totalCount
    }, this.eventBus);

    this.scoreForm.connect(this.store);
    this.scoreForm.resetState();
    this.journalView.connect(this.store);

    this.renderContainer();

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
      this.addEventListener(document.body, 'keydown', escHandler as any);
    } finally {
      this.isOpening = false;
    }
  }

  private createDefaultWork(media: any, type: 'anime' | 'manga' | 'novel'): AstraWork {
    const entry = media.mediaListEntry;
    return {
      id: `w_${Math.random().toString(36).slice(2, 11)}`,
      mediaId: media.id,
      title: media.title.userPreferred,
      type,
      country: media.countryOfOrigin,
      cover: media.coverImage.extraLarge || media.coverImage.large,
      status: entry?.status || MediaListStatus.PLANNING,
      customLists: [], tags: [], notes: '', updatedAt: Date.now(),
      seasons: [this.service.createDefaultSeason()],
      progress: entry?.progress || 0
    };
  }

  private renderContainer(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    const target = document.body || document.documentElement;
    if (target) {
      target.appendChild(this.overlay);
      if (document.body) document.body.style.overflow = 'hidden';
    }

    this.mount(this.overlay);
    
    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  /**
   * Closes the modal and triggers auto-save if necessary.
   */
  public async close(): Promise<void> {
    if (!this.overlay || !this.store) return;

    if (this.store.getState().isDirty && !this.isSaving) {
      log.info('[AstraRatingController] Auto-saving and syncing before close');
      await this.save(false, false); // Perform full sync
    }

    this.overlay.classList.add('astra-modal-overlay--closing');
    setTimeout(() => {
      this.unmount();
      this.overlay?.remove();
      this.overlay = null;
      document.body.style.overflow = '';
      this.store = null;
    }, 350);
  }

  /**
   * Main shell template for the rating modal.
   */
  protected template(): HTMLElement {
    const state = this.store?.getState();
    const activeTab = state?.activeTab || 'rating';

    return html`
      <div class="astra-modal astra-modal--rating">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand astra-nav-brand--back" id="astra-back-to-dashboard">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
            </svg>
            <span>Dashboard</span>
          </div>
          <div class="astra-nav-item ${when(activeTab === 'rating', 'active')}" data-tab="rating">
            <i class="fa fa-sliders"></i> <span>Rating</span>
          </div>
          <div class="astra-nav-item ${when(activeTab === 'journal', 'active')}" data-tab="journal">
            <i class="fa fa-book"></i> <span>Journal</span>
          </div>
          <div style="flex: 1;"></div>
        </nav>
        <div class="astra-modal-right-container">
          <div id="astra-header-mount"></div>
          <div class="astra-modal-main">
            <div id="astra-rating-content"></div>
          </div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    if (!this.store) return;
    this.renderHeader();
    this.renderTabContent();
  }

  protected override onUnmount(): void {
    this.header.unmount();
    this.scoreForm.unmount();
    this.journalView.unmount();
    this.radarPreview.unmount();
    super.onUnmount();
  }

  private renderHeader(): void {
    const mount = this.$('#astra-header-mount');
    const state = this.store?.getState();
    if (!mount || !state) return;

    const season = state.work.seasons[state.currentSeasonIdx];
    mount.innerHTML = '';
    this.header.mount(mount, {
      mediaId: state.work.mediaId,
      title: state.work.title,
      manualOverride: !!season.manualOverride,
      isSeriesFinale: !!season.isSeriesFinale,
      showFinale: this.service.getSettings().enableSeriesFinale && this.service.hasFinaleSection(),
      onOverrideToggle: (active: boolean) => {
        this.store?.updateSeason({ manualOverride: active });
        this.eventBus.emit('astra-store-updated', { state: this.store?.getState(), type: 'override-change' });
      },
      onFinaleToggle: () => {
        const current = !!this.store?.getState().work.seasons[state.currentSeasonIdx].isSeriesFinale;
        this.store?.updateSeason({ isSeriesFinale: !current });
      },
      onClose: () => this.close(),
      activeTab: state.activeTab
    });
  }

  private renderTabContent(): void {
    const content = this.$('#astra-rating-content');
    const state = this.store?.getState();
    if (!content || !state) return;

    // Ensure components are unmounted before re-mounting in a new container
    this.scoreForm.unmount();
    this.journalView.unmount();

    content.innerHTML = '';

    if (state.activeTab === 'rating') {
      const formMount = document.createElement('div');
      formMount.id = 'astra-form-mount';
      content.appendChild(formMount);

      this.scoreForm.mount(formMount, state);

      const season = state.work.seasons[state.currentSeasonIdx];
      const consolidated = this.service.consolidateScores(season.scores);

      this.scoreForm.updateSectionScores(consolidated);

      const radarTarget = formMount.querySelector('.astra-radar-mount');
      if (radarTarget) {
        this.radarPreview.mount(radarTarget as HTMLElement, {
          scores: consolidated,
          sections: this.service.getSections()
        });
      }

      const overall = this.service.calcSeasonScore(season);
      this.updateOverallScore(overall);
    } else {
      this.journalView.mount(content, state);
    }
  }

  /**
   * Binds modal interaction events.
   */
  protected bindEvents(): void {
    this.$$('.astra-nav-item').forEach(item => {
      this.addEventListener(item, 'click', () => {
        const tab = (item as HTMLElement).dataset.tab as 'rating' | 'journal';
        if (tab) this.store?.setTab(tab);
      });
    });

    this.$('#astra-back-to-dashboard')?.addEventListener('click', async () => {
      const state = this.store?.getState();
      const mediaId = state?.work.mediaId;
      await this.close();
      this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN, { mediaId });
    });

    this.eventBus.on('astra-store-updated', (payload: any) => this.handleStoreUpdate(payload));
    this.eventBus.on('astra-save-request', () => this.save(true));
  }

  private handleStoreUpdate(payload: any): void {
    const { state, type } = payload;

    if (type === 'tab-change') {
      this.$$('.astra-nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === state.activeTab));
      this.renderTabContent();
      this.header.update({ ...this.header.getState()!, activeTab: state.activeTab });
    } else if (type === 'dirty-change') {
      // Sidebar save removed, no action needed
    } else if (type === 'score-update' || type === 'override-change') {
      const season = state.work.seasons[state.currentSeasonIdx];
      const consolidated = this.service.consolidateScores(season.scores);
      
      this.radarPreview.updateRadar(consolidated, this.service.getSections());
      this.scoreForm.updateSectionScores(consolidated);

      const overall = this.service.calcSeasonScore(season);
      this.updateOverallScore(overall);
    } else if (type === 'season-update' || type === 'state-change') {
      if (payload.field === 'notes') {
        // Sync the textarea value if it differs from the store (e.g. from a pull)
        const notesArea = document.getElementById('astra-general-notes') as HTMLTextAreaElement;
        if (notesArea && notesArea.value !== state.work.seasons[state.currentSeasonIdx].notes) {
          notesArea.value = state.work.seasons[state.currentSeasonIdx].notes || '';
        }
        return;
      }
      this.renderHeader();
      this.renderTabContent();
    } else if (type === 'journal-update') {
      // Do not re-render tab to avoid focus loss
    }
  }

  /**
   * Persists the current state to the backend and synchronizes with AniList.
   * 
   * @param shouldClose Whether to close the modal after a successful save
   * @param skipSync Whether to skip syncing with AniList (local save only)
   */
  private async save(shouldClose: boolean, skipSync: boolean = false): Promise<void> {
    const state = this.store?.getState();
    if (this.isSaving || !state || !this.overlay) return;

    this.isSaving = true;
    this.store?.setSaving(true);
    const saveBtn = document.getElementById('astra-save-btn') as HTMLButtonElement;
    const originalHTML = saveBtn?.innerHTML || '';

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa fa-refresh fa-spin"></i> Syncing...';
    }

    try {
      const { work, media, currentSeasonIdx } = state;
      const season = work.seasons[currentSeasonIdx];
      const entry = media.mediaListEntry;
      const overall = this.service.calcSeasonScore(season) || season.legacyScore || 0;

      await this.ratingService.saveAndSync(work, {
        overallScore: overall,
        progress: work.progress,
        repeat: entry?.repeat,
        private: entry?.private,
        hidden: entry?.hiddenFromStatusLists,
        notes: season.notes,
        customLists: entry?.customLists ? Object.keys(entry.customLists).filter(k => entry.customLists[k]) : [],
        startedAt: entry?.startedAt,
        completedAt: entry?.completedAt,
        skipSync
      });

      this.store?.setDirty(false);

      if (saveBtn) {
        saveBtn.innerHTML = '<i class="fa fa-check"></i> Synced!';
        saveBtn.classList.add('astra-save-success');
      }

      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { mediaId: work.mediaId });
      if (shouldClose) setTimeout(() => this.close(), 300);
    } catch (err) {
      log.error('[AstraRatingController] Save failed', err);
      this.toast.error('Failed to sync ratings.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHTML;
      }
    } finally {
      this.isSaving = false;
      this.store?.setSaving(false);
    }
  }

  private updateOverallScore(val: number | null): void {
    const display = document.getElementById('astra-overall-val') as HTMLElement;
    const manualInput = document.getElementById('astra-manual-score') as HTMLInputElement;
    if (!display) return;

    const formatted = val === null || val === 0 ? '0' : (val % 1 === 0 ? val.toString() : val.toFixed(1));
    display.textContent = formatted;
    display.style.color = AstraRadarChart.getScoreColor(val);

    if (manualInput && val !== null) {
      manualInput.style.color = AstraRadarChart.getScoreColor(val);
    }
  }
}
