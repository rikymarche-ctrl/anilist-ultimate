/**
 * @file AstraFilterBar.ts
 * @description Component for searching and filtering works
 */

import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState, AstraSortType } from '../../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

export class AstraFilterBar extends AstraView {
  constructor(private store: AstraDashboardStore) {
    super({});
  }

  protected template(state: IDashboardState): string {
    const { filters, sort } = state;
    return `
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
              <option value="all" ${filters.type === 'all' ? 'selected' : ''}>All Types</option>
              <option value="anime" ${filters.type === 'anime' ? 'selected' : ''}>Anime</option>
              <option value="manga" ${filters.type === 'manga' ? 'selected' : ''}>Manga</option>
              <option value="novel" ${filters.type === 'novel' ? 'selected' : ''}>Novel</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-ratingStatus">
              <option value="all" ${filters.ratingStatus === 'all' ? 'selected' : ''}>All Scores</option>
              <option value="rated" ${filters.ratingStatus === 'rated' ? 'selected' : ''}>Rated</option>
              <option value="unrated" ${filters.ratingStatus === 'unrated' ? 'selected' : ''}>Unrated</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-anilist">
              <option value="all" ${filters.anilistStatus === 'all' ? 'selected' : ''}>AniList: Any</option>
              <option value="${MediaListStatus.CURRENT}" ${filters.anilistStatus === MediaListStatus.CURRENT ? 'selected' : ''}>Watching/Reading</option>
              <option value="${MediaListStatus.COMPLETED}" ${filters.anilistStatus === MediaListStatus.COMPLETED ? 'selected' : ''}>Completed</option>
              <option value="${MediaListStatus.PLANNING}" ${filters.anilistStatus === MediaListStatus.PLANNING ? 'selected' : ''}>Planning</option>
              <option value="${MediaListStatus.PAUSED}" ${filters.anilistStatus === MediaListStatus.PAUSED ? 'selected' : ''}>Paused</option>
              <option value="${MediaListStatus.DROPPED}" ${filters.anilistStatus === MediaListStatus.DROPPED ? 'selected' : ''}>Dropped</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-country">
              <option value="all" ${filters.country === 'all' ? 'selected' : ''}>Any Country</option>
              <option value="JP" ${filters.country === 'JP' ? 'selected' : ''}>Japan</option>
              <option value="KR" ${filters.country === 'KR' ? 'selected' : ''}>Korea</option>
              <option value="CN" ${filters.country === 'CN' ? 'selected' : ''}>China</option>
              <option value="TW" ${filters.country === 'TW' ? 'selected' : ''}>Taiwan</option>
            </select>
          </div>

          <div class="astra-filter-spacer"></div>

          <div class="astra-filter-group">
            <span class="astra-filter-label">Sort by:</span>
            <select class="astra-filter-select" id="astra-filter-sort">
              <option value="updated-desc" ${sort === 'updated-desc' ? 'selected' : ''}>Recently Updated</option>
              <option value="score-desc" ${sort === 'score-desc' ? 'selected' : ''}>Highest Score</option>
              <option value="title-asc" ${sort === 'title-asc' ? 'selected' : ''}>Title (A-Z)</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  protected bindEvents(): void {
    this.$<HTMLInputElement>('#astra-search')?.addEventListener('input', (e) => {
      this.store.setSearch((e.target as HTMLInputElement).value);
    });

    this.$$('.astra-filter-select').forEach(select => {
      select.addEventListener('change', (e) => {
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
