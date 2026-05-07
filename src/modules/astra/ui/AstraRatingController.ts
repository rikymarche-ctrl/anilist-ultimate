import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService, AstraWork } from '../AstraService';
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

/**
 * Enterprise implementation of the Rating Modal Controller.
 * Refactored to use AstraRatingStore for state management.
 */
@injectable()
@singleton()
export class AstraRatingController extends AstraView {
  private overlay: HTMLElement | null = null;
  private store: AstraRatingStore | null = null;
  private isSaving: boolean = false;

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
    this.journalView = new AstraEpisodeJournal();
    this.radarPreview = new AstraRadarPreview({});

    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN_MODAL, (detail: any) => this.open(detail.mediaId));
  }

  public async open(mediaId: number): Promise<void> {
    if (this.overlay) return;

    log.info(`[AstraRatingController] Opening modal for mediaId: ${mediaId}`);

    const data = await this.ratingService.fetchInitialData(mediaId);
    if (!data) {
      this.toast.error('Failed to load AniList data.');
      return;
    }

    const { media, allCustomLists } = data;
    const mediaType = media.type === 'MANGA' && media.format === 'NOVEL' ? 'novel' : media.type.toLowerCase() as 'anime' | 'manga';
    const work = await this.service.getFullWork(mediaId) || this.createDefaultWork(media, mediaType);

    // Initialize Store
    this.store = new AstraRatingStore({
      work,
      media,
      allCustomLists,
      currentSeasonIdx: work.seasons.length - 1,
      activeTab: 'rating'
    }, this.eventBus);

    this.scoreForm.connect(this.store);
    this.journalView.connect(this.store);

    this.renderContainer();

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
    if (!this.overlay || !this.store) return;

    if (this.store.getState().isDirty && !this.isSaving) {
      log.info('[AstraRatingController] Auto-saving before close');
      await this.save(false);
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

  protected template(): string {
    const state = this.store?.getState();
    const activeTab = state?.activeTab || 'rating';
    const isDirty = state?.isDirty || false;

    return `
      <div class="astra-modal astra-modal--rating">
        <nav class="astra-modal-nav">
          <div class="astra-nav-item astra-nav-item--ghost"></div>
          <div class="astra-nav-item ${activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa fa-sliders"></i> <span>Rating</span>
          </div>
          <div class="astra-nav-item ${activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa fa-book"></i> <span>Journal</span>
          </div>
          <div style="flex: 1;"></div>
          <div class="astra-nav-item astra-nav-save ${isDirty ? 'dirty' : ''} ${activeTab !== 'journal' ? 'hidden' : ''}" id="sidebar-save-btn">
            <i class="fa fa-check"></i> <span>Save</span>
          </div>
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

    content.innerHTML = '';

    if (state.activeTab === 'rating') {
      const formMount = document.createElement('div');
      formMount.id = 'astra-form-mount';
      content.appendChild(formMount);

      this.scoreForm.mount(formMount, state);

      const radarTarget = formMount.querySelector('.astra-radar-mount');
      if (radarTarget) {
        const season = state.work.seasons[state.currentSeasonIdx];
        this.radarPreview.mount(radarTarget as HTMLElement, {
          scores: this.consolidateScores(season.scores),
          sections: this.service.getSections()
        });
      }

      const season = state.work.seasons[state.currentSeasonIdx];
      const overall = this.service.calcSeasonScore(season);
      this.updateOverallScore(overall);
    } else {
      this.journalView.mount(content, state);
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
        if (tab) this.store?.setTab(tab);
      });
    });

    this.$('#sidebar-save-btn')?.addEventListener('click', () => this.save(true));

    this.eventBus.on('astra-store-updated', (payload: any) => this.handleStoreUpdate(payload));
    this.eventBus.on('astra-save-request', () => this.save(true));
  }

  private handleStoreUpdate(payload: any): void {
    const { state, type } = payload;

    if (type === 'tab-change') {
      this.$$('.astra-nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === state.activeTab));
      this.$('#sidebar-save-btn')?.classList.toggle('hidden', state.activeTab !== 'journal');
      this.renderTabContent();
      this.header.update({ ...this.header.getState(), activeTab: state.activeTab });
    } else if (type === 'dirty-change') {
      const saveBtn = this.$('#sidebar-save-btn');
      if (saveBtn) {
        saveBtn.classList.toggle('dirty', state.isDirty);
        saveBtn.classList.toggle('hidden', state.activeTab !== 'journal');
      }
    } else if (type === 'score-update' || type === 'override-change') {
      const season = state.work.seasons[state.currentSeasonIdx];
      const consolidated = this.consolidateScores(season.scores);
      this.radarPreview.updateRadar(consolidated, this.service.getSections());

      const overall = this.service.calcSeasonScore(season);
      this.updateOverallScore(overall);
    } else if (type === 'season-update' || type === 'state-change') {
      // Avoid full re-render for notes to preserve focus
      if (payload.field === 'notes') return;

      this.renderHeader();
      this.renderTabContent();
    }
  }

  private async save(shouldClose: boolean): Promise<void> {
    const state = this.store?.getState();
    if (this.isSaving || !state || !this.overlay) return;

    this.isSaving = true;
    this.store?.setSaving(true);
    const saveBtn = this.$('#astra-save-btn') as HTMLButtonElement;
    const originalHTML = saveBtn?.innerHTML || '';

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
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
        completedAt: entry?.completedAt
      });

      this.store?.setDirty(false);

      if (saveBtn) {
        saveBtn.innerHTML = '<i class="fa fa-check"></i> Saved!';
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
