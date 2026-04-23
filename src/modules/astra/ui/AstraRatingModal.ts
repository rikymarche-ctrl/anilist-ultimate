import { injectable, inject, singleton } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { AstraService, AstraWork } from '../AstraService';
import { AstraRadarChart } from './AstraRadarChart';
import { anilistClient } from '@/api/AnilistClient';

@singleton()
@injectable()
export class AstraRatingModal {
  private overlay: HTMLElement | null = null;
  private currentWork: AstraWork | undefined = undefined;
  private currentSeasonIdx = 0;
  private mediaMetadata: any = null;

  constructor(
    @inject(TOKENS.AstraService) private astraService: AstraService
  ) {}

  public async open(mediaId: number): Promise<void> {
    log.info(`[AstraRatingModal] Opening for mediaId: ${mediaId}`);
    await this.astraService.init();

    let work = this.astraService.getWorkByMediaId(mediaId);
    this.mediaMetadata = await this.fetchAniListData(mediaId);

    if (!work) {
      work = {
        ...this.mediaMetadata,
        seasons: [this.astraService.createDefaultSeason()]
      };
    } else {
      // Update basic info in case it changed on AniList
      work.status = this.mediaMetadata.status;
    }

    this.currentWork = work;
    this.currentSeasonIdx = work!.seasons.length - 1;

    this.render();
  }

  private async fetchAniListData(mediaId: number): Promise<any> {
    const GQL = `query($id: Int) {
      Media(id: $id) {
        id title { userPreferred } type format episodes
        coverImage { large extraLarge color }
        mediaListEntry { status progress score(format: POINT_100) notes }
      }
    }`;

    const data = await anilistClient.query<any>(GQL, { id: mediaId });
    const media = data?.Media;
    if (!media) throw new Error('AniList Media not found');

    const entry = media.mediaListEntry;
    return {
      id: `w_${Math.random().toString(36).slice(2, 11)}`,
      mediaId: media.id,
      title: media.title.userPreferred,
      type: media.type.toLowerCase(),
      cover: media.coverImage.extraLarge || media.coverImage.large,
      coverColor: media.coverImage.color,
      status: entry?.status?.toLowerCase() || 'planning',
      progress: entry?.progress || 0,
      totalEpisodes: media.episodes,
      notes: entry?.notes || '',
      updatedAt: Date.now()
    };
  }

  private render(): void {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'astra-modal-overlay';
      document.body.appendChild(this.overlay);
    }

    const work = this.currentWork!;
    const meta = this.mediaMetadata;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const overall = this.astraService.calcSeasonOverall(season.scores, season.skip);

    this.overlay.innerHTML = `
      <div class="astra-modal">
        <header class="astra-modal-header">
          <h2 class="astra-modal-title"><a href="/user/astra">Astra Rating</a></h2>
          <button class="astra-modal-close"><i class="fa fa-times"></i></button>
        </header>
        <div class="astra-modal-body">
          <div class="astra-media-header">
            <img src="${work.cover}" class="astra-header-cover">
            <div class="astra-header-info">
              <div class="astra-modal-title">${work.title}</div>
              <div class="astra-quick-row">
                <div class="astra-input-box">
                  <span class="astra-label-sm">Status</span>
                  <select class="astra-select" id="astra-status">
                    <option value="current" ${work.status==='current'?'selected':''}>Watching</option>
                    <option value="planning" ${work.status==='planning'?'selected':''}>Planning</option>
                    <option value="completed" ${work.status==='completed'?'selected':''}>Completed</option>
                    <option value="dropped" ${work.status==='dropped'?'selected':''}>Dropped</option>
                    <option value="paused" ${work.status==='paused'?'selected':''}>Paused</option>
                  </select>
                </div>
                <div class="astra-input-box">
                  <span class="astra-label-sm">Progress</span>
                  <div class="astra-quick-row">
                    <div class="astra-stepper">
                      <button class="astra-step-btn" data-dir="-1">-</button>
                      <input type="number" class="astra-number-input" id="astra-progress" value="${meta.progress}" min="0">
                      <button class="astra-step-btn" data-dir="1">+</button>
                    </div>
                    <span class="astra-muted">/ ${meta.totalEpisodes || '?'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="astra-form">
            <div class="astra-form-scroll">
              <div class="astra-field-group">
                ${sections.map(s => this.renderScoreInput(s, season.scores[s.id])).join('')}
              </div>
            </div>
            
            <div class="astra-form-footer">
              <div class="astra-notes-area">
                <span class="astra-label-sm">Rating Notes</span>
                <textarea class="astra-textarea" placeholder="What did you think of this season/work?">${season.notes || ''}</textarea>
              </div>

              <div class="astra-overall-box">
                <div class="astra-overall-label">Weighted Score</div>
                <div class="astra-overall-val" style="color: ${AstraRadarChart.getScoreColor(overall)}">
                  ${overall === null ? '—' : overall.toFixed(1)}
                </div>
              </div>
            </div>
          </div>

          <aside class="astra-sidebar">
            <div class="astra-radar-container">
              ${AstraRadarChart.getHTML(season.scores, sections, season.skip, 250)}
            </div>
          </aside>
        </div>
        <footer class="astra-modal-footer">
          <button class="astra-btn astra-btn--secondary" id="astra-cancel">Cancel</button>
          <button class="astra-btn astra-btn--primary" id="astra-save">Save Entry</button>
        </footer>
      </div>
    `;

