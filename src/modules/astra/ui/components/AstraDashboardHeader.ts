/**
 * @file AstraDashboardHeader.ts
 * @description Header component for the dashboard, containing search and global filters.
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { IDashboardController } from '../../interfaces/IDashboardController';
import { IDashboardFilters } from '../../interfaces/IDashboardState';

/**
 * Enterprise-grade header component for the Astra Dashboard.
 */
export class AstraDashboardHeader extends BaseComponent {
  constructor(private controller: IDashboardController) {
    super({});
  }

  protected render(): HTMLElement {
    const state = this.controller.getState();
    const element = this.createFromHTML(this.template(state.filters));
    this.attachEventsInternal(element);
    return element;
  }

  protected attachEvents(): void {
    // Required by BaseComponent
  }

  private template(filters: IDashboardFilters): string {
    return `
      <header class="astra-dashboard-header">
        <div class="astra-search-box">
          <i class="fa fa-search"></i>
          <input type="text" 
                 id="astra-dashboard-search" 
                 placeholder="Search works, tags or notes..." 
                 value="${filters.search}"
                 autocomplete="off">
        </div>
        
        <div class="astra-macro-filters">
          <div class="astra-filter-group">
            <label class="astra-label-xs">Type</label>
            <select class="astra-select-v2" id="astra-filter-type">
              <option value="all" ${filters.type === 'all' ? 'selected' : ''}>All Types</option>
              <option value="anime" ${filters.type === 'anime' ? 'selected' : ''}>Anime</option>
              <option value="manga" ${filters.type === 'manga' ? 'selected' : ''}>Manga</option>
            </select>
          </div>

          <div class="astra-filter-group">
            <label class="astra-label-xs">Sync Status</label>
            <select class="astra-select-v2" id="astra-filter-sync">
              <option value="all" ${filters.anilistStatus === 'all' ? 'selected' : ''}>All Status</option>
              <option value="synced" ${filters.anilistStatus === 'synced' ? 'selected' : ''}>Synced</option>
              <option value="local-only" ${filters.anilistStatus === 'local-only' ? 'selected' : ''}>Local Only</option>
            </select>
          </div>
        </div>

        <div class="astra-header-actions">
          <button class="astra-btn astra-btn--primary" id="astra-sync-trigger">
            <i class="fa fa-refresh"></i> Sync AniList
          </button>
        </div>
      </header>
    `;
  }

  private attachEventsInternal(element: HTMLElement): void {
    const searchInput = element.querySelector('#astra-dashboard-search') as HTMLInputElement;
    const typeSelect = element.querySelector('#astra-filter-type') as HTMLSelectElement;
    const syncSelect = element.querySelector('#astra-filter-sync') as HTMLSelectElement;
    const syncBtn = element.querySelector('#astra-sync-trigger');

    searchInput?.addEventListener('input', (e) => {
      this.controller.setFilters({ search: (e.target as HTMLInputElement).value });
    });

    typeSelect?.addEventListener('change', (e) => {
      this.controller.setFilters({ type: (e.target as HTMLSelectElement).value as any });
    });

    syncSelect?.addEventListener('change', (e) => {
      this.controller.setFilters({ anilistStatus: (e.target as HTMLSelectElement).value as any });
    });

    syncBtn?.addEventListener('click', () => {
      this.controller.syncWithAnilist();
    });
  }

  /**
   * External update method for reactive refreshes.
   */
  public updateView(): void {
    const parent = this.element.parentElement;
    if (parent) {
      const newElement = this.render();
      parent.replaceChild(newElement, this.element);
      this.element = newElement;
    }
  }
}
