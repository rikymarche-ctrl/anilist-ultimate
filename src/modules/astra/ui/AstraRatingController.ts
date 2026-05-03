/**
 * @file AstraRatingController.ts
 * @description Orchestrator for the Astra Rating Modal (V2)
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraService, AstraWork } from '../AstraService';
import { AstraView } from './base/AstraView';
import { AstraJournalService } from '../services/AstraJournalService';
import { AstraScoreForm } from './components/AstraScoreForm';
import { AstraEpisodeJournal } from './components/AstraEpisodeJournal';
import { AstraRadarPreview } from './components/AstraRadarPreview';
import { MediaListStatus, type MediaWithViewerResponse } from '@/api/AnilistTypes';
import { log } from '@core/logger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ToastService } from '@core/services/ToastService';

export interface RatingState {
  work: AstraWork;
  media: any;
  currentSeasonIdx: number;
  activeTab: 'rating' | 'journal';
  allCustomLists: string[];
}

@injectable()
@singleton()
export class AstraRatingController extends AstraView {
  private overlay: HTMLElement | null = null;
  private state: RatingState | null = null;

  // Sub-components
  private scoreForm: AstraScoreForm;
  private journalView: AstraEpisodeJournal;
  private radarPreview: AstraRadarPreview;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.AstraJournalService) private journalService: AstraJournalService,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super({});
    this.scoreForm = new AstraScoreForm(this.service);
    this.journalView = new AstraEpisodeJournal(this.journalService);
    this.radarPreview = new AstraRadarPreview({});

    // Global listener for opening (if not using direct calls)
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN_MODAL, (detail: any) => this.open(detail.mediaId));
  }

  public async open(mediaId: number): Promise<void> {
    if (this.overlay) return;

    const data = await this.fetchAniListData(mediaId);
    if (!data) return;

    const { media, allCustomLists } = data;
    const mediaType = media.type === 'MANGA' && media.format === 'NOVEL' ? 'novel' : media.type.toLowerCase() as 'anime' | 'manga';

    const work = await this.service.getWork(mediaId) || this.createDefaultWork(media, mediaType);
    
    this.state = {
      work,
      media,
      currentSeasonIdx: work.seasons.length - 1,
      activeTab: 'rating',
      allCustomLists
    };

    this.renderContainer();
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
      customLists: [],
      tags: [],
      notes: '',
      updatedAt: Date.now(),
      seasons: [{
        id: 's_1',
        label: 'Season 1',
        scores: {},
        notes: entry?.notes || '',
      }]
    };
  }

  private async fetchAniListData(mediaId: number): Promise<{ media: MediaWithViewerResponse['Media']; allCustomLists: string[] } | null> {
    const GQL = `query($id: Int) {
      Viewer { mediaListOptions { animeList { customLists } } }
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
      log.error('[AstraRatingController] Failed to fetch data', err);
      return null;
    }
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

  public close(): void {
    if (!this.overlay) return;
    this.overlay.classList.add('astra-modal-overlay--closing');
    setTimeout(() => {
      this.unmount();
      this.overlay?.remove();
      this.overlay = null;
      document.body.style.overflow = '';
    }, 350);
  }

  protected template(): string {
    if (!this.state) return '';
    
    return `
      <div class="astra-modal astra-modal--rating astra-v2">
        <nav class="astra-modal-nav">
          <div class="astra-nav-back" id="astra-modal-back-btn">
            <i class="fa fa-chevron-left"></i>
            <span>Back</span>
          </div>
          <div class="astra-nav-item ${this.state.activeTab === 'rating' ? 'active' : ''}" data-tab="rating">
            <i class="fa fa-sliders"></i> <span>Rating</span>
          </div>
          <div class="astra-nav-item ${this.state.activeTab === 'journal' ? 'active' : ''}" data-tab="journal">
            <i class="fa fa-book"></i> <span>Journal</span>
          </div>
          <div class="astra-nav-spacer"></div>
          <button class="astra-modal-close" id="astra-modal-close-btn"><i class="fa fa-times"></i></button>
        </nav>

        <div class="astra-modal-main">
          <div id="astra-rating-content">
             <!-- Sub-components mount here -->
          </div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    const content = this.$('#astra-rating-content');
    if (!content || !this.state) return;

    if (this.state.activeTab === 'rating') {
      content.innerHTML = `
        <div class="astra-rating-v2-layout">
          <div id="astra-form-mount"></div>
          <div id="astra-radar-mount"></div>
        </div>
      `;
      this.scoreForm.mount(this.$('#astra-form-mount')!, { work: this.state.work, seasonIdx: this.state.currentSeasonIdx });
      
      const season = this.state.work.seasons[this.state.currentSeasonIdx];
      this.radarPreview.mount(this.$('#astra-radar-mount')!, { 
        scores: this.consolidateScores(season.scores), 
        sections: this.service.getSections() 
      });
    } else {
      this.journalView.mount(content, {
        work: this.state.work,
        seasonIdx: this.state.currentSeasonIdx,
        progress: this.state.media.mediaListEntry?.progress || 0,
        total: this.state.media.episodes
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
        const tab = (item as HTMLElement).dataset.tab as any;
        if (tab && tab !== this.state?.activeTab) {
          this.state!.activeTab = tab;
          this.onMount(); // Use onMount to re-render content instead of full renderContainer
        }
      });
    });

    this.$('#astra-modal-back-btn')?.addEventListener('click', () => this.close());
    this.$('#astra-modal-close-btn')?.addEventListener('click', () => this.close());

    // Listen for score updates from ScoreForm
    window.addEventListener('astra-live-score-update', (e: any) => {
      const { sectionId, value } = e.detail;
      if (!this.state) return;
      
      const season = this.state.work.seasons[this.state.currentSeasonIdx];
      season.scores[sectionId] = value;
      
      const consolidated = this.consolidateScores(season.scores);
      this.radarPreview.updateRadar(consolidated, this.service.getSections());
      
      const overall = this.service.calcSeasonScore(season);
      const scoreDisplay = this.$('#astra-live-score');
      if (scoreDisplay) scoreDisplay.textContent = overall ? overall.toFixed(2) : '—';
    });

    // Listen for Save action
    this.$('#astra-save-btn')?.addEventListener('click', () => this.save());
  }

  private async save(): Promise<void> {
    if (!this.state || !this.overlay) return;
    
    this.overlay.classList.add('astra-saving');
    const work = this.state.work;
    const season = work.seasons[this.state.currentSeasonIdx];
    
    try {
      // 1. Save locally
      await this.service.saveWork(work);

      // 2. Sync to AniList
      const overall = this.service.calcSeasonScore(season) || 0;
      const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int,$notes:String) {
        SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score,notes:$notes) { id status progress score }
      }`;

      await this.api.mutate(GQL_SAVE, {
        mediaId: work.mediaId,
        status: work.status,
        progress: work.progress || 0,
        score: Math.round(overall * 10),
        notes: season.notes
      });

      this.toast.success('Ratings synced with AniList!');
      this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { mediaId: work.mediaId });
      
      this.close();
    } catch (err) {
      log.error('[AstraRatingController] Save failed', err);
      this.toast.error('Failed to sync ratings.');
    } finally {
      this.overlay.classList.remove('astra-saving');
    }
  }
}
