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
import { AstraWorkSummary } from '../../AstraInterfaces';
import { AstraRatingController } from '../AstraRatingController';
import { TOKENS } from '@core/di/tokens';
import { html, map } from '@core/utils/Template';
import { AstraRowRenderer } from './AstraRowRenderer';

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
   * Performance: Surgical update of the grid body only.
   * Prevents full rerender stuttering with thousands of entries.
   */
  protected override onUpdate(): boolean {
    const body = this.$('.astra-grid-body');
    if (!body) return false;

    const state = this.props;
    const sections = this.service.getSections();
    
    // Clear and batch-append using DocumentFragment
    body.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    state.filteredWorks.forEach((work: AstraWorkSummary) => {
      fragment.appendChild(AstraRowRenderer.render(work, sections, (id) => this.ratingController.open(id)));
    });
    
    body.appendChild(fragment);
    return true;
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
          <div class="astra-grid-header" style="display: grid; grid-template-columns: 60px 1fr 80px 80px var(--astra-dynamic-cols) 100px;">
            <div class="astra-col-cover">Cover</div>
            <div class="astra-col-title">Title</div>
            <div class="astra-col-type">Type</div>
            <div class="astra-col-score">Score</div>
            ${map(sections, (s: any) => html`<div class="astra-col-section">${s.name}</div>`)}
            <div class="astra-col-actions">Actions</div>
          </div>
          <div class="astra-grid-body">
            ${map(works, (w: AstraWorkSummary) => AstraRowRenderer.render(w, sections, (id: number) => this.ratingController.open(id)))}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Binds navigation and modal events.
   */
  protected bindEvents(): void {
    // Events are handled per-row in AstraRowRenderer for better modularity
  }

  /**
   * Focuses and highlights a specific entry in the table.
   * 
   * @param mediaId AniList media ID to focus
   */
  public focusEntry(mediaId: number): void {
    const row = this.$(`.astra-grid-row[data-media-id="${mediaId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('astra-row-focus-pulse');
      // Force reflow for animation restart
      void (row as HTMLElement).offsetWidth; 
      row.classList.add('astra-row-focus-pulse');
      setTimeout(() => row.classList.remove('astra-row-focus-pulse'), 4000);
    }
  }
}
