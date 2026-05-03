/**
 * @file AstraStatsHeader.ts
 * @description Component for displaying dashboard statistics
 */

import { AstraView } from '../base/AstraView';
import { DashboardStats } from '../../store/AstraStore';

export class AstraStatsHeader extends AstraView {
  protected template(stats: DashboardStats): string {
    return `
      <div class="astra-stats-strip">
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.total}</div>
          <div class="astra-stat-label">Total Works</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.averageScore.toFixed(2)}</div>
          <div class="astra-stat-label">Avg. Score</div>
        </div>
        <div class="astra-stat-divider"></div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.completed}</div>
          <div class="astra-stat-label">Completed</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.inProgress}</div>
          <div class="astra-stat-label">In Progress</div>
        </div>
        <div class="astra-stat-card">
          <div class="astra-stat-val">${stats.planned}</div>
          <div class="astra-stat-label">Planned</div>
        </div>
        
        <div class="astra-stat-spacer"></div>
        
        <div class="astra-distribution-mini">
           <div class="astra-dist-bar">
             <div class="astra-dist-segment astra-dist-completed" style="flex: ${stats.completed}"></div>
             <div class="astra-dist-segment astra-dist-progress" style="flex: ${stats.inProgress}"></div>
             <div class="astra-dist-segment astra-dist-planned" style="flex: ${stats.planned}"></div>
           </div>
           <div class="astra-stat-label">Distribution</div>
        </div>
      </div>
    `;
  }
}