    this.attachEvents();
    this.overlay.classList.add('astra-modal-overlay--open');
  }

  private renderScoreInput(section: any, value: number | null): string {
    return `
      <div class="astra-score-input" data-id="${section.id}">
        <div class="astra-score-label">
          ${section.name}
          <span class="astra-score-val" style="color: ${AstraRadarChart.getScoreColor(value)}">
            ${value === null ? '—' : value.toFixed(1)}
          </span>
        </div>
        <input type="range" class="astra-slider" min="0" max="10" step="0.1" value="${value || 0}">
      </div>
    `;
  }

  private attachEvents(): void {
    const closeBtn = this.overlay!.querySelector('.astra-modal-close');
    const cancelBtn = this.overlay!.querySelector('#astra-cancel');
    const saveBtn = this.overlay!.querySelector('#astra-save');
    const sliders = this.overlay!.querySelectorAll('.astra-slider');
    const textarea = this.overlay!.querySelector('.astra-textarea') as HTMLTextAreaElement;
    const statusSelect = this.overlay!.querySelector('#astra-status') as HTMLSelectElement;
    const progressInput = this.overlay!.querySelector('#astra-progress') as HTMLInputElement;
    const stepBtns = this.overlay!.querySelectorAll('.astra-step-btn');

    stepBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = parseInt((btn as HTMLElement).dataset.dir || '0');
        const val = parseInt(progressInput.value) + dir;
        if (val >= 0) progressInput.value = val.toString();
      });
    });

    const close = () => {
      this.overlay!.classList.remove('astra-modal-overlay--open');
      document.body.style.overflow = '';
    };

    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    
    this.overlay!.addEventListener('click', (e) => {
      if (e.target === this.overlay) close();
    });

    document.body.style.overflow = 'hidden';

    sliders.forEach(slider => {
      slider.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        const id = (e.target as HTMLElement).closest('.astra-score-input')?.getAttribute('data-id');
        if (id) {
          this.currentWork!.seasons[this.currentSeasonIdx].scores[id] = val;
          this.updateLivePreview();
        }
      });
    });

    textarea?.addEventListener('input', (e) => {
      this.currentWork!.seasons[this.currentSeasonIdx].notes = (e.target as HTMLTextAreaElement).value;
    });

    saveBtn?.addEventListener('click', async () => {
      (saveBtn as HTMLButtonElement).disabled = true;
      (saveBtn as HTMLButtonElement).innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';
      
      // Update local work status
      this.currentWork!.status = statusSelect.value;
      
      await this.astraService.saveWork(this.currentWork!);
      
      // Sync back to AniList
      const season = this.currentWork!.seasons[this.currentSeasonIdx];
      const overall = this.astraService.calcSeasonOverall(season.scores, season.skip) || 0;
      
      const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$score:Int) {
        SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$score) { id status progress score }
      }`;

      try {
        await anilistClient.query(GQL_SAVE, {
          mediaId: this.currentWork!.mediaId,
          status: statusSelect.value.toUpperCase(),
          progress: parseInt(progressInput.value),
          score: Math.round(overall * 10)
        });
        
        // Trigger calendar update
        window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
      } catch (err) {
        log.error('[AstraRatingModal] Failed to sync with AniList', err);
      }
      
      close();
    });
  }

  private updateLivePreview(): void {
    const work = this.currentWork!;
    const season = work.seasons[this.currentSeasonIdx];
    const sections = this.astraService.getSections();
    const overall = this.astraService.calcSeasonOverall(season.scores, season.skip);

    const overallVal = this.overlay!.querySelector('.astra-overall-val') as HTMLElement;
    if (overallVal) {
      overallVal.textContent = overall === null ? '—' : overall.toFixed(1);
      overallVal.style.color = AstraRadarChart.getScoreColor(overall);
    }

    const radarContainer = this.overlay!.querySelector('.astra-radar-container');
    if (radarContainer) {
      radarContainer.innerHTML = AstraRadarChart.getHTML(season.scores, sections, season.skip, 250);
    }

    sections.forEach(s => {
      const row = this.overlay!.querySelector(`.astra-score-input[data-id="${s.id}"]`);
      if (row) {
        const valEl = row.querySelector('.astra-score-val') as HTMLElement;
        const v = season.scores[s.id];
        const isNum = typeof v === 'number' && !isNaN(v);
        valEl.textContent = isNum ? v.toFixed(1) : '—';
        valEl.style.color = AstraRadarChart.getScoreColor(v);
      }
    });
  }
}
