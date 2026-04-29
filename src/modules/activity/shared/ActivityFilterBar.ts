/**
 * @file ActivityFilterBar.ts
 * @description Reusable filter bar component for activity feeds
 *
 * Shared between ActivityEnhancerModule (home page) and MediaSocialEnhancer
 * (individual media pages). Provides configurable filter buttons and optional
 * search input.
 *
 * Features:
 *   - Single-select filter buttons (click one, others deselect)
 *   - Configurable filter set via getStandardFilters()
 *   - Optional search input with real-time filtering
 *   - Callbacks for filter and search changes
 *   - Programmatic filter control via setFilter()
 *   - Reset to defaults
 *
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { injectable } from 'tsyringe';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { ActivityFilterType } from '../ActivityUtils';

export interface FilterBarOptions {
  /**
   * Available filter buttons
   */
  filters: Array<{ type: ActivityFilterType; label: string }>;

  /**
   * Whether to show search input
   */
  showSearch?: boolean;

  /**
   * Callback when filters change
   */
  onFilterChange?: (activeFilters: Set<ActivityFilterType>) => void;

  /**
   * Callback when search query changes
   */
  onSearchChange?: (query: string) => void;
}

/**
 * Activity Filter Bar Component
 * Manages filter UI and user interactions
 */
@injectable()
export class ActivityFilterBar {
  private activeFilters: Set<ActivityFilterType> = new Set(['ALL']);
  private searchQuery: string = '';
  private container: HTMLElement | null = null;
  private options: FilterBarOptions;

  constructor() {
    this.options = {
      filters: [
        { type: 'ALL', label: 'All' },
        { type: MediaListStatus.WATCHING, label: 'Watched' },
        { type: MediaListStatus.READING, label: 'Read' },
        { type: MediaListStatus.COMPLETED, label: 'Completed' },
        { type: MediaListStatus.PLANNING, label: 'Plans' },
        { type: MediaListStatus.DROPPED, label: 'Dropped' },
        { type: MediaListStatus.PAUSED, label: 'Paused' },
        { type: 'TEXT', label: 'Text posts' },
      ],
      showSearch: true,
    };
  }

  /**
   * Get standard filter set based on context
   */
  public static getStandardFilters(type: 'anime' | 'manga' | 'all' = 'all', includeTextPosts: boolean = true): Array<{ type: ActivityFilterType; label: string }> {
    const filters: Array<{ type: ActivityFilterType; label: string }> = [
      { type: 'ALL', label: 'All' }
    ];

    if (type === 'anime' || type === 'all') {
      filters.push({ type: MediaListStatus.WATCHING, label: 'Watched' });
    }
    if (type === 'manga' || type === 'all') {
      filters.push({ type: MediaListStatus.READING, label: 'Read' });
    }

    filters.push(
      { type: MediaListStatus.COMPLETED, label: 'Completed' },
      { type: MediaListStatus.PAUSED, label: 'Paused' },
      { type: MediaListStatus.DROPPED, label: 'Dropped' },
      { type: MediaListStatus.PLANNING, label: 'Plans' }
    );

    if (includeTextPosts) {
      filters.push({ type: 'TEXT', label: 'Text posts' });
    }

    return filters;
  }

  /**
   * Configure filter bar options
   */
  configure(options: Partial<FilterBarOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Create and return the filter bar element
   */
  create(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'au-activity-bar';

    // Build filter buttons HTML
    const filterButtonsHTML = this.options.filters
      .map(
        ({ type, label }) =>
          `<button class="au-filter-btn" data-filter="${type}">${label}</button>`
      )
      .join('');

    // Build search input HTML
    const searchHTML = this.options.showSearch
      ? `
      <div class="au-search-container">
        <span class="au-search-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </span>
        <input type="text" class="au-search-input" id="au-activity-search" placeholder="Search..." />
      </div>
    `
      : '';

    bar.innerHTML = `
      <div class="au-activity-bar__left">
        ${filterButtonsHTML}
      </div>
      ${searchHTML}
    `;

    this.container = bar;
    this.attachEvents();
    this.updateUI();

    return bar;
  }

  /**
   * Attach event listeners
   */
  private attachEvents(): void {
    if (!this.container) return;

    // Filter button clicks
    const filterBtns = this.container.querySelectorAll('.au-filter-btn');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as ActivityFilterType;
        this.toggleFilter(filter);
      });
    });

    // Search input
    if (this.options.showSearch) {
      const searchInput = this.container.querySelector(
        '#au-activity-search'
      ) as HTMLInputElement;
      searchInput?.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.options.onSearchChange?.(this.searchQuery);
      });
    }
  }

  /**
   * Toggle filter (single-select logic)
   */
  private toggleFilter(filter: ActivityFilterType): void {
    this.activeFilters.clear();
    this.activeFilters.add(filter);
    this.updateUI();
    this.options.onFilterChange?.(new Set(this.activeFilters));
  }

  /**
   * Update UI to reflect active filters
   */
  private updateUI(): void {
    if (!this.container) return;

    this.container.querySelectorAll('.au-filter-btn').forEach((btn) => {
      const f = btn.getAttribute('data-filter') as ActivityFilterType;
      btn.classList.toggle('active', this.activeFilters.has(f));
    });
  }

  /**
   * Get current active filters
   */
  getActiveFilters(): Set<ActivityFilterType> {
    return new Set(this.activeFilters);
  }

  /**
   * Get current search query
   */
  getSearchQuery(): string {
    return this.searchQuery;
  }

  /**
   * Set active filter programmatically
   */
  setFilter(filter: ActivityFilterType): void {
    this.toggleFilter(filter);
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.activeFilters.clear();
    this.activeFilters.add('ALL');
    this.searchQuery = '';
    this.updateUI();

    // Clear search input if exists
    const searchInput = this.container?.querySelector(
      '#au-activity-search'
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
    }
  }

  /**
   * Get current filter state
   * BUG-004 fix: Save state before cleanup to restore after navigation
   */
  getState(): { activeFilters: ActivityFilterType[]; searchQuery: string } {
    return {
      activeFilters: Array.from(this.activeFilters),
      searchQuery: this.searchQuery,
    };
  }

  /**
   * Restore filter state
   * BUG-004 fix: Restore state after re-injection on navigation
   */
  setState(state: { activeFilters: ActivityFilterType[]; searchQuery: string }): void {
    this.activeFilters = new Set(state.activeFilters);
    this.searchQuery = state.searchQuery;

    // Update UI if container exists
    if (this.container) {
      this.updateUI();

      // Update search input value
      const searchInput = this.container.querySelector(
        '#au-activity-search'
      ) as HTMLInputElement;
      if (searchInput) {
        searchInput.value = this.searchQuery;
      }
    }
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.container?.remove();
    this.container = null;
    this.activeFilters.clear();
    this.searchQuery = '';
  }
}
