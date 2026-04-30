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
import { MediaListStatus } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { BaseComponent } from '@ui/components/BaseComponent';
import { AstraService, AstraWork } from '../AstraService';
import { log } from '@core/logger';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { TOKENS } from '@core/di/tokens';
import { ToastService } from '@core/services/ToastService';
import { AstraRatingModal } from './AstraRatingModal';

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
    activeTab: 'dashboard' as 'dashboard' | 'settings',
    isGrouped: true,
    collapsedGroups: new Set<string>()
  };
  private renderProcessId = 0;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.AstraRatingModal) private ratingModal: AstraRatingModal
  ) {
    super({});

    // Load persisted progress state
    const savedProgress = localStorage.getItem('astra_show_progress');
    if (savedProgress !== null) {
      this.state.showProgress = savedProgress === 'true';
    }

    // BUG-009 Fix: Listen for global open event directly in the dashboard component
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, () => {
      this.open();
    });

    // BUG-020: Refresh dynamic elements on resize
    window.addEventListener('resize', () => {
      if (this.overlay) {
        this.updateDashboardDynamic();
      }
    });
  }

  public async open(): Promise<void> {
    log.debug('[AstraDashboard] Opening dashboard...');
    if (this.overlay) return;

    // BUG-FIX: Explicitly force all filter states to 'all' to ensure UI consistency
    this.state.type = 'all';
    this.state.country = 'all';
    this.state.status = 'all';
    this.state.anilistStatus = 'all';
    this.state.search = '';
    this.state.activeTab = 'dashboard';

    // Ensure service is initialized before first render to avoid "0 entries" glitch
    await this.service.init();

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
    this.overlay.classList.add('astra-modal-overlay--closing');
    this.overlay.classList.remove('astra-modal-overlay--open');
    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;

      // Only reset overflow if no other Astra modals are open
      if (!document.querySelector('.astra-modal-overlay')) {
        document.body.style.overflow = '';
      }
    }, 350); // Added 50ms buffer to ensure CSS animation finishes completely
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
    const works = this.service!.getWorks();
    return `
      <div class="astra-dashboard ${this.state.showProgress ? 'astra-show-progress' : ''}" id="astra-dashboard-container">
        <div class="astra-dashboard-top">
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
            <div class="astra-search-box-row">
              <div class="astra-search-box">
                <i class="fa fa-search"></i>
                <input type="text" id="astra-search" placeholder="Search by title..." value="${this.state.search}">
              </div>
            </div>
            
            <div class="astra-filter-bar" id="astra-list-filters">
              <!-- Dynamic Filters & Chips -->
            </div>
          </div>
        </div>

        <div class="astra-table-wrap" id="astra-table-wrap">
          ${works.length > 0 ? this.renderGrid() : this.renderEmptyState()}
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
                <div class="astra-section-card" data-id="${s.id}">
                  <div class="astra-section-header">
                    <div class="astra-section-info">
                      <div class="astra-section-drag"><i class="fa fa-grip-vertical"></i></div>
                      <input type="text" class="astra-input-ghost astra-section-name-input" value="${s.name}" data-field="name" placeholder="Section Name">
                    </div>
                    
                    <div class="astra-section-controls">
                      <div class="astra-weight-pill">
                        <span class="label">Weight</span>
                        <input type="number" class="astra-weight-input" value="${s.weight}" data-field="weight" step="0.1" min="0.1" max="10">
                      </div>
                      
                      <div class="astra-section-btns">
                        <button class="astra-btn-icon astra-add-sub" data-section-id="${s.id}" title="Add Component">
                          <i class="fa fa-plus"></i>
                        </button>
                        <button class="astra-btn-icon astra-btn-icon--danger astra-delete-section" title="Delete Category">
                          <i class="fa fa-trash-alt"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div class="astra-sub-sections-editor">
                    ${(s.subSections || []).map(sub => `
                      <div class="astra-sub-edit-row" data-sub-id="${sub.id}">
                        <div class="astra-sub-indicator"></div>
                        <input type="text" class="astra-input-ghost astra-sub-name-input" value="${sub.name}" data-field="sub-name" placeholder="Component Name">
                        
                        <div class="astra-sub-controls">
                          <div class="astra-weight-pill astra-weight-pill--sm">
                            <input type="number" class="astra-weight-input" value="${sub.weight}" data-field="sub-weight" step="0.1" min="0.1">
                          </div>
                          <button class="astra-btn-icon astra-btn-icon--sm astra-delete-sub" title="Delete Component">
                            <i class="fa fa-times"></i>
                          </button>
                        </div>
                      </div>
                    `).join('')}
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

  public refresh(): void {
    this.updateDashboardDynamic();
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
    let tbody = this.overlay.querySelector('#astra-table-body');

    // If tbody is missing but we now have works (transition from empty state)
    if (!tbody && sortedWorks.length > 0) {
      this.renderDashboard(); // Full re-render to switch from Welcome screen to Grid
      return;
    }

    if (tbody) {
      tbody.innerHTML = '';

      this.renderProcessId++;
      const currentProcessId = this.renderProcessId;

      if (sortedWorks.length > 0) {
        const groupedItems: any[] = [];
        const groups = new Map<string, any[]>();

        sortedWorks.forEach(w => {
          let status = (w.status || 'UNKNOWN').toUpperCase();
          if (status === MediaListStatus.CURRENT) {
            status = w.type === 'manga' ? MediaListStatus.READING : MediaListStatus.WATCHING;
          } else if (status === MediaListStatus.REPEATING) {
            status = w.type === 'manga' ? MediaListStatus.REREADING : MediaListStatus.REWATCHING;
          } else if (status === MediaListStatus.PLANNING) {
            status = w.type === 'manga' ? MediaListStatus.PLAN_TO_READ : MediaListStatus.PLAN_TO_WATCH;
          }
          if (!groups.has(status)) groups.set(status, []);
          groups.get(status)!.push(w);
        });

        // Order groups: CURRENT/WATCHING/READING first, then COMPLETED, then others
        const statusOrder = [
          MediaListStatus.WATCHING,
          MediaListStatus.READING,
          MediaListStatus.REWATCHING,
          MediaListStatus.REREADING,
          MediaListStatus.COMPLETED,
          MediaListStatus.PLAN_TO_WATCH,
          MediaListStatus.PLAN_TO_READ,
          MediaListStatus.PAUSED,
          MediaListStatus.DROPPED,
          'UNKNOWN'
        ];
        const sortedStatuses = Array.from(groups.keys()).sort((a, b) => {
          const idxA = statusOrder.indexOf(a);
          const idxB = statusOrder.indexOf(b);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.localeCompare(b);
        });

        sortedStatuses.forEach(status => {
          const groupWorks = groups.get(status)!;
          const isCollapsed = this.state.collapsedGroups.has(status);
          groupedItems.push({ isHeader: true, status, count: groupWorks.length, isCollapsed });
          if (!isCollapsed) {
            groupedItems.push(...groupWorks);
          }
        });

        this.renderChunks(groupedItems, 0, 50, currentProcessId, tbody as HTMLElement);
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
      const standardLists = [MediaListStatus.COMPLETED, MediaListStatus.DROPPED, MediaListStatus.PAUSED, MediaListStatus.PLANNING, MediaListStatus.WATCHING, MediaListStatus.READING, MediaListStatus.REPEATING, MediaListStatus.CURRENT];
      const SPECIAL_LISTS = ['Private', 'Hide from status lists'];
      const allCustom = Array.from(new Set(works.flatMap(w => w.customLists || [])))
        .filter(l => !standardLists.includes(l.toUpperCase() as MediaListStatus));
      const customLists = allCustom.filter(l => !SPECIAL_LISTS.includes(l)).sort();
      const specialLists = allCustom.filter(l => SPECIAL_LISTS.includes(l));

      const mainStatuses: any[] = [
        { id: 'all', label: 'All', icon: 'fa-layer-group', type: 'all' }
      ];

      // Define Cycles
      const cycles = [
        {
          id: 'cycle-current',
          options: [
            { status: MediaListStatus.CURRENT, type: 'all', label: 'In Progress', icon: 'fa-play' },
            { status: MediaListStatus.WATCHING, type: 'anime', label: 'Watching', icon: 'fa-play' },
            { status: MediaListStatus.READING, type: 'manga', label: 'Reading', icon: 'fa-book-open' }
          ]
        },
        {
          id: 'cycle-repeating',
          options: [
            { status: MediaListStatus.REPEATING, type: 'all', label: 'Repeating', icon: 'fa-redo' },
            { status: MediaListStatus.REWATCHING, type: 'anime', label: 'Rewatching', icon: 'fa-redo' },
            { status: MediaListStatus.REREADING, type: 'manga', label: 'Rereading', icon: 'fa-redo' }
          ]
        },
        {
          id: 'cycle-planning',
          options: [
            { status: MediaListStatus.PLANNING, type: 'all', label: 'Planning', icon: 'fa-calendar' },
            { status: MediaListStatus.PLAN_TO_WATCH, type: 'anime', label: 'Plan to Watch', icon: 'fa-calendar' },
            { status: MediaListStatus.PLAN_TO_READ, type: 'manga', label: 'Plan to Read', icon: 'fa-calendar' }
          ]
        },
        {
          id: 'cycle-completed',
          options: [
            { status: MediaListStatus.COMPLETED, type: 'all', label: 'Completed', icon: 'fa-check-double' },
            { status: MediaListStatus.COMPLETED, type: 'anime', label: 'Completed Anime', icon: 'fa-check-double' },
            { status: MediaListStatus.COMPLETED, type: 'manga', label: 'Completed Manga', icon: 'fa-check-double' }
          ]
        },
        {
          id: 'cycle-paused',
          options: [
            { status: MediaListStatus.PAUSED, type: 'all', label: 'Paused', icon: 'fa-pause-circle' },
            { status: MediaListStatus.PAUSED, type: 'anime', label: 'Paused Anime', icon: 'fa-pause-circle' },
            { status: MediaListStatus.PAUSED, type: 'manga', label: 'Paused Manga', icon: 'fa-pause-circle' }
          ]
        },
        {
          id: 'cycle-dropped',
          options: [
            { status: MediaListStatus.DROPPED, type: 'all', label: 'Dropped', icon: 'fa-trash-alt' },
            { status: MediaListStatus.DROPPED, type: 'anime', label: 'Dropped Anime', icon: 'fa-trash-alt' },
            { status: MediaListStatus.DROPPED, type: 'manga', label: 'Dropped Manga', icon: 'fa-trash-alt' }
          ]
        }
      ];

      // Add "All" chip
      const isAllActive = this.state.anilistStatus === 'all' && this.state.status === 'all';

      // Determine which chip to show for each cycle
      cycles.forEach(cycle => {
        // An option is active if its status matches anilistStatus AND its type matches state.type
        const activeIdx = cycle.options.findIndex(opt =>
          this.state.anilistStatus === opt.status &&
          (this.state.type === opt.type)
        );

        const isActive = activeIdx !== -1;
        const displayOpt = isActive ? cycle.options[activeIdx] : cycle.options[0];

        mainStatuses.push({
          id: cycle.id,
          status: displayOpt.status,
          label: displayOpt.label,
          icon: displayOpt.icon,
          isActive,
          type: displayOpt.type,
          options: cycle.options
        });
      });

      listContainer.innerHTML = `
        <div class="astra-macro-categories">
          ${mainStatuses.map(s => {
        const activeClass = s.isActive || (s.id === 'all' && isAllActive) ? 'active' : '';
        return `
              <button class="astra-macro-chip ${activeClass}" 
                      data-id="${s.id}" 
                      data-status="${s.status || s.id}"
                      ${s.options ? `data-cycle='${JSON.stringify(s.options).replace(/'/g, "&apos;")}'` : ''}>
                <i class="fa ${s.icon}"></i> ${s.label}
              </button>
            `;
      }).join('')}
        </div>

        <div class="astra-secondary-filters">
          <!-- Custom Lists Dropdown -->
          <div class="astra-dropdown">
            <button class="astra-chip astra-dropdown-trigger ${this.state.status !== 'all' ? 'active' : ''}">
              <i class="fa fa-list-ul"></i> ${this.state.status !== 'all' ? this.state.status : 'Custom Lists'}
              <i class="fa fa-chevron-down" style="font-size: 10px; opacity: 0.5"></i>
            </button>
            <div class="astra-dropdown-menu">
              <div class="astra-dropdown-item" data-val="all">
                <i class="fa fa-times"></i> Clear Custom Filter
              </div>
              <div class="astra-dropdown-divider"></div>
              ${customLists.map(list => `
                <div class="astra-dropdown-item ${this.state.status === list ? 'active' : ''}" data-val="${list}">
                  <i class="fa fa-tag"></i> ${list}
                </div>
              `).join('')}
              ${specialLists.length > 0 ? `
                <div class="astra-dropdown-divider"></div>
                ${specialLists.map(list => `
                  <div class="astra-dropdown-item astra-dropdown-item--special ${this.state.status === list ? 'active' : ''}" data-val="${list}">
                    <i class="fa fa-${list === 'Private' ? 'lock' : 'eye-slash'}"></i> ${list}
                  </div>
                `).join('')}
              ` : ''}
            </div>
          </div>

          <div class="astra-filter-divider"></div>

          <div class="astra-secondary-stacked">
            <!-- Type Dropdown -->
            <div class="astra-dropdown">
              <button class="astra-chip astra-dropdown-trigger ${this.state.type !== 'all' ? 'active' : ''}" data-dropdown="type">
                <i class="fa fa-film"></i> ${this.state.type === 'all' ? 'Type' : this.state.type.charAt(0).toUpperCase() + this.state.type.slice(1)}
                <i class="fa fa-chevron-down" style="font-size: 10px; opacity: 0.5"></i>
              </button>
              <div class="astra-dropdown-menu">
                <div class="astra-dropdown-item ${this.state.type === 'all' ? 'active' : ''}" data-filter="type" data-val="all">
                  <i class="fa fa-times"></i> All Types
                </div>
                <div class="astra-dropdown-divider"></div>
                <div class="astra-dropdown-item ${this.state.type === 'anime' ? 'active' : ''}" data-filter="type" data-val="anime">
                  <i class="fa fa-tv"></i> Anime
                </div>
                <div class="astra-dropdown-item ${this.state.type === 'manga' ? 'active' : ''}" data-filter="type" data-val="manga">
                  <i class="fa fa-book"></i> Manga
                </div>
                <div class="astra-dropdown-item ${this.state.type === 'novel' ? 'active' : ''}" data-filter="type" data-val="novel">
                  <i class="fa fa-book-open"></i> Novel
                </div>
              </div>
            </div>

            <!-- Country Dropdown -->
            <div class="astra-dropdown">
              <button class="astra-chip astra-dropdown-trigger ${this.state.country !== 'all' ? 'active' : ''}" data-dropdown="country">
                <i class="fa fa-globe"></i> ${this.state.country === 'all' ? 'Country' : this.getCountryLabel(this.state.country)}
                <i class="fa fa-chevron-down" style="font-size: 10px; opacity: 0.5"></i>
              </button>
              <div class="astra-dropdown-menu">
                <div class="astra-dropdown-item ${this.state.country === 'all' ? 'active' : ''}" data-filter="country" data-val="all">
                  <i class="fa fa-times"></i> All Countries
                </div>
                <div class="astra-dropdown-divider"></div>
                <div class="astra-dropdown-item ${this.state.country === 'JP' ? 'active' : ''}" data-filter="country" data-val="JP">
                  <i class="fa fa-flag"></i> Japan
                </div>
                <div class="astra-dropdown-item ${this.state.country === 'CN' ? 'active' : ''}" data-filter="country" data-val="CN">
                  <i class="fa fa-flag"></i> China
                </div>
                <div class="astra-dropdown-item ${this.state.country === 'KR' ? 'active' : ''}" data-filter="country" data-val="KR">
                  <i class="fa fa-flag"></i> Korea
                </div>
                <div class="astra-dropdown-item ${this.state.country === 'TW' ? 'active' : ''}" data-filter="country" data-val="TW">
                  <i class="fa fa-flag"></i> Taiwan
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Attach macro events
      listContainer.querySelectorAll('.astra-macro-chip').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id')!;
          const cycleId = el.getAttribute('data-cycle')?.replace(/'/g, '"');

          if (id === 'all') {
            this.state.anilistStatus = 'all';
            this.state.status = 'all';
            this.state.type = 'all';
          } else if (cycleId) {
            const options = JSON.parse(cycleId);
            const currentIdx = options.findIndex((opt: any) =>
              this.state.anilistStatus === opt.status &&
              this.state.type === opt.type
            );

            const nextIdx = (currentIdx + 1) % options.length;
            const nextOpt = options[nextIdx];

            this.state.anilistStatus = nextOpt.status;
            this.state.type = nextOpt.type;
            this.state.status = 'all';
          } else {
            // Static statuses
            const status = el.getAttribute('data-status')!;
            this.state.anilistStatus = status;
            this.state.status = 'all';
          }
          this.updateDashboardDynamic();
        });
      });

      // Attach dropdown events for all dropdowns (Custom Lists, Type, Country)
      listContainer.querySelectorAll('.astra-dropdown').forEach(dropdown => {
        const trigger = dropdown.querySelector('.astra-dropdown-trigger');

        trigger?.addEventListener('click', (e) => {
          e.stopPropagation();
          // Close other dropdowns
          listContainer.querySelectorAll('.astra-dropdown.active').forEach(d => {
            if (d !== dropdown) d.classList.remove('active');
          });
          dropdown.classList.toggle('active');
        });

        dropdown.querySelectorAll('.astra-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = item.getAttribute('data-val')!;
            const filter = item.getAttribute('data-filter');

            let needsUpdate = false;

            if (filter === 'type') {
              if (this.state.type !== val) {
                this.state.type = val;

                // Bidirectional sync: if current anilistStatus belongs to a cycle, 
                // update it to match the new type
                const cycleBaseMap: Record<string, Record<string, string>> = {
                  [MediaListStatus.CURRENT]: { anime: MediaListStatus.WATCHING, manga: MediaListStatus.READING, all: MediaListStatus.CURRENT },
                  [MediaListStatus.WATCHING]: { anime: MediaListStatus.WATCHING, manga: MediaListStatus.READING, all: MediaListStatus.CURRENT },
                  [MediaListStatus.READING]: { anime: MediaListStatus.WATCHING, manga: MediaListStatus.READING, all: MediaListStatus.CURRENT },
                  [MediaListStatus.REPEATING]: { anime: MediaListStatus.REWATCHING, manga: MediaListStatus.REREADING, all: MediaListStatus.REPEATING },
                  [MediaListStatus.REWATCHING]: { anime: MediaListStatus.REWATCHING, manga: MediaListStatus.REREADING, all: MediaListStatus.REPEATING },
                  [MediaListStatus.REREADING]: { anime: MediaListStatus.REWATCHING, manga: MediaListStatus.REREADING, all: MediaListStatus.REPEATING },
                  [MediaListStatus.PLANNING]: { anime: MediaListStatus.PLAN_TO_WATCH, manga: MediaListStatus.PLAN_TO_READ, all: MediaListStatus.PLANNING },
                  [MediaListStatus.PLAN_TO_WATCH]: { anime: MediaListStatus.PLAN_TO_WATCH, manga: MediaListStatus.PLAN_TO_READ, all: MediaListStatus.PLANNING },
                  [MediaListStatus.PLAN_TO_READ]: { anime: MediaListStatus.PLAN_TO_WATCH, manga: MediaListStatus.PLAN_TO_READ, all: MediaListStatus.PLANNING }
                };

                const currentStatus = this.state.anilistStatus;
                if (cycleBaseMap[currentStatus]) {
                  const typeKey = (val === 'anime' || val === 'manga') ? val : 'all';
                  this.state.anilistStatus = cycleBaseMap[currentStatus][typeKey] || currentStatus;
                }

                needsUpdate = true;
              }
            } else if (filter === 'country') {
              if (this.state.country !== val) {
                this.state.country = val;
                needsUpdate = true;
              }
            } else {
              // Custom list filter
              if (this.state.status !== val) {
                this.state.status = val;
                this.state.anilistStatus = 'all'; // Clear status filter when using custom list
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              this.updateDashboardDynamic();
            }
            dropdown.classList.remove('active');
          });
        });
      });

      // Close dropdowns when clicking outside
      this.overlay!.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.astra-dropdown')) {
          this.overlay!.querySelectorAll('.astra-dropdown.active').forEach(d => d.classList.remove('active'));
        }
      });

      // Note: Dropdown events are now handled above in the unified dropdown handler
    }

    // Update active chips for Type and Country
    this.overlay.querySelectorAll('.astra-filter-chips:not(#astra-list-filters) .astra-chip').forEach(chip => {
      const filterType = chip.closest('.astra-filter-group')?.getAttribute('data-filter');
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

  private renderChunks(items: any[], start: number, count: number, processId: number, container: HTMLElement): void {
    if (processId !== this.renderProcessId || !this.overlay) return;

    const chunk = items.slice(start, start + count);
    if (chunk.length === 0) return;

    const html = chunk.map(item => {
      if (item.isHeader) {
        return this.renderGroupHeader(item.status, item.count, item.isCollapsed);
      }
      return this.renderRow(item);
    }).join('');
    container.insertAdjacentHTML('beforeend', html);

    if (start + count < items.length) {
      requestAnimationFrame(() => {
        this.renderChunks(items, start + count, count, processId, container);
      });
    }
  }

  private renderGroupHeader(status: string, count: number, isCollapsed: boolean): string {
    const icon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
    return `
      <div class="astra-grid-group-header ${isCollapsed ? 'collapsed' : ''}" data-status="${status}">
        <div class="astra-group-info">
          <i class="fa ${icon}"></i>
          <span class="astra-group-title">${getStatusLabel(status as MediaListStatus, this.state.type === 'manga' ? 'MANGA' : 'ANIME')}</span>
          <span class="astra-group-badge">${count}</span>
        </div>
        <div class="astra-group-line"></div>
      </div>
    `;
  }

  private getFilteredWorks(works: AstraWork[]): AstraWork[] {
    return works.filter(w => {
      const matchSearch = !this.state.search || w.title.toLowerCase().includes(this.state.search.toLowerCase());
      const matchType = this.state.type === 'all' || w.type === this.state.type;
      const matchStatus = this.state.status === 'all' || (w.customLists || []).includes(this.state.status);
      let matchAnilistStatus = true;
      if (this.state.anilistStatus !== 'all') {
        const wStatus = (w.status || '').toUpperCase();
        if (this.state.anilistStatus === MediaListStatus.WATCHING) {
          matchAnilistStatus = wStatus === MediaListStatus.CURRENT && w.type === 'anime';
        } else if (this.state.anilistStatus === MediaListStatus.READING) {
          matchAnilistStatus = wStatus === MediaListStatus.CURRENT && w.type === 'manga';
        } else if (this.state.anilistStatus === MediaListStatus.REWATCHING) {
          matchAnilistStatus = wStatus === MediaListStatus.REPEATING && w.type === 'anime';
        } else if (this.state.anilistStatus === MediaListStatus.REREADING) {
          matchAnilistStatus = wStatus === MediaListStatus.REPEATING && w.type === 'manga';
        } else if (this.state.anilistStatus === MediaListStatus.PLAN_TO_WATCH) {
          matchAnilistStatus = wStatus === MediaListStatus.PLANNING && w.type === 'anime';
        } else if (this.state.anilistStatus === MediaListStatus.PLAN_TO_READ) {
          matchAnilistStatus = wStatus === MediaListStatus.PLANNING && w.type === 'manga';
        } else {
          matchAnilistStatus = wStatus === this.state.anilistStatus;
        }
      }
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
      ? `background-image: linear-gradient(90deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%); background-size: ${percent}% 100%; box-shadow: inset 3px 0 0 #3b82f6;`
      : '';

    return `
      <div class="astra-grid-row ${noProgressClass}" data-media-id="${work.mediaId}" style="${rowStyle} --progress-val: ${percent}">
        <div class="astra-edit-row">
          <img src="${work.cover}" class="astra-table-cover">
        </div>
        <div class="astra-edit-row">
          <div class="astra-table-title-box">
            <div class="astra-table-title" title="Open Rating Modal">${work.title}</div>
            <div class="astra-table-subtitle">
              <span class="astra-badge astra-badge--country">${work.country || 'JP'}</span>
              <span class="astra-badge astra-badge--progress">${work.progress || 0} / ${total || '?'}</span>
              ${(() => {
        const allLists = work.customLists || [];
        if (allLists.length === 0) return '';
        const SPECIAL = ['Private', 'Hide from status lists'];
        const normal = allLists.filter(l => !SPECIAL.includes(l));
        const special = allLists.filter(l => SPECIAL.includes(l));
        return `
                  <div class="astra-lists-dropdown">
                    <span class="astra-badge astra-badge--list-item astra-list-multi">+${allLists.length}</span>
                    <div class="astra-lists-menu">
                      ${normal.map(l => `<div class="astra-list-menu-item"><i class="fa fa-tag"></i> ${l}</div>`).join('')}
                      ${special.length > 0 ? `<div class="astra-lists-menu-divider"></div>${special.map(l => `<div class="astra-list-menu-item astra-list-menu-item--special"><i class="fa fa-${l === 'Private' ? 'lock' : 'eye-slash'}"></i> ${l}</div>`).join('')}` : ''}
                    </div>
                  </div>
                `;
      })()}
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
          <a class="astra-icon-btn astra-anilist-link" href="${work.anilistUrl || '#'}" target="_blank" title="Open on AniList">
            <i class="fa fa-external-link-alt"></i>
          </a>
          <button class="astra-icon-btn astra-delete-row" title="Delete from Astra">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  private renderGrid(): string {
    const sections = this.service!.getSections();

    return `
      <div class="astra-grid" style="--astra-dynamic-cols: repeat(${sections.length}, 105px)">
        <div class="astra-grid-header">
          <div style="width: 65px; justify-content: center; padding: 0;">Cover</div>
          <div class="astra-sortable" data-sort="title" style="width: 220px">Title</div>
          <div class="astra-sortable" data-sort="type" style="width: 92px">Type</div>
          <div class="astra-sortable" data-sort="score" style="width: 80px">Score</div>
          ${sections.map(s => `<div class="astra-sortable" data-sort="section-${s.id}">${s.name}</div>`).join('')}
          <div style="justify-content: center">Actions</div>
        </div>
        <div id="astra-table-body">
           <!-- Rows will be injected by updateDashboardDynamic -->
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

    // Click outside to close (mousedown for snappiness)
    this.overlay.addEventListener('mousedown', (e) => {
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
      localStorage.setItem('astra_show_progress', String(this.state.showProgress));
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
          const groupEl = target.closest('.astra-filter-group');

          if (filterType) {
            (this.state as any)[filterType] = target.value;
            this.updateDashboardDynamic();

            // Highlight management
            if (target.value === 'all') {
              target.classList.remove('active');
              groupEl?.querySelector('button[data-val="all"]')?.classList.add('active');
            } else {
              target.classList.add('active');
              groupEl?.querySelector('button[data-val="all"]')?.classList.remove('active');
            }
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

            // If clicking "All" button, reset sibling select if exists
            const select = groupEl?.querySelector('select');
            if (val === 'all' && select) {
              select.value = 'all';
              select.classList.remove('active');
            }

            // Active class management
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

    // Group Header Toggle (Delegated)
    overlay.querySelector('#astra-table-body')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const header = target.closest('.astra-grid-group-header');
      if (header) {
        const status = header.getAttribute('data-status');
        if (status) {
          if (this.state.collapsedGroups.has(status)) {
            this.state.collapsedGroups.delete(status);
          } else {
            this.state.collapsedGroups.add(status);
          }
          this.updateDashboardDynamic();
        }
      }
    });

    // Delegated Row Events (Edit, Delete)
    // Table Interaction Delegation (Title, Lightbox, Delete)
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // 1. Cover Lightbox - High-resolution image preview
      const coverImg = target.closest('.astra-table-cover') as HTMLImageElement;
      if (coverImg) {
        this.openImageLightbox(coverImg.src);
        return;
      }

      const row = target.closest('.astra-grid-row');
      if (!row) return;

      const mediaId = parseInt(row.getAttribute('data-media-id') || '0');
      if (!mediaId) return;

      // 2. AniList redirection
      if (target.closest('.astra-anilist-link')) return;

      // 3. Delete entry from Astra database
      if (target.closest('.astra-delete-row')) {
        const title = row.querySelector('.astra-table-title')?.textContent || 'this work';
        if (confirm(`Are you sure you want to delete "${title}" from Astra?`)) {
          this.service!.deleteWork(mediaId);
          this.updateDashboardDynamic();
        }
        return;
      }

      // 4. Launch Rating Modal for the specific work
      if (target.closest('.astra-table-title')) {
        this.ratingModal.open(mediaId);
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
      div.className = 'astra-section-card';
      div.dataset.id = newId;
      div.innerHTML = `
        <div class="astra-section-header">
          <div class="astra-section-info">
            <div class="astra-section-drag"><i class="fa fa-grip-vertical"></i></div>
            <input type="text" class="astra-input-ghost astra-section-name-input" value="New Category" data-field="name">
          </div>
          
          <div class="astra-section-controls">
            <div class="astra-weight-pill">
              <span class="label">Weight</span>
              <input type="number" class="astra-weight-input" value="1" data-field="weight" step="0.1" min="0.1">
            </div>
            
            <div class="astra-section-btns">
              <button class="astra-btn-icon astra-add-sub" data-section-id="${newId}" title="Add Component">
                <i class="fa fa-plus"></i>
              </button>
              <button class="astra-btn-icon astra-btn-icon--danger astra-delete-section" title="Delete Category">
                <i class="fa fa-trash-alt"></i>
              </button>
            </div>
          </div>
        </div>
        <div class="astra-sub-sections-editor"></div>
      `;
      editor.appendChild(div);
      this.attachSettingsItemEvents(div);

      const input = div.querySelector('.astra-section-name-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    });

    // Existing items
    this.overlay.querySelectorAll('.astra-section-card').forEach(group => {
      this.attachSettingsItemEvents(group as HTMLElement);
    });

    // Save
    this.overlay.querySelector('#astra-save-sections')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Saving...';

      const sections: any[] = [];
      this.overlay!.querySelectorAll('.astra-section-card').forEach(group => {
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
    group.querySelector('.astra-add-sub')?.addEventListener('click', () => {
      const editor = group.querySelector('.astra-sub-sections-editor');
      if (!editor) return;

      const subId = `s_${Math.random().toString(36).slice(2, 7)}`;
      const subDiv = document.createElement('div');
      subDiv.className = 'astra-sub-edit-row';
      subDiv.dataset.subId = subId;
      subDiv.innerHTML = `
        <div class="astra-sub-indicator"></div>
        <input type="text" class="astra-input-ghost astra-sub-name-input" value="New Component" data-field="sub-name">
        
        <div class="astra-sub-controls">
          <div class="astra-weight-pill astra-weight-pill--sm">
            <input type="number" class="astra-weight-input" value="1" data-field="sub-weight" step="0.1" min="0.1">
          </div>
          <button class="astra-btn-icon astra-btn-icon--sm astra-delete-sub" title="Delete Component">
            <i class="fa fa-times"></i>
          </button>
        </div>
      `;
      editor.appendChild(subDiv);

      const input = subDiv.querySelector('.astra-sub-name-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }

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
    const activeWorks = works.filter(w => [MediaListStatus.COMPLETED, MediaListStatus.CURRENT].includes(w.status));
    const completedWorks = works.filter(w => w.status === MediaListStatus.COMPLETED);
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
      watching: works.filter(w => w.status === MediaListStatus.CURRENT).length,
      planning: works.filter(w => w.status === MediaListStatus.PLANNING).length,
      dropped: works.filter(w => w.status === MediaListStatus.DROPPED).length,
      paused: works.filter(w => w.status === MediaListStatus.PAUSED).length,
      rewatching: works.filter(w => w.status === MediaListStatus.REPEATING).length,
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
    drawCompactCard(70, y2, cw, 120, MediaListStatus.COMPLETED, stats.completed.toString(), '#10b981');
    drawCompactCard(70 + cw + gap, y2, cw, 120, MediaListStatus.WATCHING, stats.watching.toString(), '#3db4f2');
    drawCompactCard(70 + (cw + gap) * 2, y2, cw, 120, MediaListStatus.PLANNING, stats.planning.toString(), '#f59e0b');
    drawCompactCard(70 + (cw + gap) * 3, y2, cw, 120, MediaListStatus.DROPPED, stats.dropped.toString(), '#ef4444');

    const y3 = y2 + 140;
    drawCompactCard(70, y3, cw, 120, MediaListStatus.PAUSED, stats.paused.toString(), '#6366f1');
    drawCompactCard(70 + cw + gap, y3, cw, 120, MediaListStatus.REWATCHING, stats.rewatching.toString(), '#06b6d4');
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

  /**
   * Get human-readable country label from country code
   */
  private getCountryLabel(code: string): string {
    const labels: Record<string, string> = {
      'JP': 'Japan',
      'CN': 'China',
      'KR': 'Korea',
      'TW': 'Taiwan'
    };
    return labels[code] || code;
  }

  /**
   * Opens a full-screen lightbox for an image
   */
  private openImageLightbox(url: string): void {
    let lightbox = document.querySelector('.astra-lightbox') as HTMLElement;
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'astra-lightbox';
      lightbox.innerHTML = `<img class="astra-lightbox-content" src="${url.replace('/medium/', '/large/').replace('/small/', '/large/')}">`;
      document.body.appendChild(lightbox);

      lightbox.addEventListener('click', () => {
        lightbox.classList.remove('astra-lightbox--open');
        document.body.style.overflow = '';
        setTimeout(() => lightbox.remove(), 300);
      });
    }

    // Lock background scrolling for UX consistency
    document.body.style.overflow = 'hidden';

    // Trigger animation
    requestAnimationFrame(() => {
      lightbox.classList.add('astra-lightbox--open');
    });
  }
}
