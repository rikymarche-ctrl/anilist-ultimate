/**
 * @file AstraRatingController.ts
 * @description Orchestrator for the Astra Rating Modal.
 * Delegated business logic to AstraRatingService.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService, AstraWork } from '../AstraService';
import { AstraView } from './base/AstraView';
import type { IAstraRatingService } from '../interfaces/IAstraRatingService';
import { AstraScoreForm } from './components/AstraScoreForm';
import { AstraEpisodeJournal } from './components/AstraEpisodeJournal';
import { AstraRadarPreview } from './components/AstraRadarPreview';
import { AstraRatingHeader } from './components/AstraRatingHeader';
import { MediaListStatus } from '@/api/AnilistTypes';
import { log } from '@core/logger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ToastService } from '@core/services/ToastService';

/**
 * Enterprise implementation of the Rating Modal Controller.
 * Adheres to Clean Architecture by delegating data operations to specialized services.
 */
@injectable()
@singleton()
export class AstraRatingController extends AstraView {
  private overlay: HTMLElement | null = null;
  private work: AstraWork | null = null;
  private media: any = null;
  private allCustomLists: string[] = [];
  private currentSeasonIdx: number = 0;
  private activeTab: 'rating' | 'journal' = 'rating';
  private isSaving: boolean = false;
  private isDirty: boolean = false;

