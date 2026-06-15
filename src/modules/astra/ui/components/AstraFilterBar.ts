/**
 * @file AstraFilterBar.ts
 * @description Component for searching and filtering works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState } from '../../interfaces/IDashboardState';
import { AstraService } from '../../AstraService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { TOKENS } from '@core/di/tokens';
import { html, when } from '@core/utils/Template';

@injectable()
export class AstraFilterBar extends AstraView {
  private customLists: string[] = [];
  private customListsLoaded = false;
  private customListsLoading = false;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  /**
   * Renders the filter controls and search box.
   */
  protected template(state: IDashboardState): HTMLElement {
    if (!this.store || !state || !state.filters) return html`<div></div>`;
    const { filters } = state;
    const isAllActive =
      filters.type === 'all' &&
      filters.ratingStatus === 'all' &&
      filters.anilistStatus === 'all' &&
      filters.country === 'all';
    const activeStatuses = this.getActiveStatuses(filters.anilistStatus);
    const watchingActive =
      filters.type === 'anime' &&
      (activeStatuses.includes(MediaListStatus.CURRENT) ||
        activeStatuses.includes(MediaListStatus.REPEATING));
    const readingActive =
      (filters.type === 'manga' || filters.type === 'novel') &&
      (activeStatuses.includes(MediaListStatus.CURRENT) ||
        activeStatuses.includes(MediaListStatus.REPEATING));
    const watchingLabel =
      filters.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING)
        ? 'Rewatching'
        : 'Watching';
    const readingLabel =
      (filters.type === 'manga' || filters.type === 'novel') &&
      activeStatuses.includes(MediaListStatus.REPEATING)
        ? 'Rereading'
        : 'Reading';
    const typeLabel =
      filters.type === 'anime'
        ? 'Anime'
        : filters.type === 'manga'
          ? 'Manga'
          : filters.type === 'novel'
            ? 'Novel'
            : 'Type';
    const countryLabel =
      filters.country === 'JP'
        ? 'Japan'
        : filters.country === 'KR'
          ? 'Korea'
          : filters.country === 'CN'
            ? 'China'
            : filters.country === 'TW'
              ? 'Taiwan'
              : 'Country';
    const customLists = this.customListsLoaded ? this.customLists : this.getManifestCustomLists();
    const selectedLists = filters.customLists || [];
    const prettyList = (v: string) =>
      v === '__hidden__' ? 'Hide from status lists' : v === '__private__' ? 'Private' : v;
    const customListLabel =
      selectedLists.length === 0
        ? 'Custom Lists'
        : selectedLists.length === 1
          ? prettyList(selectedLists[0])
          : `${selectedLists.length} lists`;
    return html`
      <div class="astra-dashboard-controls astra-dashboard-controls--toolbar">
        <div class="astra-filter-toolbar">
          <div class="astra-filter-toolbar-left">
            <button
              type="button"
              class="astra-toolbar-chip ${when(isAllActive, 'active')}"
              data-quick-filter="all"
            >
              <i class="fa-solid fa-layer-group"></i>
              <span>All</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(watchingActive, 'active')}"
              data-quick-filter="watching"
            >
              <i
                class="fa-solid ${when(
                  filters.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING),
                  'fa-rotate-right'
                ) || 'fa-play'}"
              ></i>
              <span>${watchingLabel}</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(readingActive, 'active')}"
              data-quick-filter="reading"
            >
              <i
                class="fa-solid ${when(
                  (filters.type === 'manga' || filters.type === 'novel') &&
                    activeStatuses.includes(MediaListStatus.REPEATING),
                  'fa-rotate-right'
                ) || 'fa-book-open'}"
              ></i>
              <span>${readingLabel}</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.COMPLETED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.COMPLETED}"
            >
              <i class="fa-solid fa-check"></i>
              <span>Completed</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.PAUSED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.PAUSED}"
            >
              <i class="fa-solid fa-pause"></i>
              <span>Paused</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.DROPPED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.DROPPED}"
            >
              <i class="fa-solid fa-circle-xmark"></i>
              <span>Dropped</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.PLANNING),
                'active'
              )}"
              data-status-filter="${MediaListStatus.PLANNING}"
            >
              <i class="fa-solid fa-calendar"></i>
              <span>Planning</span>
            </button>

            <div class="astra-search-box astra-search-box--toolbar">
              <i class="fa fa-search"></i>
              <input
                type="text"
                id="astra-search"
                placeholder="Search by title..."
                value="${filters.search}"
              />
            </div>

            <span class="astra-toolbar-separator" aria-hidden="true"></span>
          </div>

          <div class="astra-filter-toolbar-right">
            <div
              class="astra-toolbar-dropdown ${when(selectedLists.length > 0, 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-list"></i>
                <span>${customListLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu astra-toolbar-dropdown-menu--wide">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(selectedLists.length === 0, 'active')}"
                  data-filter-field="customList"
                  data-filter-value="all"
                >
                  Custom Lists
                </button>
                ${this.customListsLoading && customLists.length === 0
                  ? html`<div class="astra-toolbar-dropdown-empty">Loading lists...</div>`
                  : customLists.length > 0
                    ? customLists.map(
                        (list) => html`
                          <button
                            type="button"
                            class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                              selectedLists.includes(list),
                              'active'
                            )}"
                            data-filter-field="customList"
                            data-filter-value="${list}"
                          >
                            <span
                              class="astra-toolbar-checkbox ${when(
                                selectedLists.includes(list),
                                'checked'
                              )}"
                            ></span>
                            <span>${list}</span>
                          </button>
                        `
                      )
                    : html`<div class="astra-toolbar-dropdown-empty">No lists found</div>`}
                <div class="astra-toolbar-dropdown-divider"></div>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                    selectedLists.includes('__hidden__'),
                    'active'
                  )}"
                  data-filter-field="customList"
                  data-filter-value="__hidden__"
                >
                  <span
                    class="astra-toolbar-checkbox ${when(
                      selectedLists.includes('__hidden__'),
                      'checked'
                    )}"
                  ></span>
                  <span>Hide from status lists</span>
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                    selectedLists.includes('__private__'),
                    'active'
                  )}"
                  data-filter-field="customList"
                  data-filter-value="__private__"
                >
                  <span
                    class="astra-toolbar-checkbox ${when(
                      selectedLists.includes('__private__'),
                      'checked'
                    )}"
                  ></span>
                  <span>Private</span>
                </button>
              </div>
            </div>

            <div
              class="astra-toolbar-dropdown ${when(filters.type !== 'all', 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-shapes"></i>
                <span>${typeLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'all', 'active')}"
                  data-filter-field="type"
                  data-filter-value="all"
                >
                  All Types
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'anime', 'active')}"
                  data-filter-field="type"
                  data-filter-value="anime"
                >
                  Anime
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'manga', 'active')}"
                  data-filter-field="type"
                  data-filter-value="manga"
                >
                  Manga
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'novel', 'active')}"
                  data-filter-field="type"
                  data-filter-value="novel"
                >
                  Novel
                </button>
              </div>
            </div>

            <div
              class="astra-toolbar-dropdown ${when(filters.country !== 'all', 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-globe"></i>
                <span>${countryLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'all', 'active')}"
                  data-filter-field="country"
                  data-filter-value="all"
                >
                  All Countries
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'JP', 'active')}"
                  data-filter-field="country"
                  data-filter-value="JP"
                >
                  Japan
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'KR', 'active')}"
                  data-filter-field="country"
                  data-filter-value="KR"
                >
                  Korea
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'CN', 'active')}"
                  data-filter-field="country"
                  data-filter-value="CN"
                >
                  China
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'TW', 'active')}"
                  data-filter-field="country"
                  data-filter-value="TW"
                >
                  Taiwan
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Binds user interaction events to store actions.
   */
  protected bindEvents(): void {
    void this.ensureCustomListsLoaded();

    const searchInput = this.$<HTMLInputElement>('#astra-search');
    if (searchInput) {
      this.addEventListener(searchInput, 'input', (e) => {
        this.store.setSearch((e.target as HTMLInputElement).value);
      });
    }

    this.$$('[data-dropdown-trigger]').forEach((trigger) => {
      this.addEventListener(trigger, 'click', (e) => {
        e.stopPropagation();
        const dropdown = (e.currentTarget as HTMLElement).closest('[data-toolbar-dropdown]');
        this.$$('[data-toolbar-dropdown]').forEach((item) => {
          if (item !== dropdown) item.classList.remove('open');
        });
        dropdown?.classList.toggle('open');
      });
    });

    this.$$('.astra-toolbar-dropdown-item').forEach((item) => {
      this.addEventListener(item, 'click', (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const field = target.dataset.filterField as 'type' | 'country' | 'customList';
        const value = target.dataset.filterValue;
        if (!field || !value) return;

        if (field === 'customList') {
          // Multi-select: 'all' clears; any other value toggles in/out.
          if (value === 'all') {
            this.store.setFilters({ customLists: [] });
          } else {
            const current = this.store.getState().filters.customLists || [];
            const next = current.includes(value)
              ? current.filter((v) => v !== value)
              : [...current, value];
            this.store.setFilters({ customLists: next });
          }
          // The store update re-renders this bar and closes the menu; re-open the
          // custom-lists dropdown so multiple lists can be picked in one go.
          this.$$('[data-toolbar-dropdown]')[0]?.classList.add('open');
          return;
        }

        this.store.setFilters({ [field]: value });
        target.closest('[data-toolbar-dropdown]')?.classList.remove('open');
      });
    });

    // Close any open dropdown when clicking outside of it.
    this.addEventListener(document, 'click', (e) => {
      const insideDropdown = (e.target as HTMLElement).closest('[data-toolbar-dropdown]');
      this.$$('[data-toolbar-dropdown]').forEach((dropdown) => {
        if (dropdown !== insideDropdown) dropdown.classList.remove('open');
      });
    });

    this.$$('.astra-toolbar-chip[data-quick-filter]').forEach((button) => {
      this.addEventListener(button, 'click', (e) => {
        const filter = (e.currentTarget as HTMLButtonElement).dataset.quickFilter;
        this.applyQuickFilter(filter || 'all');
      });
    });

    this.$$('.astra-toolbar-chip[data-status-filter]').forEach((button) => {
      this.addEventListener(button, 'click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const status = target.dataset.statusFilter as MediaListStatus;
        this.toggleStatus(status);
      });
    });
  }

  private getActiveStatuses(
    status: IDashboardState['filters']['anilistStatus']
  ): MediaListStatus[] {
    return status === 'all' ? [] : Array.isArray(status) ? status : [status];
  }

  private toggleStatus(status: MediaListStatus): void {
    const current = this.getActiveStatuses(this.store.getState().filters.anilistStatus);
    const next = current.includes(status)
      ? current.filter((activeStatus) => activeStatus !== status)
      : [...current, status];

    this.store.setFilters({ anilistStatus: next.length > 0 ? next : 'all' });
  }

  private applyQuickFilter(filter: string): void {
    const state = this.store.getState();
    const current = state.filters;
    const activeStatuses = this.getActiveStatuses(current.anilistStatus);

    switch (filter) {
      case 'watching':
        const nextWatchingStatuses = this.cycleCurrentRepeating(activeStatuses);
        this.store.setFilters({
          type:
            current.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING)
              ? 'all'
              : 'anime',
          anilistStatus: nextWatchingStatuses.length > 0 ? nextWatchingStatuses : 'all',
        });
        return;
      case 'reading':
        const nextReadingStatuses = this.cycleCurrentRepeating(activeStatuses);
        this.store.setFilters({
          type:
            (current.type === 'manga' || current.type === 'novel') &&
            activeStatuses.includes(MediaListStatus.REPEATING)
              ? 'all'
              : current.type === 'novel'
                ? 'novel'
                : 'manga',
          anilistStatus: nextReadingStatuses.length > 0 ? nextReadingStatuses : 'all',
        });
        return;
      default:
        this.store.setFilters({
          type: 'all',
          ratingStatus: 'all',
          anilistStatus: 'all',
          country: 'all',
          customLists: [],
        });
    }
  }

  private getManifestCustomLists(): string[] {
    const names = new Set<string>();
    this.service.getWorks().forEach((work) => {
      work.customLists?.forEach((list) => {
        if (list) names.add(list);
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  private async ensureCustomListsLoaded(): Promise<void> {
    if (this.customListsLoaded || this.customListsLoading) return;

    this.customListsLoading = true;
    try {
      this.customLists = await this.service.getAniListCustomLists();
      this.customListsLoaded = true;
      this.update(this.props);
      void this.service.hydrateCustomListsFromStoredWorks().then(() => {
        this.update(this.props);
      });
    } catch {
      this.customLists = this.getManifestCustomLists();
      this.customListsLoaded = true;
    } finally {
      this.customListsLoading = false;
    }
  }

  private cycleCurrentRepeating(statuses: MediaListStatus[]): MediaListStatus[] {
    const withoutCurrentRepeating = statuses.filter(
      (status) => status !== MediaListStatus.CURRENT && status !== MediaListStatus.REPEATING
    );

    if (statuses.includes(MediaListStatus.REPEATING)) {
      return withoutCurrentRepeating;
    }

    return [
      ...withoutCurrentRepeating,
      statuses.includes(MediaListStatus.CURRENT)
        ? MediaListStatus.REPEATING
        : MediaListStatus.CURRENT,
    ];
  }
}
