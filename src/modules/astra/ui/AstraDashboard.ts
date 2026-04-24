import { injectable, singleton } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { AstraService, AstraWork } from '../AstraService';
import { AstraRadarChart } from './AstraRadarChart';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';

@injectable()
@singleton()
export class AstraDashboard extends BaseComponent {
  private service: AstraService | null = null;
  private overlay: HTMLElement | null = null;
  private state = {
    search: '',
    type: 'all',
    status: 'all',
    sort: 'updated-desc',
    showStats: false,
    country: 'all',
    activeTab: 'dashboard' as 'dashboard' | 'settings'
  };
  private renderProcessId = 0;

  constructor() {
    super({});
  }

  public open(): void {
    if (!this.service) {
      this.service = container.resolve<AstraService>(TOKENS.AstraService);
    }

    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    document.body.appendChild(this.overlay);
    document.body.style.overflow = 'hidden';

    // Trigger animation
    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });

    this.renderDashboard();
  }

  public close(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove('astra-modal-overlay--open');
    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;

      // Only reset overflow if no other Astra modals are open
      if (!document.querySelector('.astra-modal-overlay')) {
        document.body.style.overflow = '';
      }
    }, 300);
  }

  protected render(): HTMLElement {
    return document.createElement('div');
  }

  private renderDashboard(): void {
    if (!this.overlay) return;

    this.overlay.innerHTML = `
      <div class="astra-modal astra-modal--dashboard">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand">
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
              <rect x="11" y="14" width="2" height="3" rx="1" opacity="0.6"/>
            </svg>
          </div>
          <div class="astra-nav-item ${this.state.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
            <i class="fa fa-home"></i>
            <span>Dashboard</span>
          </div>
          <div class="astra-nav-item ${this.state.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
            <i class="fa fa-cog"></i>
            <span>Settings</span>
          </div>
          <div class="astra-nav-spacer"></div>
          <button class="astra-modal-close">
            <i class="fa fa-times"></i>
          </button>
        </nav>

        <div class="astra-modal-main">
          ${this.state.activeTab === 'dashboard' ? this.renderDashboardTab() : this.renderSettingsTab()}
        </div>
      </div>
    `;

    this.attachStaticEvents();
    if (this.state.activeTab === 'dashboard') {
      this.updateDashboardDynamic();
    }
  }

  private renderDashboardTab(): string {
    const sections = this.service!.getSections();
    const works = this.service!.getWorks();
    return `
      <div class="astra-dashboard">
        <header class="astra-dashboard-header">
          <div class="astra-dashboard-title-box">
            <h1 class="astra-dashboard-title">Astra Dashboard</h1>
          </div>
          <div class="astra-dashboard-actions">
            <button class="astra-btn astra-btn--primary" id="astra-sync-anilist" title="Sync all lists from AniList">
              <i class="fa fa-sync"></i> Sync
            </button>
            <button class="astra-btn astra-btn--danger" id="astra-clear-all" title="Reset Astra Database (Delete All)">
              <i class="fa fa-trash"></i>
            </button>
            <div class="astra-action-divider"></div>
            <button class="astra-btn astra-btn--ghost" id="astra-toggle-stats" title="Toggle Analytics">
              <i class="fa fa-chart-line"></i> ${this.state.showStats ? 'Hide' : 'Stats'}
            </button>
            <button class="astra-btn astra-btn--ghost" id="astra-export-wrapped" title="Export Stats as PNG">
              <i class="fa fa-image"></i> Export Wrapped
            </button>
            <div class="astra-action-divider"></div>
            <button class="astra-btn astra-btn--secondary" id="astra-export">
              <i class="fa fa-download"></i> Export
            </button>
            <button class="astra-btn astra-btn--secondary" id="astra-import">
              <i class="fa fa-upload"></i> Import
            </button>
            <input type="file" id="astra-import-file" style="display: none" accept=".json">
          </div>
        </header>

        <div class="astra-stats-wrapper ${this.state.showStats ? 'expanded' : ''}">
          <div class="astra-stats-strip" id="astra-stats-container">
            <!-- Dynamic Stats -->
          </div>
        </div>

        <div class="astra-dashboard-controls">
          <div class="astra-filters">
            <div class="astra-search-box">
              <i class="fa fa-search"></i>
              <input type="text" id="astra-search" placeholder="Search by title..." value="${this.state.search}">
            </div>
            
            <div class="astra-filter-group">
              <span class="astra-filter-label">Type</span>
              <div class="astra-filter-chips" data-filter="type">
                <button class="astra-chip ${this.state.type === 'all' ? 'active' : ''}" data-val="all">All</button>
                <button class="astra-chip ${this.state.type === 'anime' ? 'active' : ''}" data-val="anime">Anime</button>
                <button class="astra-chip ${this.state.type === 'manga' ? 'active' : ''}" data-val="manga">Manga</button>
                <button class="astra-chip ${this.state.type === 'novel' ? 'active' : ''}" data-val="novel">Novel</button>
              </div>
            </div>

            <div class="astra-filter-group">
              <span class="astra-filter-label">Country</span>
              <div class="astra-filter-chips" data-filter="country">
                <button class="astra-chip ${this.state.country === 'all' ? 'active' : ''}" data-val="all">All</button>
                <button class="astra-chip ${this.state.country === 'JP' ? 'active' : ''}" data-val="JP">JP</button>
                <button class="astra-chip ${this.state.country === 'CN' ? 'active' : ''}" data-val="CN">CN</button>
                <button class="astra-chip ${this.state.country === 'KR' ? 'active' : ''}" data-val="KR">KR</button>
              </div>
            </div>

            <div class="astra-filter-group">
              <span class="astra-filter-label">List</span>
              <div class="astra-filter-chips" data-filter="status" id="astra-list-filters">
                <button class="astra-chip ${this.state.status === 'all' ? 'active' : ''}" data-val="all">All</button>
                <!-- Dynamic List Chips -->
              </div>
            </div>
          </div>
        </div>

        <div class="astra-table-wrap">
          ${works.length > 0 ? `
            <table class="astra-table">
              <thead>
                <tr>
                  <th style="width: 65px">Cover</th>
                  <th data-sort="title" style="width: auto">Title</th>
                  <th data-sort="type" style="width: 80px">Type</th>
                  <th data-sort="score" style="width: 85px">Overall</th>
                  ${sections.map(s => `<th data-sort="score-${s.id}" style="width: 85px">${s.name}</th>`).join('')}
                  <th style="width: 100px">Actions</th>
                </tr>
              </thead>
              <tbody id="astra-table-body">
                <!-- Dynamic Rows -->
              </tbody>
            </table>
          ` : this.renderEmptyState()}
        </div>
      </div>
    `;
  }

  private renderEmptyState(): string {
    return `
      <div class="astra-empty-state">
        <div class="astra-empty-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
          </svg>
        </div>
        <h2>Welcome to Astra</h2>
        <p>Your dashboard is currently empty. Start by importing your collection from AniList or creating a new entry.</p>
        <div class="astra-empty-actions">
          <button class="astra-btn astra-btn--primary astra-btn--lg" id="astra-empty-sync">
            <i class="fa fa-sync"></i> Import from AniList
          </button>
          <button class="astra-btn astra-btn--secondary astra-btn--lg" id="astra-import-manual">
            <i class="fa fa-upload"></i> Import JSON
          </button>
        </div>
      </div>
    `;
  }

  private renderSettingsTab(): string {
    const sections = this.service!.getSections();
    return `
      <div class="astra-dashboard astra-settings">
        <header class="astra-dashboard-header">
          <div class="astra-dashboard-title-box">
            <h1 class="astra-dashboard-title">Astra Settings</h1>
            <p class="astra-dashboard-subtitle">Configure your rating criteria and weighted components.</p>
          </div>
          <div class="astra-dashboard-actions">
            <button class="astra-btn astra-btn--primary" id="astra-save-sections">
              <i class="fa fa-save"></i> Save Changes
            </button>
          </div>
        </header>

        <div class="astra-settings-grid">
          <div class="astra-settings-card">
            <div class="astra-card-header">
              <h3>Rating Sections</h3>
              <p class="astra-muted">Main categories contribute to the overall series score. Sub-sections contribute to their parent category.</p>
            </div>
            
            <div class="astra-sections-list" id="astra-sections-editor">
              ${sections.map(s => `
                <div class="astra-section-edit-group" data-id="${s.id}">
                  <div class="astra-section-edit-row">
                    <div class="astra-section-name">
                      <input type="text" class="astra-input" value="${s.name}" data-field="name" placeholder="Section Name">
                    </div>
                    <div class="astra-section-weight">
                      <span class="astra-label-xs">Global Weight</span>
                      <input type="number" class="astra-input" value="${s.weight}" data-field="weight" step="0.1" min="0.1" max="10">
                    </div>
                    <div class="astra-section-actions">
                      <button class="astra-icon-btn astra-delete-section" title="Delete Section">
                        <i class="fa fa-trash"></i>
                      </button>
                    </div>
                  </div>
                  
                  <div class="astra-sub-sections-editor">
                    ${(s.subSections || []).map(sub => `
                      <div class="astra-sub-edit-row" data-sub-id="${sub.id}">
                        <div class="astra-sub-connector"><i class="fa fa-level-up fa-rotate-90"></i></div>
                        <input type="text" class="astra-input astra-input--sm" value="${sub.name}" data-field="sub-name" placeholder="Sub-section Name">
                        <div class="astra-sub-weight">
                          <span class="astra-label-xs">Weight</span>
                          <input type="number" class="astra-input astra-input--sm" value="${sub.weight}" data-field="sub-weight" step="0.1" min="0.1">
                        </div>
                        <button class="astra-icon-btn astra-delete-sub" title="Delete Sub-section">
                          <i class="fa fa-times"></i>
                        </button>
                      </div>
                    `).join('')}
                    <button class="astra-btn astra-btn--ghost astra-btn--xs astra-add-sub" data-section-id="${s.id}">
                      <i class="fa fa-plus"></i> Add Component
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
            
            <button class="astra-btn astra-btn--secondary" id="astra-add-section" style="margin-top: 24px;">
              <i class="fa fa-plus"></i> Add New Category
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private updateDashboardDynamic(): void {
    if (!this.overlay) return;

    const works = this.service!.getWorks();
    const filteredWorks = this.getFilteredWorks(works);
    const sortedWorks = this.getSortedWorks(filteredWorks);
    const sections = this.service!.getSections();

    // Update Stats
    const statsContainer = this.overlay.querySelector('#astra-stats-container');
    if (statsContainer) {
      const anime = works.filter(w => w.type === 'anime');
      const manga = works.filter(w => w.type === 'manga');
      
      const totalDays = anime.reduce((acc, w) => acc + ((w.episodes || 0) * (w.duration || 24)), 0) / (60 * 24);
      const totalChapters = manga.reduce((acc, w) => acc + (w.chapters || 0), 0);
      
      const genreMap: Record<string, number> = {};
      works.forEach(w => (w.genres || []).forEach(g => genreMap[g] = (genreMap[g] || 0) + 1));
      const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
      
      const topSeries = [...works].sort((a, b) => (this.service!.calcSeriesOverall(b) || 0) - (this.service!.calcSeriesOverall(a) || 0)).slice(0, 5);

      statsContainer.innerHTML = `
        <div class="astra-stat-card astra-stat-card--anime">
          <div class="astra-stat-header">
             <i class="fa fa-tv"></i> Anime Stats
          </div>
          <div class="astra-stat-body">
            <div class="astra-stat-main">${anime.length}</div>
            <div class="astra-stat-label">Total Anime</div>
            <div class="astra-stat-grid">
               <div class="astra-stat-item"><span>${totalDays.toFixed(1)}</span> Days</div>
               <div class="astra-stat-item"><span>${this.calculateGlobalAverage(anime).toFixed(1)}</span> Mean</div>
            </div>
          </div>
        </div>
        <div class="astra-stat-card astra-stat-card--manga">
          <div class="astra-stat-header">
             <i class="fa fa-book"></i> Manga Stats
          </div>
          <div class="astra-stat-body">
            <div class="astra-stat-main">${manga.length}</div>
            <div class="astra-stat-label">Total Manga</div>
            <div class="astra-stat-grid">
               <div class="astra-stat-item"><span>${totalChapters}</span> Chaps</div>
               <div class="astra-stat-item"><span>${this.calculateGlobalAverage(manga).toFixed(1)}</span> Mean</div>
            </div>
          </div>
        </div>
        <div class="astra-stat-card astra-stat-card--genres">
          <div class="astra-stat-header">
             <i class="fa fa-tags"></i> Top Genres
          </div>
          <div class="astra-stat-body">
             <div class="astra-genre-list">
               ${topGenres.length > 0 ? topGenres.map(([g, count]) => `
                 <div class="astra-genre-item">
                   <span class="name">${g}</span>
                   <span class="count">${count}</span>
                 </div>
               `).join('') : `
                 <div class="astra-stat-sub" style="margin-top: 10px; opacity: 0.5">
                   Sync with AniList to update metadata
                 </div>
               `}
             </div>
          </div>
        </div>
        <div class="astra-stat-card astra-stat-card--top">
          <div class="astra-stat-header">
             <i class="fa fa-crown"></i> Hall of Fame
          </div>
          <div class="astra-top-series">
             ${topSeries.map((w, i) => `
               <img src="${w.cover}" title="${w.title} (${this.service!.calcSeriesOverall(w)})" class="astra-top-thumb" style="z-index: ${5-i}">
             `).join('')}
          </div>
        </div>
      `;
    }

    // Update Table Body
    const tbody = this.overlay.querySelector('#astra-table-body');
    if (tbody) {
      tbody.innerHTML = '';
      
      this.renderProcessId++;
      const currentProcessId = this.renderProcessId;
      
      if (sortedWorks.length > 0) {
        this.renderChunks(sortedWorks, 0, 50, currentProcessId, tbody as HTMLElement);
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="${5 + sections.length}" style="text-align: center; padding: 48px; color: var(--astra-muted)">
              No entries found matching filters.
            </td>
          </tr>
        `;
      }
    }

    // Update List Chips
    const listContainer = this.overlay.querySelector('#astra-list-filters');
    if (listContainer) {
      const allLists = Array.from(new Set(works.flatMap(w => w.customLists || []))).sort();
      listContainer.innerHTML = `
        <button class="astra-chip ${this.state.status === 'all' ? 'active' : ''}" data-val="all">All</button>
        ${allLists.map(list => `
          <button class="astra-chip ${this.state.status === list ? 'active' : ''}" data-val="${list}">${list}</button>
        `).join('')}
      `;

      // Re-attach chip events
      listContainer.querySelectorAll('.astra-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const val = target.getAttribute('data-val');
          if (val) {
            this.state.status = val;
            this.updateDashboardDynamic();
          }
        });
      });
    }

    // Update active chips for other filters
    this.overlay.querySelectorAll('.astra-filter-chips:not(#astra-list-filters) .astra-chip').forEach(chip => {
      const filterType = chip.parentElement?.getAttribute('data-filter');
      const val = chip.getAttribute('data-val');
      if (filterType && (this.state as any)[filterType] === val) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  private renderChunks(works: AstraWork[], start: number, count: number, processId: number, container: HTMLElement): void {
    if (processId !== this.renderProcessId || !this.overlay) return;

    const chunk = works.slice(start, start + count);
    if (chunk.length === 0) return;

    const html = chunk.map(w => this.renderRow(w)).join('');
    container.insertAdjacentHTML('beforeend', html);

    // Rows are rendered in chunks, but events are delegated from the parent
    if (start + count < works.length) {
      requestAnimationFrame(() => {
        this.renderChunks(works, start + count, count, processId, container);
      });
    }
  }

  private getFilteredWorks(works: AstraWork[]): AstraWork[] {
    return works.filter(w => {
      const matchSearch = !this.state.search || w.title.toLowerCase().includes(this.state.search.toLowerCase());
      const matchType = this.state.type === 'all' || w.type === this.state.type;
      const matchStatus = this.state.status === 'all' || 
                         (w.status || '').toUpperCase() === this.state.status ||
                         (w.customLists || []).includes(this.state.status);
      const matchCountry = this.state.country === 'all' || w.country === this.state.country;
      return matchSearch && matchType && matchStatus && matchCountry;
    });
  }

  private getSortedWorks(works: AstraWork[]): AstraWork[] {
    const sorted = [...works];
    const [field, dir] = this.state.sort.split('-');

    sorted.sort((a, b) => {
      let valA: any, valB: any;

      if (field === 'updated') {
        // Priority: Watching > Planning > Others
        const getPriority = (status: string) => {
          if (status === 'CURRENT') return 3;
          if (status === 'PLANNING') return 2;
          return 1;
        };
        const pA = getPriority(a.status);
        const pB = getPriority(b.status);
        if (pA !== pB) return dir === 'desc' ? pB - pA : pA - pB;
        
        valA = a.updatedAt || 0;
        valB = b.updatedAt || 0;
      } else if (field === 'title') {
        valA = a.title;
        valB = b.title;
      } else if (field === 'score') {
        valA = this.service!.calcSeriesOverall(a) || 0;
        valB = this.service!.calcSeriesOverall(b) || 0;
      } else if (field.startsWith('score-')) {
        const sectionId = field.replace('score-', '');
        valA = a.seasons[a.seasons.length - 1].scores[sectionId] || 0;
        valB = b.seasons[b.seasons.length - 1].scores[sectionId] || 0;
      } else {
        valA = a.updatedAt || 0;
        valB = b.updatedAt || 0;
      }

      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }

  private renderRow(work: AstraWork): string {
    const sections = this.service!.getSections();
    const overall = this.service!.calcSeriesOverall(work);
    const lastSeason = work.seasons[work.seasons.length - 1];

    return `
      <tr class="astra-row" data-media-id="${work.mediaId}">
        <td><img src="${work.cover}" class="astra-table-cover astra-cover-preview" loading="lazy"></td>
        <td>
          <div class="astra-table-title astra-edit-row">${work.title}</div>
          <div class="astra-table-sub">
            ${work.country ? `<span class="astra-mini-tag">${work.country}</span> ` : ''}
            ${(work.customLists || []).map(l => `<span class="astra-mini-tag astra-mini-tag--list">${l}</span>`).join(' ')}
            ${work.seasons.length} part(s) • Last: ${lastSeason.label}
          </div>
        </td>
        <td><span class="astra-tag">${work.type.toUpperCase()}</span></td>
        <td>
          <span class="astra-score-pill" style="background: ${AstraRadarChart.getScoreColor(overall)}">
            ${overall?.toFixed(1) || '—'}
          </span>
        </td>
        ${sections.map(s => {
      const v = lastSeason.scores[s.id];
      return `<td class="astra-table-score-val" style="color: ${AstraRadarChart.getScoreColor(v)}">${v?.toFixed(1) || '—'}</td>`;
    }).join('')}
        <td>
          <div class="astra-row-actions">
            <a href="${work.anilistUrl}" target="_blank" class="astra-icon-btn astra-external-link" title="Open on AniList">
              <i class="fa fa-external-link"></i>
            </a>
            <button class="astra-icon-btn astra-delete-row" title="Delete Entry" style="color: var(--astra-score-bad)">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private calculateGlobalAverage(works: AstraWork[]): number {
    const scores = works.map(w => this.service!.calcSeriesOverall(w)).filter((v): v is number => v !== null);
    if (!scores.length) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private attachStaticEvents(): void {
    if (!this.overlay) return;

    // Tabs
    this.overlay.querySelectorAll('.astra-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = (item as HTMLElement).dataset.tab as any;
        if (tab && tab !== this.state.activeTab) {
          this.state.activeTab = tab;
          this.renderDashboard();
        }
      });
    });

    // Close
    this.overlay.querySelector('.astra-modal-close')?.addEventListener('click', () => this.close());

    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    if (this.state.activeTab === 'dashboard') {
      this.attachDashboardEvents();
    } else {
      this.attachSettingsEvents();
    }
  }

  private attachDashboardEvents(): void {
    if (!this.overlay) return;

    // Toggle Stats
    this.overlay.querySelector('#astra-toggle-stats')?.addEventListener('click', () => {
      this.state.showStats = !this.state.showStats;
      const wrapper = this.overlay?.querySelector('.astra-stats-wrapper');
      const btn = this.overlay?.querySelector('#astra-toggle-stats');

      if (this.state.showStats) {
        wrapper?.classList.add('expanded');
        if (btn) btn.innerHTML = `<i class="fa fa-chart-line"></i> Hide`;
      } else {
        wrapper?.classList.remove('expanded');
        if (btn) btn.innerHTML = `<i class="fa fa-chart-line"></i> Stats`;
      }
    });

    // Search
    const searchInput = this.overlay.querySelector('#astra-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      this.state.search = searchInput.value;
      this.updateDashboardDynamic();
    });

    // Chips
    this.overlay.querySelectorAll('.astra-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const filterType = target.parentElement?.getAttribute('data-filter');
        const val = target.getAttribute('data-val');

        if (filterType && val) {
          (this.state as any)[filterType] = val;
          this.updateDashboardDynamic();
        }
      });
    });

    // Sorting
    this.overlay.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort')!;
        let newDir = 'desc';
        if (this.state.sort.startsWith(field) && this.state.sort.endsWith('desc')) {
          newDir = 'asc';
        }

        this.state.sort = `${field}-${newDir}`;
        this.updateDashboardDynamic();
      });
    });

    // Delegated Row Events (Table Title, Image Preview, Delete)
    this.overlay.querySelector('.astra-modal--dashboard')?.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      
      // Handle Row Actions
      const row = target.closest('.astra-row') as HTMLElement;
      if (row) {
        const mediaId = parseInt(row.getAttribute('data-media-id') || '0');
        if (mediaId) {
          // Edit Trigger (Title)
          if (target.closest('.astra-edit-row')) {
            const modal = container.resolve<any>(TOKENS.AstraRatingModal);
            modal.open(mediaId);
            const checkClosed = setInterval(() => {
              if (!document.querySelector('.astra-modal-overlay')) {
                clearInterval(checkClosed);
                this.updateDashboardDynamic();
              }
            }, 500);
            return;
          }

          // Cover Preview
          if (target.closest('.astra-cover-preview')) {
            const img = target.closest('img') as HTMLImageElement;
            this.showFullPreview(img.src, row.querySelector('.astra-table-title')?.textContent || '');
            return;
          }

          // External Link (Icon)
          if (target.closest('.astra-external-link')) {
            // Let the default link behavior happen
            return;
          }

          // Delete Button
          if (target.closest('.astra-delete-row')) {
            const title = row.querySelector('.astra-table-title')?.textContent || 'this entry';
            if (confirm(`Are you sure you want to delete ${title}? This cannot be undone.`)) {
              await this.service!.deleteWork(mediaId);
              this.updateDashboardDynamic();
            }
            return;
          }
        }
      }
    });

    // Import/Export
    const exportWrappedBtn = this.overlay.querySelector('#astra-export-wrapped');
    const exportBtn = this.overlay.querySelector('#astra-export');
    const importBtn = this.overlay.querySelector('#astra-import');
    const fileInput = this.overlay.querySelector('#astra-import-file') as HTMLInputElement;

    exportWrappedBtn?.addEventListener('click', () => this.exportWrappedAsImage());

    exportBtn?.addEventListener('click', () => {
      const data = this.service!.exportJSON();
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
        const success = await this.service!.importJSON(re.target?.result as string);
        if (success) {
          this.updateDashboardDynamic();
        } else {
          alert('Failed to import JSON. Check file format.');
        }
      };
      reader.readAsText(file);
    });

    // Sync from AniList
    const syncBtn = this.overlay.querySelector('#astra-sync-anilist');
    const emptySyncBtn = this.overlay.querySelector('#astra-empty-sync');
    const importManualBtn = this.overlay.querySelector('#astra-import-manual');

    const handleSync = async (btn: HTMLElement) => {
      const originalHTML = btn.innerHTML;
      btn.classList.add('astra-btn--loading');
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Syncing...';
      (btn as HTMLButtonElement).disabled = true;

      try {
        const apiClient = container.resolve<any>(TOKENS.ApiClient);
        const toast = container.resolve<any>(TOKENS.ToastService);
        
        const result = await this.service!.syncWithAniList(apiClient);
        toast.success(`Sync complete! Added ${result.added} entries.`);
        
        this.renderDashboard(); // Full re-render to handle empty -> non-empty transition
      } catch (err) {
        console.error(err);
        alert('Failed to sync with AniList. Check your connection or login status.');
      } finally {
        btn.classList.remove('astra-btn--loading');
        btn.innerHTML = originalHTML;
        (btn as HTMLButtonElement).disabled = false;
      }
    };

    syncBtn?.addEventListener('click', () => handleSync(syncBtn as HTMLElement));
    emptySyncBtn?.addEventListener('click', () => handleSync(emptySyncBtn as HTMLElement));
    importManualBtn?.addEventListener('click', () => fileInput.click());

    // Clear All
    this.overlay.querySelector('#astra-clear-all')?.addEventListener('click', async () => {
      if (confirm('DANGER: This will delete ALL your Astra ratings and entries. This cannot be undone. Are you sure?')) {
        await this.service!.clearAllWorks();
        const toast = container.resolve<any>(TOKENS.ToastService);
        toast.success('Astra database has been reset.');
        this.renderDashboard();
      }
    });
  }

  private attachSettingsEvents(): void {
    if (!this.overlay) return;

    // Add Section
    this.overlay.querySelector('#astra-add-section')?.addEventListener('click', () => {
      const editor = this.overlay!.querySelector('#astra-sections-editor');
      if (!editor) return;

      const newId = `c_${Math.random().toString(36).slice(2, 7)}`;
      const div = document.createElement('div');
      div.className = 'astra-section-edit-group';
      div.dataset.id = newId;
      div.innerHTML = `
        <div class="astra-section-edit-row">
          <div class="astra-section-name">
            <input type="text" class="astra-input" value="New Category" data-field="name">
          </div>
          <div class="astra-section-weight">
            <span class="astra-label-xs">Global Weight</span>
            <input type="number" class="astra-input" value="1" data-field="weight" step="0.1" min="0.1">
          </div>
          <div class="astra-section-actions">
            <button class="astra-icon-btn astra-delete-section"><i class="fa fa-trash"></i></button>
          </div>
        </div>
        <div class="astra-sub-sections-editor">
          <button class="astra-btn astra-btn--ghost astra-btn--xs astra-add-sub" data-section-id="${newId}">
            <i class="fa fa-plus"></i> Add Component
          </button>
        </div>
      `;
      editor.appendChild(div);
      this.attachSettingsItemEvents(div);
    });

    // Existing items
    this.overlay.querySelectorAll('.astra-section-edit-group').forEach(group => {
      this.attachSettingsItemEvents(group as HTMLElement);
    });

    // Save
    this.overlay.querySelector('#astra-save-sections')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';

      const sections: any[] = [];
      this.overlay!.querySelectorAll('.astra-section-edit-group').forEach(group => {
        const id = (group as HTMLElement).dataset.id!;
        const name = (group.querySelector('[data-field="name"]') as HTMLInputElement).value;
        const weight = parseFloat((group.querySelector('[data-field="weight"]') as HTMLInputElement).value);

        const subSections: any[] = [];
        group.querySelectorAll('.astra-sub-edit-row').forEach(subRow => {
          const subId = (subRow as HTMLElement).dataset.subId!;
          const subName = (subRow.querySelector('[data-field="sub-name"]') as HTMLInputElement).value;
          const subWeight = parseFloat((subRow.querySelector('[data-field="sub-weight"]') as HTMLInputElement).value);
          subSections.push({ id: subId, name: subName, weight: subWeight });
        });

        sections.push({ id, name, weight, subSections });
      });

      await this.service!.updateSections(sections);
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa fa-check"></i> Saved!';
        setTimeout(() => { btn.innerHTML = '<i class="fa fa-save"></i> Save Changes'; }, 2000);
      }, 500);
    });
  }

  private attachSettingsItemEvents(group: HTMLElement): void {
    // Delete Section
    group.querySelector('.astra-delete-section')?.addEventListener('click', () => {
      if (confirm('Delete this entire category and all its components?')) {
        group.remove();
      }
    });

    // Add Sub
    group.querySelector('.astra-add-sub')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLElement;
      const editor = group.querySelector('.astra-sub-sections-editor');
      if (!editor) return;

      const subId = `s_${Math.random().toString(36).slice(2, 7)}`;
      const subDiv = document.createElement('div');
      subDiv.className = 'astra-sub-edit-row';
      subDiv.dataset.subId = subId;
      subDiv.innerHTML = `
        <div class="astra-sub-connector"><i class="fa fa-level-up fa-rotate-90"></i></div>
        <input type="text" class="astra-input astra-input--sm" value="New Component" data-field="sub-name">
        <div class="astra-sub-weight">
          <span class="astra-label-xs">Weight</span>
          <input type="number" class="astra-input astra-input--sm" value="1" data-field="sub-weight" step="0.1" min="0.1">
        </div>
        <button class="astra-icon-btn astra-delete-sub"><i class="fa fa-times"></i></button>
      `;
      editor.insertBefore(subDiv, btn);

      subDiv.querySelector('.astra-delete-sub')?.addEventListener('click', () => subDiv.remove());
    });

    // Delete Sub
    group.querySelectorAll('.astra-delete-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        (btn.closest('.astra-sub-edit-row') as HTMLElement).remove();
      });
    });
  }

  // Row events are now handled via delegation in attachDashboardEvents

  private showFullPreview(src: string, title: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'astra-preview-overlay';
    overlay.innerHTML = `
      <div class="astra-preview-content">
        <img src="${src.replace('large', 'extraLarge')}" class="astra-preview-img">
        <div class="astra-preview-title">${title}</div>
        <button class="astra-preview-close"><i class="fa fa-times"></i></button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', () => {
      overlay.remove();
    });
  }

  private async exportWrappedAsImage(): Promise<void> {
    if (!this.service) return;

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800; // Taller for more content
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- BACKGROUND ---
    // Deep Space Gradient
    const bgGrad = ctx.createRadialGradient(600, 400, 100, 600, 400, 800);
    bgGrad.addColorStop(0, '#1a2c3e');
    bgGrad.addColorStop(1, '#0b1622');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle Grid Pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 40) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
    }

    // Accent Glows
    const drawGlow = (x: number, y: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 400);
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    };
    drawGlow(1000, 100, 'rgba(61, 180, 242, 0.1)');
    drawGlow(200, 700, 'rgba(168, 85, 247, 0.08)');

    // --- HEADER ---
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 60px "Inter", "Segoe UI", sans-serif';
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(61, 180, 242, 0.5)';
    ctx.fillText('ASTRA WRAPPED', 60, 100);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#3db4f2';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText(`${new Date().getFullYear()} COLLECTION SUMMARY`, 65, 140);

    const works = this.service.getWorks();
    const anime = works.filter(w => w.type === 'anime');
    const manga = works.filter(w => w.type === 'manga');
    const totalDays = anime.reduce((acc, w) => acc + ((w.episodes || 0) * (w.duration || 24)), 0) / (60 * 24);
    const totalChapters = manga.reduce((acc, w) => acc + (w.chapters || 0), 0);

    // --- CARDS ---
    const drawCard = (x: number, y: number, w: number, h: number, title: string, val: string, sub: string, accent: string) => {
      // Card Shadow
      ctx.shadowBlur = 30;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      
      // Card Background
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 24); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Card Border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Content
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 16px "Inter", sans-serif';
      ctx.fillText(title.toUpperCase(), x + 35, y + 50);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 80px "JetBrains Mono", monospace';
      ctx.fillText(val, x + 35, y + 130);

      ctx.fillStyle = accent;
      ctx.font = '800 20px "Inter", sans-serif';
      ctx.fillText(sub, x + 35, y + 175);
    };

    drawCard(60, 200, 520, 220, 'Anime Watched', anime.length.toString(), `⏱ ${totalDays.toFixed(1)} Days of Content`, '#3db4f2');
    drawCard(620, 200, 520, 220, 'Manga Read', manga.length.toString(), `📖 ${totalChapters} Chapters Read`, '#e85d75');

    // --- GENRES ---
    const genreMap: Record<string, number> = {};
    works.forEach(w => (w.genres || []).forEach(g => genreMap[g] = (genreMap[g] || 0) + 1));
    const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px "Inter", sans-serif';
    ctx.fillText('TOP GENRES', 60, 480);

    topGenres.forEach(([g, count], i) => {
      const x = 60 + (i % 2) * 280;
      const y = 520 + Math.floor(i / 2) * 50;
      
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, 260, 40, 8); else ctx.rect(x, y, 260, 40);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px "Inter", sans-serif';
      ctx.fillText(g, x + 15, y + 26);

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 14px "Inter", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(count.toString(), x + 245, y + 26);
      ctx.textAlign = 'left';
    });

    if (topGenres.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = 'italic 18px "Inter", sans-serif';
      ctx.fillText('Sync with AniList to reveal your genre preferences.', 60, 540);
    }

    // --- HALL OF FAME ---
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px "Inter", sans-serif';
    ctx.fillText('HALL OF FAME', 620, 480);
    
    const topSeries = [...works].sort((a, b) => (this.service!.calcSeriesOverall(b) || 0) - (this.service!.calcSeriesOverall(a) || 0)).slice(0, 5);
    
    let loadedCount = 0;
    if (topSeries.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillText('Rate some series to fill your Hall of Fame!', 620, 540);
      this.downloadCanvas(canvas);
      return;
    }

    topSeries.forEach((w, i) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const x = 620 + (i * 105);
        const y = 510;
        const w_img = 95;
        const h_img = 140;

        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w_img, h_img, 12); else ctx.rect(x, y, w_img, h_img);
        ctx.clip();
        
        ctx.drawImage(img, x, y, w_img, h_img);
        ctx.restore();

        // Rating badge
        ctx.fillStyle = '#3db4f2';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x + 5, y + 5, 40, 20, 4); else ctx.rect(x + 5, y + 5, 40, 20);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText((this.service!.calcSeriesOverall(w) || 0).toFixed(1), x + 25, y + 19);
        ctx.textAlign = 'left';

        loadedCount++;
        if (loadedCount === topSeries.length) this.finishCanvas(canvas, ctx);
      };
      img.onerror = () => {
        loadedCount++;
        if (loadedCount === topSeries.length) this.finishCanvas(canvas, ctx);
      };
      img.src = w.cover || '';
    });
  }

  private finishCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    // Watermark
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillText('GENERATED BY ASTRA ULTIMATE', 920, 770);
    
    this.downloadCanvas(canvas);
  }

  private downloadCanvas(canvas: HTMLCanvasElement): void {
    const link = document.createElement('a');
    link.download = `astra-wrapped-${new Date().getFullYear()}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  }
}
