/**
 * @file AstraFilterBar.ts
 * @description Component for searching and filtering works
 */

import { AstraView } from '../base/AstraView';
import { AstraStore, DashboardState } from '../../store/AstraStore';
import { MediaListStatus } from '@/api/AnilistTypes';

export class AstraFilterBar extends AstraView {
  constructor(private store: AstraStore) {
    super({});
  }

  protected template(state: DashboardState): string {
    return `
      <div class="astra-dashboard-controls">
        <div class="astra-search-box-row">
          <div class="astra-search-box">
            <i class="fa fa-search"></i>
            <input type="text" id="astra-search" placeholder="Search by title..." value="${state.search}">
          </div>
        </div>
        
        <div class="astra-filter-bar">
          <div class="astra-filter-group">
            <select class="astra-filter-select" id="astra-filter-type">
              <option value="all" ${state.type === 'all' ? 'selected' : ''}>All Types</option>
              <option value="anime" ${state.type === 'anime' ? 'selected' : ''}>Anime</option>
              <option value="manga" ${state.type === 'manga' ? 'selected' : ''}>Manga</option>
              <option value="novel" ${state.type === 'novel' ? 'selected' : ''}>Novel</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-status">
              <option value="all" ${state.status === 'all' ? 'selected' : ''}>All Scores</option>
              <option value="rated" ${state.status === 'rated' ? 'selected' : ''}>Rated</option>
              <option value="unrated" ${state.status === 'unrated' ? 'selected' : ''}>Unrated</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-anilist">
              <option value="all" ${state.anilistStatus === 'all' ? 'selected' : ''}>AniList: Any</option>
              <option value="${MediaListStatus.CURRENT}" ${state.anilistStatus === MediaListStatus.CURRENT ? 'selected' : ''}>Watching/Reading</option>
              <option value="${MediaListStatus.COMPLETED}" ${state.anilistStatus === MediaListStatus.COMPLETED ? 'selected' : ''}>Completed</option>
              <option value="${MediaListStatus.PLANNING}" ${state.anilistStatus === MediaListStatus.PLANNING ? 'selected' : ''}>Planning</option>
              <option value="${MediaListStatus.PAUSED}" ${state.anilistStatus === MediaListStatus.PAUSED ? 'selected' : ''}>Paused</option>
              <option value="${MediaListStatus.DROPPED}" ${state.anilistStatus === MediaListStatus.DROPPED ? 'selected' : ''}>Dropped</option>
            </select>

            <select class="astra-filter-select" id="astra-filter-country">
              <option value="all" ${state.country === 'all' ? 'selected' : ''}>Any Country</option>
              <option value="JP" ${state.country === 'JP' ? 'selected' : ''}>Japan</option>
              <option value="KR" ${state.country === 'KR' ? 'selected' : ''}>Korea</option>
              <option value="CN" ${state.country === 'CN' ? 'selected' : ''}>China</option>
              <option value="TW" ${state.country === 'TW' ? 'selected' : ''}>Taiwan</option>
            </select>
          </div>

          <div class="astra-filter-spacer"></div>

          <div class="astra-filter-group">
            <span class="astra-filter-label">Sort by:</span>
            <select class="astra-filter-select" id="astra-filter-sort">
              <option value="updated-desc" ${state.sort === 'updated-desc' ? 'selected' : ''}>Recently Updated</option>
              <option value="score-desc" ${state.sort === 'score-desc' ? 'selected' : ''}>Highest Score</option>
              <option value="title-asc" ${state.sort === 'title-asc' ? 'selected' : ''}>Title (A-Z)</option>
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
        this.store.setFilters({ [field]: target.value });
      });
    });
  }
}
