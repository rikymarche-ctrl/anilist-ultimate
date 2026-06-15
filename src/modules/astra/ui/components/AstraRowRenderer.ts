/**
 * @file AstraRowRenderer.ts
 * @description Specialized renderer for Astra Dashboard rows.
 * Encapsulates complex layout and logic for individual work entries.
 */

import { AstraWorkSummary } from '../../AstraInterfaces';
import { html, map } from '@core/utils/Template';

export class AstraRowRenderer {
  /**
   * Renders a single row for the work table.
   *
   * @param work The work data
   * @param sections Scoring sections to display
   * @param onEdit Callback when edit button is clicked
   */
  public static render(
    work: AstraWorkSummary,
    sections: any[],
    onEdit: (mediaId: number) => void
  ): HTMLElement {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    let percent =
      total && total > 0 ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;

    if (percent === 0 && (work.progress || 0) > 0) percent = 5;

    const overallScore = work.currentScore;
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';

    const row = html`
      <div
        class="astra-grid-row"
        data-media-id="${work.mediaId}"
        style="--progress-val: ${percent}"
      >
        <div class="astra-col-cover">
          <img src="${work.cover}" class="astra-table-cover" loading="lazy" />
        </div>
        <div class="astra-col-title">
          <div class="astra-table-title-box">
            <div class="astra-table-title" data-action="edit">${work.title}</div>
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
        <div class="astra-col-actions">
          <button class="astra-icon-btn astra-edit-row" title="Edit Entry" data-action="edit">
            <i class="fa fa-pencil-alt"></i>
          </button>
          <a
            class="astra-icon-btn"
            href="https://anilist.co/${work.type}/${work.mediaId}"
            target="_blank"
            title="View on AniList"
          >
            <i class="fa fa-external-link-alt"></i>
          </a>
        </div>
      </div>
    `;

    // Internal event binding for this row to keep WorkTable clean
    row.querySelectorAll('[data-action="edit"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onEdit(work.mediaId);
      });
    });

    return row;
  }

  public static renderCompact(
    work: AstraWorkSummary,
    sections: any[],
    onEdit: (mediaId: number) => void
  ): HTMLElement {
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    let percent =
      total && total > 0 ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;

    if (percent === 0 && (work.progress || 0) > 0) percent = 5;

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
            <div class="astra-table-title" data-action="edit">${work.title}</div>
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
        <div class="astra-col-actions">
          <button class="astra-icon-btn astra-edit-row" title="Edit Entry" data-action="edit">
            <i class="fa fa-pencil-alt"></i>
          </button>
          <a
            class="astra-icon-btn"
            href="https://anilist.co/${work.type}/${work.mediaId}"
            target="_blank"
            title="View on AniList"
          >
            <i class="fa fa-external-link-alt"></i>
          </a>
        </div>
      </div>
    `;

    row.querySelectorAll('[data-action="edit"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onEdit(work.mediaId);
      });
    });

    return row;
  }
}