  // Sub-components
  private header: AstraRatingHeader;
  private scoreForm: AstraScoreForm;
  private journalView: AstraEpisodeJournal;
  private radarPreview: AstraRadarPreview;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.IAstraRatingService) private ratingService: IAstraRatingService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super({});
    this.header = new AstraRatingHeader({});
    this.scoreForm = new AstraScoreForm(this.service, this.eventBus);
    this.journalView = new AstraEpisodeJournal(this.eventBus);
    this.radarPreview = new AstraRadarPreview({});

    // Global listener for opening
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN_MODAL, (detail: any) => this.open(detail.mediaId));
  }

  /**
   * Opens the rating modal.
   */
  public async open(mediaId: number): Promise<void> {
    if (this.overlay) return;

    log.info(`[AstraRatingController] Opening modal for mediaId: ${mediaId}`);
    
    // Delegate data fetching to Service
    const data = await this.ratingService.fetchInitialData(mediaId);
    if (!data) {
      this.toast.error('Failed to load AniList data.');
      return;
    }

    const { media, allCustomLists } = data;
    this.media = media;
    this.allCustomLists = allCustomLists;

    const mediaType = media.type === 'MANGA' && media.format === 'NOVEL' ? 'novel' : media.type.toLowerCase() as 'anime' | 'manga';
    this.work = await this.service.getWork(mediaId) || this.createDefaultWork(media, mediaType);
    this.currentSeasonIdx = this.work.seasons.length - 1;
    this.activeTab = 'rating';
    this.isDirty = false;

    this.renderContainer();

    // ESC key listener
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
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
    document.body.appendChild(this.overlay);
    document.body.style.overflow = 'hidden';

    this.mount(this.overlay);

    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  public async close(): Promise<void> {
    if (!this.overlay) return;

    // Auto-save on close if dirty
    if (this.isDirty && !this.isSaving) {
      log.info('[AstraRatingController] Auto-saving before close');
      await this.save(false);
    }

    this.overlay.classList.add('astra-modal-overlay--closing');
    setTimeout(() => {
      this.unmount();
      this.overlay?.remove();
      this.overlay = null;
      document.body.style.overflow = '';
    }, 350);
  }

  protected template(): string {
    return `
      <div class="astra-modal astra-modal--rating astra-v2">
        <div id="astra-header-mount"></div>
        <nav class="astra-modal-nav">
          <div class="astra-nav-item ${this.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa fa-sliders"></i> <span>Rating</span>
          </div>
          <div class="astra-nav-item ${this.activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa fa-book"></i> <span>Journal</span>
          </div>
          <div class="astra-nav-spacer"></div>
        </nav>

        <div class="astra-modal-main">
          <div id="astra-rating-content">
             <!-- Tab content mounts here -->
          </div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    if (!this.work) return;

    const headerMount = this.$('#astra-header-mount');
    if (headerMount) {
      const season = this.work.seasons[this.currentSeasonIdx];
      this.header.mount(headerMount, {
        mediaId: this.work.mediaId,
        title: this.work.title,
        manualOverride: !!season.manualOverride,
        isSeriesFinale: !!season.isSeriesFinale,
        showFinale: this.service.getSettings().enableSeriesFinale && this.service.hasFinaleSection(),
        onOverrideToggle: (active: boolean) => this.handleOverrideToggle(active),
        onFinaleToggle: () => this.handleFinaleToggle(),
        onClose: () => this.close(),
        activeTab: this.activeTab
      });
    }

    this.renderTabContent();
  }

  private renderTabContent(): void {
    const content = this.$('#astra-rating-content');
    if (!content || !this.work) return;

    content.innerHTML = '';

    if (this.activeTab === 'rating') {
      const layout = document.createElement('div');
      layout.className = 'astra-rating-v2-layout';
      content.appendChild(layout);

      const formMount = document.createElement('div');
      formMount.id = 'astra-form-mount';
      layout.appendChild(formMount);

      const radarMount = document.createElement('div');
      radarMount.id = 'astra-radar-mount';
      layout.appendChild(radarMount);

      this.scoreForm.mount(formMount, {
        work: this.work,
        seasonIdx: this.currentSeasonIdx,
        allCustomLists: this.allCustomLists,
        entry: this.media.mediaListEntry
      });

      const season = this.work.seasons[this.currentSeasonIdx];
      this.radarPreview.mount(radarMount, {
        scores: this.consolidateScores(season.scores),
        sections: this.service.getSections()
      });
    } else {
      this.journalView.mount(content, {
        work: this.work,
        seasonIdx: this.currentSeasonIdx,
        progress: this.media.mediaListEntry?.progress || 0,
        total: this.media.episodes,
        airedCount: this.media.nextAiringEpisode ? this.media.nextAiringEpisode.episode - 1 : (this.media.status === 'FINISHED' ? this.media.episodes : (this.media.episodes || 0))
      });
    }
  }

  private consolidateScores(rawScores: Record<string, number | null>): Record<string, number | null> {
    const sections = this.service.getSections();
    const consolidated: Record<string, number | null> = {};
    sections.forEach(s => {
      consolidated[s.id] = this.service.calcSectionScore(s, rawScores);
    });
    return consolidated;
  }

  protected bindEvents(): void {
    this.$$('.astra-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = (item as HTMLElement).dataset.tab as 'rating' | 'journal';
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.$$('.astra-nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
          this.renderTabContent();
          const currentState = this.header.getState();
          if (currentState) {
            this.header.update({ ...currentState, activeTab: tab });
          }
        }
      });
    });

    // Sub-component events via EventBus
    this.eventBus.on('astra-live-score-update', (payload: any) => this.handleScoreUpdate(payload));
    this.eventBus.on('astra-field-update', (payload: any) => this.handleFieldUpdate(payload));
    this.eventBus.on('astra-journal-update', (payload: any) => this.handleJournalUpdate(payload));
    this.eventBus.on('astra-save-request', () => this.save(true));
  }

  private handleScoreUpdate(payload: any): void {
    const { id, value } = payload;
    if (!this.work) return;
    const season = this.work.seasons[this.currentSeasonIdx];
    season.scores[id] = value;
    this.isDirty = true;

    const consolidated = this.consolidateScores(season.scores);
    this.radarPreview.updateRadar(consolidated, this.service.getSections());

    const overall = this.service.calcSeasonScore(season);
    const display = document.getElementById('astra-overall-val');
    if (display) {
      display.textContent = overall ? overall.toFixed(1) : '—';
    }
  }

  private handleFieldUpdate(payload: any): void {
    const { field, value } = payload;
    if (!this.work) return;

    if (field === 'status') this.work.status = value;
    else if (field === 'progress') this.work.progress = value;
    else (this.work as any)[field] = value;

    this.isDirty = true;
  }

  private handleJournalUpdate(payload: any): void {
    const { episode, text } = payload;
    if (!this.work) return;
    const season = this.work.seasons[this.currentSeasonIdx];
    if (!season.episodeNotes) season.episodeNotes = {};
    season.episodeNotes[episode] = { text };
    this.isDirty = true;
  }

  private handleOverrideToggle(active: boolean): void {
    if (!this.work) return;
    this.work.seasons[this.currentSeasonIdx].manualOverride = active;
    this.isDirty = true;
    this.renderTabContent();
  }

  private handleFinaleToggle(): void {
    if (!this.work) return;
    const season = this.work.seasons[this.currentSeasonIdx];
    season.isSeriesFinale = !season.isSeriesFinale;
    this.isDirty = true;
    this.renderTabContent();
  }

  /**
   * Orchestrates the save process by delegating to AstraRatingService.
   */
  private async save(shouldClose: boolean): Promise<void> {
    if (this.isSaving || !this.work || !this.overlay) return;
    
    this.isSaving = true;
    const saveBtn = this.$('#astra-save-btn') as HTMLButtonElement;
    const originalHTML = saveBtn?.innerHTML || '';
    
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
    }

    try {
      const season = this.work.seasons[this.currentSeasonIdx];
      
      // Update work object with latest form values
      const startDateInput = this.$('#astra-start-date') as HTMLInputElement;
      const finishDateInput = this.$('#astra-finish-date') as HTMLInputElement;
      const notesArea = this.$('#astra-general-notes') as HTMLTextAreaElement;

      if (startDateInput) season.startDate = startDateInput.value;
      if (finishDateInput) season.endDate = finishDateInput.value;
      if (notesArea) season.notes = notesArea.value;

      const customLists = Array.from(this.$$('.astra-custom-list-cb:checked')).map(cb => (cb as HTMLInputElement).dataset.name!);
      this.work.customLists = customLists;

      const privateCb = this.$('#astra-private-cb') as HTMLInputElement;
      const hideCb = this.$('#astra-hide-cb') as HTMLInputElement;
      const progressInput = this.$('#astra-progress') as HTMLInputElement;
      const repeatInput = this.$('#astra-repeat') as HTMLInputElement;
      
      const overall = this.service.calcSeasonScore(season) || 0;

      this.isDirty = false;

      // Delegate to Service
      await this.ratingService.saveAndSync(this.work, {
        overallScore: overall,
        progress: progressInput ? parseInt(progressInput.value) : undefined,
        repeat: repeatInput ? parseInt(repeatInput.value) : undefined,
        private: privateCb?.checked,
        hidden: hideCb?.checked,
        notes: this.work.notes,
        customLists: customLists
      });

      if (saveBtn) {
        saveBtn.innerHTML = '<i class="fa fa-check"></i> Saved!';
        saveBtn.classList.add('astra-save-success');
      }

      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { mediaId: this.work.mediaId });

      if (shouldClose) {
        setTimeout(() => this.close(), 300);
      }
    } catch (err) {
      log.error('[AstraRatingController] Save failed', err);
      this.toast.error('Failed to sync ratings.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHTML;
      }
    } finally {
      this.isSaving = false;
    }
  }
}
