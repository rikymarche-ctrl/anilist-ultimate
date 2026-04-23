import { BaseComponent } from '@ui/components/BaseComponent';
import { AstraService, AstraWork } from '../AstraService';
import { AstraRadarChart } from './AstraRadarChart';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';

export class AstraDashboard extends BaseComponent {
  private service: AstraService;

  constructor() {
    super({});
    this.service = container.resolve<AstraService>(TOKENS.AstraService);
  }

  protected render(): HTMLElement {
    const works = this.service.getWorks();
    const sections = this.service.getSections();

    const container = this.createElement('div', { class: 'astra-dashboard' });

    container.innerHTML = `
      <header class="astra-dashboard-header">
        <div class="astra-dashboard-title-box">
          <h1 class="astra-dashboard-title">Astra Dashboard</h1>
          <p class="astra-dashboard-subtitle">Advanced rating journal and analytics</p>
        </div>
        <div class="astra-dashboard-actions">
          <button class="astra-btn astra-btn--secondary" id="astra-export">Export JSON</button>
          <button class="astra-btn astra-btn--secondary" id="astra-import">Import JSON</button>
          <input type="file" id="astra-import-file" style="display: none" accept=".json">
        </div>
      </header>

      <div class="astra-stats-strip">
        <div class="astra-stat-card">
          <span class="astra-stat-label">Total Rated</span>
          <span class="astra-stat-val">${works.length}</span>
        </div>
        <div class="astra-stat-card">
          <span class="astra-stat-label">Average Score</span>
          <span class="astra-stat-val">${this.calculateGlobalAverage(works).toFixed(1)}</span>
        </div>
      </div>

      <div class="astra-list-container">
        <table class="astra-table">
          <thead>
            <tr>
              <th>Cover</th>
              <th>Title</th>
              <th>Type</th>
              <th>Overall</th>
              ${sections.map(s => `<th>${s.name}</th>`).join('')}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${works.map(w => this.renderRow(w)).join('')}
          </tbody>
        </table>
      </div>
    `;

    this.attachDashboardEvents(container);
    return container;
  }

  private renderRow(work: AstraWork): string {
    const sections = this.service.getSections();
    const overall = this.service.calcSeriesOverall(work);
    const lastSeason = work.seasons[work.seasons.length - 1];

    return `
      <tr class="astra-row" data-media-id="${work.mediaId}">
        <td><img src="${work.cover}" class="astra-table-cover"></td>
        <td>
          <div class="astra-table-title">${work.title}</div>
          <div class="astra-table-sub">${work.seasons.length} part(s)</div>
        </td>
        <td><span class="astra-tag">${work.type}</span></td>
        <td><span class="astra-score-pill" style="background: ${AstraRadarChart.getScoreColor(overall)}">${overall?.toFixed(1) || '—'}</span></td>
        ${sections.map(s => {
          const v = lastSeason.scores[s.id];
          return `<td style="color: ${AstraRadarChart.getScoreColor(v)}">${v?.toFixed(1) || '—'}</td>`;
        }).join('')}
        <td>
          <button class="astra-icon-btn astra-edit-row"><i class="fa fa-pencil"></i></button>
        </td>
      </tr>
    `;
  }

  private calculateGlobalAverage(works: AstraWork[]): number {
    const scores = works.map(w => this.service.calcSeriesOverall(w)).filter((v): v is number => v !== null);
    if (!scores.length) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private attachDashboardEvents(el: HTMLElement): void {
    const exportBtn = el.querySelector('#astra-export');
    const importBtn = el.querySelector('#astra-import');
    const fileInput = el.querySelector('#astra-import-file') as HTMLInputElement;

    exportBtn?.addEventListener('click', () => {
      const data = this.service.exportJSON();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `astra-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    importBtn?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (re) => {
        const success = await this.service.importJSON(re.target?.result as string);
        if (success) {
          window.location.reload();
        } else {
          alert('Failed to import JSON. Check file format.');
        }
      };
      reader.readAsText(file);
    });

    el.querySelectorAll('.astra-edit-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mediaId = parseInt((e.target as HTMLElement).closest('.astra-row')?.getAttribute('data-media-id') || '0');
        if (mediaId) {
          const modal = container.resolve<any>(TOKENS.AstraRatingModal);
          modal.open(mediaId);
        }
      });
    });
  }
}
