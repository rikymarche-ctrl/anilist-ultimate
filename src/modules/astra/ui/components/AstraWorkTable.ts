/**
 * @file AstraWorkTable.ts
 * @description Main data grid for Astra works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState } from '../../interfaces/IDashboardState';
import { AstraService } from '../../AstraService';
import type { AstraWorkSummary } from '../../AstraInterfaces';
import { AstraRatingController } from '../AstraRatingController';
import { TOKENS } from '@core/di/tokens';
import { html, map } from '@core/utils/Template';

@injectable()
export class AstraWorkTable extends AstraView {
  constructor(
    @inject(TOKENS.AstraStore) _store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraRatingController) private ratingController: AstraRatingController
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  /**
   * Renders the data grid using safe templates.
   */
  protected template(state: IDashboardState): HTMLElement {
    if (!this.service || !state || !state.filteredWorks) return html`<div></div>`;
    const sections = this.service.getSections();
    const works = state.filteredWorks;

    if (works.length === 0) {
      return html`
        <div class="astra-empty-state">
          <i class="fa fa-search"></i>
          <p>No works found matching your filters.</p>
        </div>
      `;
    }

    return html`
      <div class="astra-table-wrap">
        <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 105px)">
          <div class="astra-grid-header">
            <div class="astra-col-cover">Cover</div>
            <div class="astra-col-title">Title</div>
            <div class="astra-col-type">Type</div>
            <div class="astra-col-score">Score</div>
            ${map(sections, s => html`<div class="astra-col-section">${s.name}</div>`)}
            <div class="astra-col-actions">Actions</div>
          </div>
          <div class="astra-grid-body">
            ${map(works, w => this.renderRow(w, sections))}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders a single row for a work entry.
   */
  private renderRow(work: AstraWorkSummary, sections: any[]): HTMLElement {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    let percent = (total && total > 0) ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;
    
    if (percent === 0 && (work.progress || 0) > 0) percent = 5;

    const overallScore = work.currentScore;
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';
    
    return html`
      <div class="astra-grid-row" data-media-id="${work.mediaId}" style="--progress-val: ${percent}%">
        <div class="astra-col-cover">
          <img src="${work.cover}" class="astra-table-cover" loading="lazy">
        </div>
        <div class="astra-col-title">
          <div class="astra-table-title-box">
            <div class="astra-table-title">${work.title}</div>
            <div class="astra-table-subtitle">
              <span class="astra-badge astra-badge--country">${work.country || 'JP'}</span>
              <span class="astra-badge astra-badge--progress">${work.progress || 0} / ${total || '?'}</span>
            </div>
          </div>
        </div>
        <div class="astra-col-type">
          <span class="astra-badge astra-badge--type">${work.type?.toUpperCase()}</span>
        </div>
        <div class="astra-col-score">
          <div class="astra-table-score-badge ${scoreClass}">${overallScore ? overallScore.toFixed(1) : '-'}</div>
        </div>
        ${map(sections, s => {
          const score = work.sectionScores ? work.sectionScores[s.id] : null;
          return html`
            <div class="astra-col-section" style="color: ${score ? 'var(--astra-accent)' : 'var(--astra-muted)'}">
              ${score ? (score as number).toFixed(1) : '-'}
            </div>
          `;
        })}
        <div class="astra-col-actions">
          <button class="astra-icon-btn astra-edit-row" title="Edit Entry">
            <i class="fa fa-pencil-alt"></i>
          </button>
          <a class="astra-icon-btn" href="https://anilist.co/${work.type}/${work.mediaId}" target="_blank" title="View on AniList">
            <i class="fa fa-external-link-alt"></i>
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Binds row actions (edit, external link).
   */
  protected bindEvents(): void {
    this.$$('.astra-grid-row').forEach(row => {
      const mediaId = parseInt(row.getAttribute('data-media-id') || '0');
      
      const editBtn = row.querySelector('.astra-edit-row');
      if (editBtn) {
        this.addEventListener(editBtn as HTMLElement, 'click', (e) => {
          e.stopPropagation();
          this.ratingController.open(mediaId);
        });
      }

      const title = row.querySelector('.astra-table-title');
      if (title) {
        this.addEventListener(title as HTMLElement, 'click', () => {
          this.ratingController.open(mediaId);
        });
      }
    });
  }
}
