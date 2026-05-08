/**
 * @file AstraFilterBar.ts
 * @description Component for searching and filtering works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState, AstraSortType } from '../../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';
import { TOKENS } from '@core/di/tokens';
import { html, when } from '@core/utils/Template';

@injectable()
export class AstraFilterBar extends AstraView {
  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore
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
    const { filters, sort } = state;

    return html`
      <div class="astra-dashboard-controls">
        <div class="astra-search-box-row">
          <div class="astra-search-box">
            <i class="fa fa-search"></i>
            <input type="text" id="astra-search" placeholder="Search by title..." value="${filters.search}">
          </div>
        </div>
        
        <div class="astra-filter-bar">
          <div class="astra-filter-group">
            <select class="astra-filter-select" id="astra-filter-type">
              <option value="all" ${when(filters.type === 'all', 'selected')}>All Types</option>
              <option value="anime" ${when(filters.type === 'anime', 'selected')}>Anime</option>
              <option value="manga" ${when(filters.type === 'manga', 'selected')}>Manga</option>
              <option value="novel" ${when(filters.type === 'novel', 'selected')}>Novel</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-ratingStatus">
              <option value="all" ${when(filters.ratingStatus === 'all', 'selected')}>All Scores</option>
              <option value="rated" ${when(filters.ratingStatus === 'rated', 'selected')}>Rated</option>
              <option value="unrated" ${when(filters.ratingStatus === 'unrated', 'selected')}>Unrated</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-anilist">
              <option value="all" ${when(filters.anilistStatus === 'all', 'selected')}>AniList: Any</option>
              <option value="${MediaListStatus.CURRENT}" ${when(filters.anilistStatus === MediaListStatus.CURRENT, 'selected')}>Watching/Reading</option>
              <option value="${MediaListStatus.COMPLETED}" ${when(filters.anilistStatus === MediaListStatus.COMPLETED, 'selected')}>Completed</option>
              <option value="${MediaListStatus.PLANNING}" ${when(filters.anilistStatus === MediaListStatus.PLANNING, 'selected')}>Planning</option>
              <option value="${MediaListStatus.PAUSED}" ${when(filters.anilistStatus === MediaListStatus.PAUSED, 'selected')}>Paused</option>
              <option value="${MediaListStatus.DROPPED}" ${when(filters.anilistStatus === MediaListStatus.DROPPED, 'selected')}>Dropped</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-country">
              <option value="all" ${when(filters.country === 'all', 'selected')}>Any Country</option>
              <option value="JP" ${when(filters.country === 'JP', 'selected')}>Japan</option>
              <option value="KR" ${when(filters.country === 'KR', 'selected')}>Korea</option>
              <option value="CN" ${when(filters.country === 'CN', 'selected')}>China</option>
              <option value="TW" ${when(filters.country === 'TW', 'selected')}>Taiwan</option>
            </select>
          </div>

          <div class="astra-filter-spacer"></div>

          <div class="astra-filter-group">
            <span class="astra-filter-label">Sort by:</span>
            <select class="astra-filter-select" id="astra-filter-sort">
              <option value="updated-desc" ${when(sort === 'updated-desc', 'selected')}>Recently Updated</option>
              <option value="score-desc" ${when(sort === 'score-desc', 'selected')}>Highest Score</option>
              <option value="title-asc" ${when(sort === 'title-asc', 'selected')}>Title (A-Z)</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Binds user interaction events to store actions.
   */
  protected bindEvents(): void {
    const searchInput = this.$<HTMLInputElement>('#astra-search');
    if (searchInput) {
      this.addEventListener(searchInput, 'input', (e) => {
        this.store.setSearch((e.target as HTMLInputElement).value);
      });
    }

    this.$$('.astra-filter-select').forEach(select => {
      this.addEventListener(select, 'change', (e) => {
        const target = e.target as HTMLSelectElement;
        const field = target.id.replace('astra-filter-', '');
        
        if (field === 'sort') {
          this.store.setSort(target.value as AstraSortType);
        } else {
          this.store.setFilters({ [field]: target.value });
        }
      });
    });
  }
}
