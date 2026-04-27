/**
 * @file AstraDashboard.ts
 * @description Full-page modal dashboard for managing all Astra work ratings
 *
 * Provides:
 *   - Filterable/sortable work grid with search
 *   - Statistics overview (total works, average score, distribution)
 *   - AniList sync trigger
 *   - JSON export/import
 *   - Per-work rating modal launch
 *   - Chunk-based rendering for performance on large libraries
 *
 * @warning ~1300 lines — should be split into sub-components.
 *          See docs/BUGS.md#bug-022.
 *
 * @see AstraService.ts for the data layer
 * @see AstraRatingModal.ts for per-work editing
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 */

import { injectable, singleton, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { AstraService, AstraWork } from '../AstraService';
import { TOKENS } from '@core/di/tokens';
import { ToastService } from '@core/services/ToastService';

@injectable()
@singleton()
export class AstraDashboard extends BaseComponent {
  private overlay: HTMLElement | null = null;
  private state = {
    search: '',
    type: 'all',
    status: 'all',
    anilistStatus: 'all',
    sort: 'updated-desc',
    showStats: false,
    showProgress: true,
    country: 'all',
    activeTab: 'dashboard' as 'dashboard' | 'settings'
  };
  private renderProcessId = 0;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.ApiClient) private apiClient: any // IApiClient
  ) {
    super({});
  }

  public open(): void {

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
      <div class="astra-dashboard ${this.state.showProgress ? 'astra-show-progress' : ''}" id="astra-dashboard-container">
        <header class="astra-dashboard-header">
          <div class="astra-dashboard-title-box">
            <h1 class="astra-dashboard-title">Astra Dashboard <span style="font-size: 10px; opacity: 0.5; vertical-align: middle; margin-left: 8px;">v2.1</span></h1>
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
            <button class="astra-btn astra-btn--ghost ${this.state.showProgress ? 'active' : ''}" id="astra-toggle-progress" title="Toggle Progress Fill">
              <i class="fa fa-tasks"></i>
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
            
            <div class="astra-filter-group" data-filter="type">
              <span class="astra-filter-label">Type</span>
              <div class="astra-filter-chips">
                <button class="astra-chip ${this.state.type === 'all' ? 'active' : ''}" data-val="all">All</button>
                <button class="astra-chip ${this.state.type === 'anime' ? 'active' : ''}" data-val="anime">Anime</button>
                <button class="astra-chip ${this.state.type === 'manga' ? 'active' : ''}" data-val="manga">Manga</button>
                <button class="astra-chip ${this.state.type === 'novel' ? 'active' : ''}" data-val="novel">Novel</button>
              </div>
            </div>

            <div class="astra-filter-group" data-filter="country">
              <span class="astra-filter-label">Country</span>
              <div class="astra-filter-chips">
                <button class="astra-chip ${this.state.country === 'all' ? 'active' : ''}" data-val="all">All</button>
                <button class="astra-chip ${this.state.country === 'JP' ? 'active' : ''}" data-val="JP">JP</button>
                <button class="astra-chip ${this.state.country === 'CN' ? 'active' : ''}" data-val="CN">CN</button>
                <button class="astra-chip ${this.state.country === 'KR' ? 'active' : ''}" data-val="KR">KR</button>
              </div>
            </div>

          </div>

            <div class="astra-filter-chips" data-filter="status" id="astra-list-filters">
              <button class="astra-chip ${this.state.status === 'all' ? 'active' : ''}" data-val="all">All</button>
              <select class="astra-chip astra-select-chip ${this.state.anilistStatus !== 'all' ? 'active' : ''}" id="astra-filter-status" data-filter="anilistStatus">
                <option value="all">ALL STATUSES</option>
                <option value="CURRENT" ${this.state.anilistStatus === 'CURRENT' ? 'selected' : ''}>WATCHING / READING</option>
                <option value="COMPLETED" ${this.state.anilistStatus === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
                <option value="PLANNING" ${this.state.anilistStatus === 'PLANNING' ? 'selected' : ''}>PLANNING</option>
                <option value="PAUSED" ${this.state.anilistStatus === 'PAUSED' ? 'selected' : ''}>PAUSED</option>
                <option value="DROPPED" ${this.state.anilistStatus === 'DROPPED' ? 'selected' : ''}>DROPPED</option>
                <option value="REPEATING" ${this.state.anilistStatus === 'REPEATING' ? 'selected' : ''}>REWATCHING</option>
              </select>
              <!-- Dynamic List Chips -->
            </div>
        </div>

        <div class="astra-table-wrap">
          ${works.length > 0 ? `
            <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 90px)">
              <div class="astra-grid-header">
                <div style="width: 80px">Cover</div>
                <div data-sort="title">Title</div>
                <div data-sort="type">Type</div>
                <div data-sort="score">Overall</div>
                ${sections.map(s => `<div data-sort="score-${s.id}">${s.name}</div>`).join('')}
                <div style="text-align: right; justify-content: flex-end">Actions</div>
              </div>
              <div id="astra-table-body">
                <!-- Dynamic Grid Rows -->
              </div>
            </div>
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

    // Update Stats
    const statsContainer = this.overlay.querySelector('#astra-stats-container');
    if (statsContainer) {
      const anime = works.filter(w => w.type === 'anime');
      const manga = works.filter(w => w.type === 'manga');

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
               <div class="astra-stat-item"><span>${(anime.reduce((acc, w) => acc + ((w.episodes || 0) * (w.duration || 24)), 0) / (60 * 24)).toFixed(1)}</span> Days</div>
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
               <div class="astra-stat-item"><span>${manga.reduce((acc, w) => acc + (w.chapters || 0), 0)}</span> Chaps</div>
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
               <div class="astra-top-thumb-container" style="z-index: ${5 - i}">
                 <img src="${w.cover}" class="astra-top-thumb" title="${w.title}">
                 <div class="astra-top-score">${(this.service!.calcSeriesOverall(w) || 0).toFixed(1)}</div>
               </div>
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
          <div style="text-align: center; padding: 48px; color: var(--astra-muted); grid-column: 1 / -1">
            No entries found matching filters.
          </div>
        `;
      }
    }

    // Update List Chips
    const listContainer = this.overlay.querySelector('#astra-list-filters');
    if (listContainer) {
      const standardLists = ['COMPLETED', 'DROPPED', 'PAUSED', 'PLANNING', 'WATCHING', 'READING', 'REPEATING', 'CURRENT'];
      const allLists = Array.from(new Set(works.flatMap(w => w.customLists || [])))
        .filter(l => !standardLists.includes(l.toUpperCase()))
        .sort();

      listContainer.innerHTML = `
        <button class="astra-chip ${this.state.status === 'all' ? 'active' : ''}" data-val="all">All</button>
        <select class="astra-chip astra-select-chip ${this.state.anilistStatus !== 'all' ? 'active' : ''}" id="astra-filter-status" data-filter="anilistStatus">
          <option value="all">ALL STATUSES</option>
          <option value="CURRENT" ${this.state.anilistStatus === 'CURRENT' ? 'selected' : ''}>WATCHING / READING</option>
          <option value="COMPLETED" ${this.state.anilistStatus === 'COMPLETED' ? 'selected' : ''}>COMPLETED</option>
          <option value="PLANNING" ${this.state.anilistStatus === 'PLANNING' ? 'selected' : ''}>PLANNING</option>
          <option value="PAUSED" ${this.state.anilistStatus === 'PAUSED' ? 'selected' : ''}>PAUSED</option>
          <option value="DROPPED" ${this.state.anilistStatus === 'DROPPED' ? 'selected' : ''}>DROPPED</option>
          <option value="REPEATING" ${this.state.anilistStatus === 'REPEATING' ? 'selected' : ''}>REWATCHING</option>
        </select>
        ${allLists.map(list => `
          <button class="astra-chip ${this.state.status === list ? 'active' : ''}" data-val="${list}">${list}</button>
        `).join('')}
      `;

      // Re-attach chip and select events
      listContainer.querySelectorAll('.astra-chip').forEach(el => {
        if (el.tagName === 'SELECT') {
          el.addEventListener('change', (e) => {
            const target = e.currentTarget as HTMLSelectElement;
            this.state.anilistStatus = target.value;
            this.updateDashboardDynamic();
          });
        } else {
          el.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const val = target.getAttribute('data-val');
            if (val) {
              this.state.status = val;
              this.updateDashboardDynamic();
            }
          });
        }
      });
    }

    // Update active chips for Type and Country
    this.overlay.querySelectorAll('.astra-filter-chips:not(#astra-list-filters) .astra-chip').forEach(chip => {
      const filterType = chip.parentElement?.getAttribute('data-filter');
      const val = chip.getAttribute('data-val');
      if (filterType && (this.state as any)[filterType] === val) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // Update Status Dropdown
    const statusDropdown = this.overlay.querySelector('#astra-filter-status') as HTMLSelectElement;
    if (statusDropdown) {
      statusDropdown.onchange = () => {
        this.state.anilistStatus = statusDropdown.value;
        this.updateDashboardDynamic();
      };
    }
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
      const matchStatus = this.state.status === 'all' || (w.customLists || []).includes(this.state.status);
      const matchAnilistStatus = this.state.anilistStatus === 'all' || (w.status || '').toUpperCase() === this.state.anilistStatus;
      const matchCountry = this.state.country === 'all' || w.country === this.state.country;
      return matchSearch && matchType && matchStatus && matchAnilistStatus && matchCountry;
    });
  }

  private getSortedWorks(works: AstraWork[]): AstraWork[] {
    const sorted = [...works];
    const [field, dir] = this.state.sort.split('-');

    sorted.sort((a, b) => {
      let valA: any, valB: any;

      if (field === 'updated') {
        valA = a.updatedAt || 0;
        valB = b.updatedAt || 0;
      } else if (field === 'title') {
        valA = a.title;
        valB = b.title;
      } else if (field === 'score') {
        valA = this.service!.calcSeriesOverall(a) || 0;
        valB = this.service!.calcSeriesOverall(b) || 0;
      } else if (field === 'progress') {
        valA = (a.episodes || a.chapters || 0);
        valB = (b.episodes || b.chapters || 0);
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
    const lastSeason = work.seasons[work.seasons.length - 1];
    const total = work.type === 'anime' ? work.episodes : work.chapters;
    let percent = (total && total > 0) ? Math.min(100, Math.round(((work.progress || 0) / total) * 100)) : 0;
    
    // Fallback for active titles with unknown total
    if (percent === 0 && (work.progress || 0) > 0) percent = 5;

    const overallScore = this.service!.calcSeriesOverall(work);
    const scoreClass = (overallScore || 0) >= 8 ? 'high' : (overallScore || 0) >= 6 ? 'mid' : 'low';
    const noProgressClass = (work.progress || 0) === 0 ? 'astra-row-no-progress' : '';

    const rowStyle = this.state.showProgress && (work.progress || 0) > 0 
      ? `background-image: linear-gradient(90deg, rgba(59, 130, 246, 0.4) 0%, rgba(59, 130, 246, 0.2) 100%); background-size: ${percent}% 100%; border-left: 3px solid #3b82f6;`
      : '';

    return `
      <div class="astra-grid-row ${noProgressClass}" data-media-id="${work.mediaId}" style="${rowStyle} --progress-val: ${percent}">
        <div class="astra-edit-row">
          <img src="${work.cover}" class="astra-table-cover">
        </div>
        <div class="astra-edit-row">
          <div class="astra-table-title-box">
            <div class="astra-table-title" title="${work.title}">${work.title}</div>
            <div class="astra-table-subtitle">
              <span class="astra-badge astra-badge--country">${work.country || 'JP'}</span>
              <span class="astra-badge astra-badge--progress">${work.progress || 0} / ${total || '?'}</span>
              ${(work.customLists || []).map(l => `<span class="astra-badge astra-badge--list-item">${l}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="astra-edit-row">
          <span class="astra-badge astra-badge--type">${work.type?.toUpperCase()}</span>
        </div>
        <div class="astra-edit-row">
          <div class="astra-table-score-badge ${scoreClass}">${overallScore ? overallScore.toFixed(1) : '-'}</div>
        </div>
        ${sections.map(s => {
          const score = lastSeason.scores[s.id];
          return `<div class="astra-edit-row" style="color: ${score ? 'var(--astra-accent)' : 'var(--astra-muted)'}; font-weight: 700; font-family: var(--astra-font-mono)">${score ? (score as number).toFixed(1) : '-'}</div>`;
        }).join('')}
        <div class="astra-table-actions">
          <a href="${work.anilistUrl}" target="_blank" class="astra-icon-btn astra-external-link" title="Open on AniList">
            <i class="fa fa-external-link-alt"></i>
          </a>
          <button class="astra-icon-btn astra-delete-row" title="Delete Entry">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      </div>
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
    const overlay = this.overlay;

    // Toggle Stats
    overlay.querySelector('#astra-toggle-stats')?.addEventListener('click', () => {
      this.state.showStats = !this.state.showStats;
      const wrapper = overlay.querySelector('.astra-stats-wrapper');
      const btn = overlay.querySelector('#astra-toggle-stats');

      if (this.state.showStats) {
        wrapper?.classList.add('expanded');
        if (btn) btn.innerHTML = `<i class="fa fa-chart-line"></i> Hide`;
      } else {
        wrapper?.classList.remove('expanded');
        if (btn) btn.innerHTML = `<i class="fa fa-chart-line"></i> Stats`;
      }
    });

    // Toggle Progress
    overlay.querySelector('#astra-toggle-progress')?.addEventListener('click', (e) => {
      this.state.showProgress = !this.state.showProgress;
      const btn = e.currentTarget as HTMLElement;
      const container = overlay.querySelector('#astra-dashboard-container');

      btn.classList.toggle('active', this.state.showProgress);
      container?.classList.toggle('astra-show-progress', this.state.showProgress);
      this.updateDashboardDynamic(); // Refresh to apply/remove background styles
    });

    // Search
    const searchInput = overlay.querySelector('#astra-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      this.state.search = searchInput.value;
      this.updateDashboardDynamic();
    });

    // Chips & Selects
    overlay.querySelectorAll('.astra-chip').forEach(el => {
      if (el.tagName === 'SELECT') {
        el.addEventListener('change', (e) => {
          const target = e.currentTarget as HTMLSelectElement;
          const filterType = target.getAttribute('data-filter');
          if (filterType) {
            (this.state as any)[filterType] = target.value;
            this.updateDashboardDynamic();
          }
        });
      } else {
        el.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const groupEl = target.closest('.astra-filter-group');
          const filterType = groupEl?.getAttribute('data-filter');
          const val = target.getAttribute('data-val');

          if (filterType && val) {
            (this.state as any)[filterType] = val;
            this.updateDashboardDynamic();

            // Active class
            groupEl?.querySelectorAll('.astra-chip').forEach(c => c.classList.remove('active'));
            target.classList.add('active');
          }
        });
      }
    });

    // Sorting
    overlay.querySelectorAll('.astra-grid-header > div[data-sort]').forEach(th => {
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

    // Delegated Row Events (Edit, Delete)
    overlay.querySelector('#astra-dashboard-container')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.astra-grid-row');
      if (!row) return;

      const mediaId = parseInt(row.getAttribute('data-media-id') || '0');
      if (!mediaId) return;

      // Edit Row (Title, Cover, or Row background)
      if (target.closest('.astra-edit-row') || target.classList.contains('astra-grid-row')) {
        const work = this.service!.getWorks().find(w => w.mediaId === mediaId);
        if (work) {
          window.dispatchEvent(new CustomEvent('astra:edit-work', { detail: { work } }));
        }
        return;
      }

      // Delete Row
      if (target.closest('.astra-delete-row')) {
        if (confirm('Are you sure you want to delete this entry from Astra?')) {
          this.service!.deleteWork(mediaId);
          this.updateDashboardDynamic();
        }
        return;
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
        const result = await this.service!.syncWithAniList(this.apiClient);
        this.toast.success(`Sync complete! Added ${result.added} entries.`);

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
        this.toast.success('Astra database has been reset.');
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

  private async exportWrappedAsImage(): Promise<void> {
    if (!this.service) return;

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get and calculate stats
    const works = this.service.getWorks();
    const activeWorks = works.filter(w => ['COMPLETED', 'CURRENT'].includes(w.status));
    const completedWorks = works.filter(w => w.status === 'COMPLETED');
    const anime = activeWorks.filter(w => w.type === 'anime');
    const manga = activeWorks.filter(w => w.type === 'manga');
    const completedAnime = completedWorks.filter(w => w.type === 'anime');
    const completedManga = completedWorks.filter(w => w.type === 'manga');

    const stats = {
      animeCount: anime.length,
      mangaCount: manga.length,
      totalEpisodes: completedAnime.reduce((acc, w) => acc + (w.episodes || 0), 0),
      totalChapters: completedManga.reduce((acc, w) => acc + (w.chapters || 0), 0),
      animeDays: completedAnime.reduce((acc, w) => acc + ((w.episodes || 0) * (w.duration || 24)), 0) / (60 * 24),
      completed: completedWorks.length,
      watching: works.filter(w => w.status === 'CURRENT').length,
      planning: works.filter(w => w.status === 'PLANNING').length,
      dropped: works.filter(w => w.status === 'DROPPED').length,
      paused: works.filter(w => w.status === 'PAUSED').length,
      rewatching: works.filter(w => w.status === 'REPEATING').length,
    };

    // Calculate mean scores
    const animeScores = anime.map(w => this.service!.calcSeriesOverall(w)).filter((s): s is number => s !== null && s > 0);
    const mangaScores = manga.map(w => this.service!.calcSeriesOverall(w)).filter((s): s is number => s !== null && s > 0);
    const allScores = [...animeScores, ...mangaScores];
    const animeMean = animeScores.length ? animeScores.reduce((a, b) => a + b, 0) / animeScores.length * 10 : 0;
    const mangaMean = mangaScores.length ? mangaScores.reduce((a, b) => a + b, 0) / mangaScores.length * 10 : 0;
    const overallMean = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length * 10 : 0;

    // Monthly data
    const monthlyData = new Array(12).fill(0);
    activeWorks.forEach(w => {
      const month = new Date(w.updatedAt).getMonth();
      monthlyData[month]++;
    });
    const mostActiveMonthIndex = monthlyData.indexOf(Math.max(...monthlyData));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Genres
    const genreMap: Record<string, number> = {};
    activeWorks.forEach(w => (w.genres || []).forEach(g => genreMap[g] = (genreMap[g] || 0) + 1));
    const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // ============ DRAW ============

    // Epic background
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bg.addColorStop(0, '#0a0e27');
    bg.addColorStop(0.3, '#1a1b4b');
    bg.addColorStop(0.7, '#1e1b4b');
    bg.addColorStop(1, '#0f0a1e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Multiple liquid blobs
    const blobs = [
      { x: 300, y: 250, r: 700, color: 'rgba(59, 130, 246, 0.2)' },
      { x: 1600, y: 150, r: 600, color: 'rgba(139, 92, 246, 0.15)' },
      { x: 1000, y: 800, r: 650, color: 'rgba(6, 182, 212, 0.12)' },
      { x: 100, y: 900, r: 500, color: 'rgba(236, 72, 153, 0.1)' },
    ];
    blobs.forEach(blob => {
      const grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
      grad.addColorStop(0, blob.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    // Noise texture
    for (let i = 0; i < 2000; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.03})`;
      ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
    }

    // Helper: Rounded rect with arcs
    const roundRect = (x: number, y: number, w: number, h: number, r: number | number[]) => {
      const radius = Array.isArray(r) ? r : [r, r, r, r];
      ctx.beginPath();
      ctx.moveTo(x + radius[0], y);
      ctx.lineTo(x + w - radius[1], y);
      ctx.arc(x + w - radius[1], y + radius[1], radius[1], -Math.PI / 2, 0);
      ctx.lineTo(x + w, y + h - radius[2]);
      ctx.arc(x + w - radius[2], y + h - radius[2], radius[2], 0, Math.PI / 2);
      ctx.lineTo(x + radius[3], y + h);
      ctx.arc(x + radius[3], y + h - radius[3], radius[3], Math.PI / 2, Math.PI);
      ctx.lineTo(x, y + radius[0]);
      ctx.arc(x + radius[0], y + radius[0], radius[0], Math.PI, -Math.PI / 2);
      ctx.closePath();
    };

    // Title with glow
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 30;
    ctx.shadowColor = 'rgba(59, 130, 246, 0.6)';
    ctx.font = 'bold 80px Arial, sans-serif';
    ctx.fillText('YOUR 2024 WRAPPED', 70, 95);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'bold 26px Arial';
    ctx.fillText('Your Ultimate Anime & Manga Year in Review', 70, 135);

    // Helper: Premium card with gradient
    const drawPremiumCard = (x: number, y: number, w: number, h: number, title: string, value: string, subtitle: string, color1: string, color2: string) => {
      // Shadow
      ctx.shadowBlur = 40;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowOffsetY = 10;

      // Background gradient
      roundRect(x, y, w, h, 20);
      const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
      cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
      ctx.fillStyle = cardGrad;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Border glow
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Top accent
      roundRect(x, y, w, 5, [20, 20, 0, 0]);
      const accentGrad = ctx.createLinearGradient(x, y, x + w, y);
      accentGrad.addColorStop(0, color1);
      accentGrad.addColorStop(1, color2);
      ctx.fillStyle = accentGrad;
      ctx.fill();

      // Content
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = 'bold 20px Arial';
      ctx.fillText(title, x + 30, y + 50);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 70px Arial';
      ctx.fillText(value, x + 30, y + 125);

      // Subtitle with gradient
      const subGrad = ctx.createLinearGradient(x + 30, y + 150, x + 30 + 300, y + 150);
      subGrad.addColorStop(0, color1);
      subGrad.addColorStop(1, color2);
      ctx.fillStyle = subGrad;
      ctx.font = 'bold 18px Arial';
      ctx.fillText(subtitle, x + 30, y + 160);
    };

    // Main cards
    drawPremiumCard(70, 180, 560, 190, '📺 ANIME', stats.animeCount.toString(),
      `${stats.totalEpisodes} eps • ${stats.animeDays.toFixed(1)} days • ${animeMean.toFixed(1)}`,
      '#3b82f6', '#06b6d4');

    drawPremiumCard(660, 180, 560, 190, '📖 MANGA', stats.mangaCount.toString(),
      `${stats.totalChapters} chapters • ${mangaMean.toFixed(1)}`,
      '#ec4899', '#f43f5e');

    drawPremiumCard(1250, 180, 600, 190, '📅 ACTIVITY', activeWorks.length.toString(),
      `Most active: ${monthNames[mostActiveMonthIndex]} • ${overallMean.toFixed(1)} mean`,
      '#8b5cf6', '#a855f7');

    // Helper: Compact stat card
    const drawCompactCard = (x: number, y: number, w: number, h: number, label: string, value: string, color: string) => {
      roundRect(x, y, w, h, 12);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Left accent
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 5, h);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = 'bold 15px Arial';
      ctx.fillText(label, x + 22, y + 35);

      ctx.fillStyle = color;
      ctx.font = 'bold 48px Arial';
      ctx.fillText(value, x + 22, y + 85);
    };

    // Status grid
    const y2 = 400;
    const cw = 270;
    const gap = 20;
    drawCompactCard(70, y2, cw, 120, 'COMPLETED', stats.completed.toString(), '#10b981');
    drawCompactCard(70 + cw + gap, y2, cw, 120, 'WATCHING', stats.watching.toString(), '#3b82f6');
    drawCompactCard(70 + (cw + gap) * 2, y2, cw, 120, 'PLANNING', stats.planning.toString(), '#f59e0b');
    drawCompactCard(70 + (cw + gap) * 3, y2, cw, 120, 'DROPPED', stats.dropped.toString(), '#ef4444');

    const y3 = y2 + 140;
    drawCompactCard(70, y3, cw, 120, 'PAUSED', stats.paused.toString(), '#6366f1');
    drawCompactCard(70 + cw + gap, y3, cw, 120, 'REWATCHING', stats.rewatching.toString(), '#06b6d4');
    drawCompactCard(70 + (cw + gap) * 2, y3, cw, 120, 'MEAN SCORE', overallMean.toFixed(1), '#ffffff');
    drawCompactCard(70 + (cw + gap) * 3, y3, cw, 120, 'TOTAL', activeWorks.length.toString(), '#a855f7');

    // Genre Radar Chart
    const y4 = y3 + 160;
    roundRect(70, y4, 850, 280, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('🎭 GENRE DISTRIBUTION', 95, y4 + 40);

    // Radar chart
    const radarCenterX = 280;
    const radarCenterY = y4 + 170;
    const radarRadius = 100;
    const radarGenres = topGenres.slice(0, 6);
    const maxGenreCount = Math.max(...radarGenres.map(g => g[1]), 1);

    // Draw radar grid
    for (let i = 1; i <= 5; i++) {
      const r = (radarRadius / 5) * i;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const angle = (Math.PI * 2 * j / 6) - Math.PI / 2;
        const x = radarCenterX + Math.cos(angle) * r;
        const y = radarCenterY + Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.stroke();
    }

    // Draw axes
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(radarCenterX, radarCenterY);
      ctx.lineTo(
        radarCenterX + Math.cos(angle) * radarRadius,
        radarCenterY + Math.sin(angle) * radarRadius
      );
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.stroke();
    }

    // Draw data polygon
    if (radarGenres.length > 0) {
      ctx.beginPath();
      radarGenres.forEach(([_genre, count], i) => {
        const angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
        const r = (count / maxGenreCount) * radarRadius;
        const x = radarCenterX + Math.cos(angle) * r;
        const y = radarCenterY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      const radarGrad = ctx.createLinearGradient(radarCenterX - radarRadius, radarCenterY - radarRadius,
        radarCenterX + radarRadius, radarCenterY + radarRadius);
      radarGrad.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
      radarGrad.addColorStop(1, 'rgba(236, 72, 153, 0.3)');
      ctx.fillStyle = radarGrad;
      ctx.fill();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Labels
      const radarColors = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4'];
      radarGenres.forEach(([genre, count], i) => {
        const angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
        const labelR = radarRadius + 35;
        const x = radarCenterX + Math.cos(angle) * labelR;
        const y = radarCenterY + Math.sin(angle) * labelR;

        ctx.fillStyle = radarColors[i];
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(genre, x, y);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(count.toString(), x, y + 15);
      });
      ctx.textAlign = 'left';
    }

    // Genres list
    const listX = 500;
    topGenres.slice(0, 8).forEach(([genre, count], i) => {
      const ly = y4 + 70 + Math.floor(i / 2) * 50;
      const lx = listX + (i % 2) * 180;

      const radarColors = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4'];
      ctx.fillStyle = radarColors[i % 6];
      ctx.fillRect(lx, ly - 12, 4, 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(genre, lx + 12, ly);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.textAlign = 'right';
      ctx.fillText(count.toString(), lx + 160, ly);
      ctx.textAlign = 'left';
    });

    // Monthly chart
    roundRect(950, y4, 900, 280, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('📈 MONTHLY ACTIVITY', 975, y4 + 40);

    const chartX = 975;
    const chartY = y4 + 70;
    const chartW = 850;
    const chartH = 180;
    const max = Math.max(...monthlyData, 1);
    const barW = chartW / 12;
    const monthsShort = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

    monthlyData.forEach((value, i) => {
      const barH = Math.max((value / max) * chartH, 3);
      const barX = chartX + i * barW;
      const barY = chartY + chartH - barH;

      roundRect(barX + 8, barY, barW - 16, barH, 6);
      const barGrad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
      barGrad.addColorStop(0, '#3b82f6');
      barGrad.addColorStop(0.5, '#8b5cf6');
      barGrad.addColorStop(1, '#ec4899');
      ctx.fillStyle = barGrad;
      ctx.fill();

      // Value on top
      if (value > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(value.toString(), barX + barW / 2, barY - 5);
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = 'bold 13px Arial';
      ctx.fillText(monthsShort[i], barX + barW / 2, chartY + chartH + 20);
    });
    ctx.textAlign = 'left';

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('✨ Generated by AniList Ultimate', canvas.width - 70, canvas.height - 40);
    ctx.textAlign = 'left';

    this.downloadCanvas(canvas);
  }
  private downloadCanvas(canvas: HTMLCanvasElement): void {
    const link = document.createElement('a');
    link.download = `astra-wrapped-${new Date().getFullYear()}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  }
}
