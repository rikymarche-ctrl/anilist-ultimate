/**
 * @file AstraWorkGrid.ts
 * @description Performance-optimized grid for displaying the filtered work list.
 * Implements chunked rendering to handle large datasets without UI lag.
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { AstraWorkSummary } from '../../AstraService';
import { getStatusLabel } from '@core/utils/UIHelpers';

/**
 * Enterprise-grade work grid with high-performance rendering logic.
 */
export class AstraWorkGrid extends BaseComponent {
  private readonly CHUNK_SIZE = 50;
  private renderedCount = 0;
  private works: AstraWorkSummary[] = [];

  constructor() {
    super({});
  }

  protected render(): HTMLElement {
    const element = this.createFromHTML(`
      <div class="astra-work-grid-container">
        <div class="astra-work-grid-header">
          <div class="col-cover"></div>
          <div class="col-title">Title</div>
          <div class="col-status">Status</div>
          <div class="col-progress">Progress</div>
          <div class="col-score">Astra Score</div>
          <div class="col-actions"></div>
        </div>
        <div class="astra-work-grid-body" id="astra-grid-body">
           <!-- Dynamic rows -->
        </div>
        <div id="astra-grid-sentinel" style="height: 20px;"></div>
      </div>
    `);

    this.setupInfiniteScroll(element);
    return element;
  }

  /**
   * Updates the dataset and resets rendering.
   */
  public updateWorks(works: AstraWorkSummary[]): void {
    this.works = works;
    this.renderedCount = 0;
    const body = this.querySelector('#astra-grid-body');
    if (body) {
      body.innerHTML = '';
      this.renderNextChunk();
    }
  }

  /**
   * Renders a single row for a work.
   */
  private createRow(work: AstraWorkSummary): HTMLElement {
    const score = work.currentScore;

    const row = this.createFromHTML(`
      <div class="astra-work-row" data-id="${work.mediaId}">
        <div class="col-cover">
          <img src="${work.cover}" loading="lazy" alt="${work.title}">
        </div>
        <div class="col-title">
          <div class="title-main">${work.title}</div>
          <div class="title-sub">${work.type} • ${work.country || 'JP'}</div>
        </div>
        <div class="col-status">
          <span class="status-badge status-${work.status.toLowerCase()}">${getStatusLabel(work.status, work.type)}</span>
        </div>
        <div class="col-progress">
          <div class="progress-text">${work.progress || 0} / ${work.episodes || work.chapters || '?'}</div>
        </div>
        <div class="col-score">
          <div class="score-pill ${this.getScoreClass(score)}">
            ${score ? score.toFixed(1) : '--'}
          </div>
        </div>
        <div class="col-actions">
          <button class="astra-icon-btn action-edit" title="Edit Rating">
            <i class="fa fa-pencil"></i>
          </button>
        </div>
      </div>
    `);

    row.querySelector('.action-edit')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('astra-open-rating', { 
        detail: { mediaId: work.mediaId } 
      }));
    });

    return row;
  }

  /**
   * Appends the next chunk of items to the DOM.
   */
  private renderNextChunk(): void {
    const body = this.querySelector('#astra-grid-body');
    if (!body) return;

    const fragment = document.createDocumentFragment();
    const nextBatch = this.works.slice(this.renderedCount, this.renderedCount + this.CHUNK_SIZE);

    nextBatch.forEach(work => {
      fragment.appendChild(this.createRow(work));
    });

    body.appendChild(fragment);
    this.renderedCount += nextBatch.length;
  }

  /**
   * Uses Intersection Observer for efficient infinite scrolling.
   */
  private setupInfiniteScroll(element: HTMLElement): void {
    const sentinel = element.querySelector('#astra-grid-sentinel');
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && this.renderedCount < this.works.length) {
        this.renderNextChunk();
      }
    }, { root: null, threshold: 0.1 });

    observer.observe(sentinel);
  }

  private getScoreClass(score: number | null): string {
    if (!score) return 'score-none';
    if (score >= 8) return 'score-high';
    if (score >= 6) return 'score-mid';
    return 'score-low';
  }
}
