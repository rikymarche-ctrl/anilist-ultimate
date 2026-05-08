/**
 * @file AstraStatsHeader.ts
 * @description Component for displaying dashboard statistics
 */

import { AstraView } from '../base/AstraView';
import { IDashboardStats } from '../../interfaces/IDashboardState';

export class AstraStatsHeader extends AstraView {
  protected template(stats: IDashboardStats): string {
    return `
      <div class="astra-stats-strip">
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.totalCount}</div>
          <div class="astra-stat-label">Total Works</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.averageScore.toFixed(2)}</div>
          <div class="astra-stat-label">Avg. Score</div>
        </div>
        <div class="astra-stat-divider"></div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.completedCount}</div>
          <div class="astra-stat-label">Completed</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.totalCount - stats.completedCount - stats.planningCount}</div>
          <div class="astra-stat-label">Other</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.planningCount}</div>
          <div class="astra-stat-label">Planned</div>
        </div>
        
        <div class="astra-stat-spacer"></div>
        
        <div class="astra-distribution-mini">
           <div class="astra-dist-bar">
             <div class="astra-dist-segment astra-dist-completed" style="flex: ${stats.completedCount}"></div>
             <div class="astra-dist-segment astra-dist-progress" style="flex: ${stats.totalCount - stats.completedCount - stats.planningCount}"></div>
             <div class="astra-dist-segment astra-dist-planned" style="flex: ${stats.planningCount}"></div>
           </div>
           <div class="astra-stat-label">Distribution</div>
        </div>
      </div>
    `;
  }
}
