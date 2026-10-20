/**
 * @file AstraRowRenderer.ts
 * @description Specialized renderer for Astra Dashboard rows.
 * Encapsulates complex layout and logic for individual work entries.
 */

import type { AstraSection, AstraWorkSummary } from '../../AstraInterfaces';
import { html, map } from '@core/utils/Template';
import { parseWebUrl } from '@core/utils/WebUrl';

export class AstraRowRenderer {
  private static progressPercent(work: AstraWorkSummary): number {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    const percent =
      total && total > 0 ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;
    return percent === 0 && (work.progress || 0) > 0 ? 5 : percent;
  }

  /** Cover URL safe for an `src` binding; anything but http(s) renders as no image. */
  public static coverSrc(work: AstraWorkSummary): string {
    return parseWebUrl(work.cover)?.href ?? '';
  }

  public static updateProgress(row: HTMLElement, work: AstraWorkSummary): void {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    row.style.setProperty('--progress-val', String(this.progressPercent(work)));
    const badge = row.querySelector('.astra-badge--progress');
    if (badge) badge.textContent = `${work.progress || 0} / ${total || '?'}`;
  }

  /**
   * Renders a single row for the work table.
   *
   * @param work The work data
   * @param sections Scoring sections to display
   * @param onEdit Callback when the row is activated
   */
  public static render(
    work: AstraWorkSummary,
    sections: AstraSection[],
    onEdit: (mediaId: number) => void
  ): HTMLElement {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    const percent = this.progressPercent(work);

    const overallScore = work.currentScore;
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';
    const cover = this.coverSrc(work);

    const row = html`
      <div
        class="astra-grid-row"
        data-media-id="${work.mediaId}"
        style="--progress-val: ${percent}"
      >
        <div class="astra-col-cover">
          <img
            src="${cover}"
            alt="${work.title}"
            data-title="${work.title}"
            class="astra-table-cover"
            loading="lazy"
          />
        </div>
        <div class="astra-col-title">
          <div class="astra-table-title-box">
            ${this.titleLink(work)}
            <div class="astra-table-subtitle">
              <span class="astra-badge astra-badge--country">${work.country || 'JP'}</span>
              <span class="astra-badge astra-badge--progress"
                >${work.progress || 0} / ${total || '?'}</span
              >
            </div>
          </div>
        </div>
        <div class="astra-col-type">
          <span class="astra-badge astra-badge--type">${work.type?.toUpperCase()}</span>
        </div>
        <div class="astra-col-score">
          <div class="astra-table-score-badge ${scoreClass}">
            ${overallScore ? overallScore.toFixed(1) : '-'}
          </div>
        </div>
        ${map(sections, (s) => {
          const score = work.sectionScores ? work.sectionScores[s.id] : null;
          return html`
            <div
              class="astra-col-section"
              style="color: ${score ? 'var(--astra-accent)' : 'var(--astra-muted)'}"
            >
              ${score ? (score as number).toFixed(1) : '-'}
            </div>
          `;
        })}
      </div>
    `;

    if (!cover) row.querySelector('img')?.removeAttribute('src');
    this.bindEdit(row, work.mediaId, onEdit);
    return row;
  }

  public static renderCompact(
    work: AstraWorkSummary,
    sections: AstraSection[],
    onEdit: (mediaId: number) => void
  ): HTMLElement {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    const percent = this.progressPercent(work);

    const overallScore = work.currentScore;
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';

    const row = html`
      <div
        class="astra-grid-row astra-grid-row--compact"
        data-media-id="${work.mediaId}"
        style="--progress-val: ${percent}"
      >
        <div class="astra-col-title">
          <div class="astra-table-title-box">
            ${this.titleLink(work)}
            <div class="astra-table-subtitle">
              <span class="astra-badge astra-badge--country">${work.country || 'JP'}</span>
              <span class="astra-badge astra-badge--progress"
                >${work.progress || 0} / ${total || '?'}</span
              >
            </div>
          </div>
        </div>
        <div class="astra-col-type">
          <span class="astra-badge astra-badge--type">${work.type?.toUpperCase()}</span>
        </div>
        <div class="astra-col-score">
          <div class="astra-table-score-badge ${scoreClass}">
            ${overallScore ? overallScore.toFixed(1) : '-'}
          </div>
        </div>
        ${map(sections, (s) => {
          const score = work.sectionScores ? work.sectionScores[s.id] : null;
          return html`
            <div
              class="astra-col-section"
              style="color: ${score ? 'var(--astra-accent)' : 'var(--astra-muted)'}"
            >
              ${score ? (score as number).toFixed(1) : '-'}
            </div>
          `;
        })}
      </div>
    `;

    this.bindEdit(row, work.mediaId, onEdit);
    return row;
  }

  /**
   * The title links to the AniList page so Tab reaches it and a modified click
   * (Ctrl/Cmd/Shift, or middle click via `auxclick`) opens AniList natively.
   */
  private static titleLink(work: AstraWorkSummary): HTMLElement {
    return html`
      <a
        class="astra-table-title"
        data-action="edit"
        href="https://anilist.co/${work.type === 'anime' ? 'anime' : 'manga'}/${work.mediaId}"
        target="_blank"
        rel="noopener noreferrer"
        >${work.title}</a
      >
    `;
  }

  /**
   * Any click on the row opens Quick Edit, including Enter on the focused title.
   * The cover is left to the table's full-size preview handler.
   */
  private static bindEdit(
    row: HTMLElement,
    mediaId: number,
    onEdit: (mediaId: number) => void
  ): void {
    row.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (!row.isConnected || target.closest('.astra-col-cover')) return;
      const isModified = event.ctrlKey || event.metaKey || event.shiftKey;
      if (isModified && target.closest('a[href]')) return;
      event.preventDefault();
      event.stopPropagation();
      onEdit(mediaId);
    });
  }
}
