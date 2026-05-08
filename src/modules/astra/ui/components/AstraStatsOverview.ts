/**
 * @file AstraStatsOverview.ts
 * @description Component for displaying summary statistics on the dashboard.
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { IDashboardStats } from '../../interfaces/IDashboardState';
import { html } from '@core/utils/Template';

/**
 * Visual overview of Astra library statistics.
 */
export class AstraStatsOverview extends BaseComponent {
  constructor() {
    super({});
  }

  protected render(): HTMLElement {
    // Initial render is empty or placeholder. Will be updated by controller.
    return html`<section class="astra-stats-overview"></section>`;
  }

  /**
   * Updates the component with fresh statistical data.
   */
  public updateStats(stats: IDashboardStats): void {
    const content = html`
      <div style="display: contents;">
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.totalCount}</div>
          <div class="astra-stat-label">Total Works</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.averageScore.toFixed(2)}</div>
          <div class="astra-stat-label">Average Score</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.completedCount}</div>
          <div class="astra-stat-label">Completed</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.planningCount}</div>
          <div class="astra-stat-label">Planning</div>
        </div>
      </div>
    `;

    this.element.innerHTML = '';
    this.element.appendChild(content);
  }
}
