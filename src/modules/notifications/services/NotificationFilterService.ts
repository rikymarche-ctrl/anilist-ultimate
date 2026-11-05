/**
 * @file NotificationFilterService.ts
 * @description Search bar UI and text-based filtering for notification entries
 *
 * Injects a search input into the notification page header and filters
 * visible notifications by matching text content against the query string.
 *
 * @see NotificationCleanerModule.ts for the orchestration layer
 * @see docs/MODULES.md
 */

import { injectable } from 'tsyringe';
import { logger } from '@core/logger';
import { html } from '@core/utils/Template';

@injectable()
export class NotificationFilterService {
  private searchQuery: string = '';
  private searchBar: HTMLElement | null = null;

  /**
   * Inject the search bar into the notifications page
   */
  public injectSearchBar(onSearch: (query: string) => void): HTMLElement | null {
    if (this.searchBar?.isConnected) return this.searchBar;
    this.searchBar = null;

    const container = document.querySelector('.notifications');
    if (!container) return null;

    const searchWrapper = html`
      <div class="au-notification-search-wrapper" style="margin-bottom: 20px; width: 100% !important; grid-column: 1 / -1 !important; display: block !important; box-sizing: border-box;">
        <div class="au-search-container" style="display: flex; align-items: center; background: var(--au-bg); border-radius: 4px; padding: 0 16px; height: 45px; width: 100% !important; box-sizing: border-box; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
          <i class="fa-solid fa-magnifying-glass au-search-icon" style="margin-right: 12px; color: var(--au-text-secondary);"></i>
          <input type="text" class="au-search-input" placeholder="Search notifications by user, content, or media..." style="flex: 1; border: none; background: transparent; outline: none; height: 100%; color: var(--au-text);" />
        </div>
      </div>
    `;

    container.insertAdjacentElement('afterbegin', searchWrapper);
    this.searchBar = searchWrapper;

    const input = searchWrapper.querySelector('input');
    if (input) input.value = this.searchQuery;
    input?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      onSearch(this.searchQuery);
    });

    return searchWrapper;
  }

  /**
   * Applies the search query. Grouped rows are matched through their summary's data-au-group;
   * a group with a hit is expanded for the search, and the stored state returns when the query clears.
   */
  public applySearchFilter(query: string): void {
    const normalized = query.toLowerCase().trim();
    document
      .querySelectorAll<HTMLElement>('.notifications .au-virtual-notification[data-au-group]')
      .forEach((summary) => this.applyGroupFilter(summary, normalized));
    const standalone = document.querySelectorAll<HTMLElement>(
      '.notifications .notification:not(.au-sub-notification):not(.au-virtual-notification), .notifications .notification-item:not(.au-sub-notification):not(.au-virtual-notification)'
    );
    standalone.forEach((node) => {
      const text = node.textContent?.toLowerCase() ?? '';
      node.classList.toggle('au-notification-search-hidden', !!normalized && !text.includes(normalized));
    });
    logger.debug('[NotificationFilter] Applied search filter');
  }

  private applyGroupFilter(summary: HTMLElement, normalized: string): void {
    const groupId = summary.dataset.auGroup ?? '';
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        '.notifications .au-sub-notification[data-au-group="' + groupId + '"]'
      ),
    ];
    const summaryMatch = !normalized || (summary.textContent?.toLowerCase() ?? '').includes(normalized);
    const matches = rows.map((row) => (row.textContent?.toLowerCase() ?? '').includes(normalized));
    const visible = !normalized || summaryMatch || matches.some(Boolean);
    summary.classList.toggle('au-notification-search-hidden', !visible);
    // Without a query, rows follow the group's stored expansion. With a query, hits are shown.
    const expanded = summary.getAttribute('aria-expanded') === 'true';
    rows.forEach((row, index) => {
      row.classList.toggle('au-notification-search-hidden', !!normalized && !summaryMatch && !matches[index]);
      row.classList.toggle('au-notification-collapsed', !normalized && !expanded);
    });
  }

  public getSearchQuery(): string { return this.searchQuery; }

  public cleanup(): void {
    this.searchBar?.remove();
    this.searchBar = null;
    this.searchQuery = '';
    document.querySelectorAll('.au-notification-search-hidden').forEach(element => element.classList.remove('au-notification-search-hidden'));
  }
}
