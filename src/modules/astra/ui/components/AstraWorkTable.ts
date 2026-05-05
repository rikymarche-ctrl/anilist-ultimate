/**
 * @file AstraWorkTable.ts
 * @description Main data grid for Astra works
 */

import { AstraView } from '../base/AstraView';
import { AstraStore, DashboardState } from '../../store/AstraStore';
import { AstraService, AstraWork } from '../../AstraService';
import { AstraRatingController } from '../AstraRatingController';
import { container, inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

@injectable()
export class AstraWorkTable extends AstraView {
  constructor(
    @inject(TOKENS.AstraStore) _store: AstraStore,
    @inject(TOKENS.AstraService) private service: AstraService
  ) {
    super({});
  }

  protected template(state: DashboardState): string {
    const sections = this.service.getSections();
    const works = state.filteredWorks;

    if (works.length === 0) {
      return `
        <div class="astra-empty-state">
          <i class="fa fa-search"></i>
          <p>No works found matching your filters.</p>
        </div>
      `;
    }

    return `
      <div class="astra-table-wrap">
        <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 105px)">
          <div class="astra-grid-header">
            <div class="astra-col-cover">Cover</div>
            <div class="astra-col-title">Title</div>
            <div class="astra-col-type">Type</div>
            <div class="astra-col-score">Score</div>
            ${sections.map(s => `<div class="astra-col-section">${s.name}</div>`).join('')}
            <div class="astra-col-actions">Actions</div>
          </div>
          <div class="astra-grid-body">
            ${works.map(w => this.renderRow(w, sections)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderRow(work: AstraWork, sections: any[]): string {
    const lastSeason = work.seasons[work.seasons.length - 1];
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    let percent = (total && total > 0) ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;
    
    // Fallback for active titles with unknown total
    if (percent === 0 && (work.progress || 0) > 0) percent = 5;

    const overallScore = this.service.calcSeriesOverall(work);
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';
    
    return `
      <div class="astra-grid-row" data-media-id="${work.mediaId}" style="--progress-val: ${percent}%">
        <div class="astra-col-cover">
          <img src="${work.cover}" class="astra-table-cover">
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
        ${sections.map(s => {
          const score = lastSeason.scores[s.id];
          return `<div class="astra-col-section" style="color: ${score ? 'var(--astra-accent)' : 'var(--astra-muted)'}">${score ? (score as number).toFixed(1) : '-'}</div>`;
        }).join('')}
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

  protected bindEvents(): void {
    const modal = container.resolve<AstraRatingController>(TOKENS.AstraRatingController);

    this.$$('.astra-grid-row').forEach(row => {
      const mediaId = parseInt(row.getAttribute('data-media-id') || '0');
      
      // Edit button or click on title
      row.querySelector('.astra-edit-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.open(mediaId);
      });

      row.querySelector('.astra-table-title')?.addEventListener('click', () => {
        modal.open(mediaId);
      });
    });
  }
}
