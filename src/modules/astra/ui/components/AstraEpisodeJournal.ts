import { injectable } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import type { AstraEpisodeNote } from '../../AstraInterfaces';
import { AstraRatingStore, AstraRatingState } from '../state/AstraRatingStore';
import { html } from '@core/utils/Template';

/**
 * Component for tracking per-episode notes.
 * Connects to AstraRatingStore for state synchronization.
 */
@injectable()
export class AstraEpisodeJournal extends AstraView {
  private store: AstraRatingStore | null = null;

  constructor() {
    super({});
  }

  public connect(store: AstraRatingStore): void {
    this.store = store;
  }

  protected template(state: AstraRatingState): HTMLElement {
    if (!state || !state.media) return html`<div></div>`;
    const { work, currentSeasonIdx, media } = state;
    const season = work.seasons[currentSeasonIdx];
    const notes = season.episodeNotes || {};
    
    const progress = work.progress || 0;
    const total = media.episodes;
    const airedCount = media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : (media.status === 'FINISHED' ? media.episodes : (media.episodes || 0));

    return html`
      <div class="astra-journal-view">
        <div class="astra-journal-header">
           <h3>Season Journal</h3>
           <p class="astra-muted">Track your thoughts for every single episode.</p>
        </div>
        
        <div class="astra-ep-list">
          ${this.renderEpisodes(progress, total, notes, airedCount)}
        </div>
      </div>
    `;
  }

  private renderEpisodes(progress: number, total: number | null, notes: Record<number, AstraEpisodeNote>, airedCount: number | null): HTMLElement[] {
    const visibleCount = total || Math.max(progress, airedCount || 0, Object.keys(notes).length);
    const rows: HTMLElement[] = [];

    if (visibleCount === 0) {
      return [html`<div class="astra-empty-state">No episodes available to track.</div>` as any];
    }

    for (let i = 1; i <= visibleCount; i++) {
      const note = notes[i]?.text || '';
      const hasAired = airedCount === null || i <= airedCount;
      const isWatched = i <= progress;
      const isNotAired = !hasAired;
      const isLocked = hasAired && !isWatched;

      rows.push(html`
        <div class="astra-ep-row ${isLocked ? 'astra-ep-row--locked' : ''} ${isNotAired ? 'astra-ep-row--not-aired' : ''}" data-ep="${i}">
          <div class="astra-ep-num">
            <span class="astra-label-xs">EP</span>
            <span class="astra-ep-digit">${i}</span>
            ${isNotAired ? html`<span class="astra-ep-badge">NA</span>` : ''}
            ${isLocked ? html`<span class="astra-ep-badge"><i class="fa fa-lock"></i></span>` : ''}
          </div>
          <div class="astra-ep-body">
            <textarea class="astra-ep-textarea" data-ep="${i}" 
              placeholder="${isNotAired ? 'Episode not yet aired' : (isLocked ? 'Watch this episode to add notes' : `Notes for episode ${i}...`)}" 
              ${isLocked || isNotAired ? 'disabled' : ''}>${note}</textarea>
          </div>
        </div>
      `);
    }

    return rows;
  }

  protected bindEvents(): void {
    if (!this.store) return;

    this.$$('.astra-ep-textarea').forEach(area => {
      area.addEventListener('input', (e) => {
        const ep = parseInt(area.closest('.astra-ep-row')?.getAttribute('data-ep') || '0');
        const text = (e.target as HTMLTextAreaElement).value;
        this.store?.updateJournal(ep, text);
      });
    });
  }
}
