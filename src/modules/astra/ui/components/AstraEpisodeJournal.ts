/**
 * @file AstraEpisodeJournal.ts
 * @description Component for the per-episode journal tab
 */

import { AstraView } from '../base/AstraView';
import { AstraWork, AstraEpisodeNote } from '../../AstraService';
import { AstraJournalService } from '../../services/AstraJournalService';

export class AstraEpisodeJournal extends AstraView {
  constructor(_journalService: AstraJournalService) {
    super({});
  }

  protected template(state: { work: AstraWork, seasonIdx: number, progress: number, total: number }): string {
    const { work, seasonIdx, progress, total } = state;
    const season = work.seasons[seasonIdx];
    const notes = season.episodeNotes || {};

    return `
      <div class="astra-journal-view">
        <div class="astra-journal-header">
           <h3>Season Journal</h3>
           <p class="astra-muted">Track your thoughts for every single episode.</p>
        </div>
        
        <div class="astra-ep-list">
          ${this.renderEpisodes(progress, total, notes)}
        </div>
      </div>
    `;
  }

  private renderEpisodes(progress: number, total: number, notes: Record<number, AstraEpisodeNote>): string {
    const count = total || progress || 0;
    let html = '';

    for (let i = 1; i <= count; i++) {
      const note = notes[i];
      const isAired = i <= (progress || count);
      
      html += `
        <div class="astra-ep-row ${!isAired ? 'astra-ep-row--unaired' : ''}" data-ep="${i}">
          <div class="astra-ep-num">EP ${i}</div>
          <div class="astra-ep-content">
            <textarea class="astra-ep-textarea" placeholder="Notes for episode ${i}...">${note?.text || ''}</textarea>
          </div>
          <div class="astra-ep-score-box">
             <input type="number" class="astra-ep-score-input" min="0" max="10" step="0.5" value="${note?.score || ''}" placeholder="—">
          </div>
        </div>
      `;
    }

    return html || '<div class="astra-empty-state">No episodes available to track.</div>';
  }

  protected bindEvents(): void {
    this.$$('.astra-ep-textarea').forEach(area => {
      area.addEventListener('blur', (e) => {
        const ep = parseInt(area.closest('.astra-ep-row')?.getAttribute('data-ep') || '0');
        const text = (e.target as HTMLTextAreaElement).value;
        this.onNoteChange(ep, { text });
      });
    });

    this.$$('.astra-ep-score-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const ep = parseInt(input.closest('.astra-ep-row')?.getAttribute('data-ep') || '0');
        const score = parseFloat((e.target as HTMLInputElement).value);
        this.onNoteChange(ep, { score });
      });
    });
  }

  private onNoteChange(episode: number, data: Partial<AstraEpisodeNote>): void {
     // Notify controller to save
     window.dispatchEvent(new CustomEvent('astra-journal-update', {
       detail: { episode, data }
     }));
  }
}
