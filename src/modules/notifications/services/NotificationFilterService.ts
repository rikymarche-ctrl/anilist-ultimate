/**
 * @file NotificationFilterService.ts
 * @description Search bar UI and text-based filtering for notification entries
 *
 * Injects a search input into the notification page header and filters
 * visible notifications by matching text content against the query string.
 *
 * @see NotificationCleanerModule.ts for the orchestration layer
 * @see docs/MODULES.md#2-notification-cleaner-module
 */

import { injectable } from 'tsyringe';
import { log } from '@core/logger';
import { html } from '@core/utils/Template';

@injectable()
export class NotificationFilterService {
  private searchQuery: string = '';
  private searchBar: HTMLElement | null = null;

  /**
   * Inject the search bar into the notifications page
   */
  public injectSearchBar(onSearch: (query: string) => void): HTMLElement | null {
    if (this.searchBar) return this.searchBar;

    const container = document.querySelector('.notifications');
    if (!container) return null;

    const searchWrapper = html`
      <div class="au-notification-search-wrapper" style="margin-bottom: 20px; width: 100% !important; grid-column: 1 / -1 !important; display: block !important; box-sizing: border-box;">
        <div class="au-search-container" style="display: flex; align-items: center; background: var(--au-bg); border-radius: 4px; padding: 0 16px; height: 45px; width: 100% !important; box-sizing: border-box; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
          <i class="fa fa-search au-search-icon" style="margin-right: 12px; color: var(--au-text-secondary);"></i>
          <input type="text" class="au-search-input" placeholder="Search notifications by user, content, or media..." style="flex: 1; border: none; background: transparent; outline: none; height: 100%; color: var(--au-text);" />
        </div>
      </div>
    `;

    container.insertAdjacentElement('afterbegin', searchWrapper);
    this.searchBar = searchWrapper;

    const input = searchWrapper.querySelector('input');
    input?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      onSearch(this.searchQuery);
    });

    return searchWrapper;
  }

  /**
   * Apply search filter to all notifications
   */
  public applySearchFilter(query: string): void {
    const notifications = document.querySelectorAll<HTMLElement>('.notification:not(.au-hidden-notification)');
    
    notifications.forEach(notif => {
      const text = notif.textContent?.toLowerCase() || '';
      const isVisible = text.includes(query);
      
      // Handle virtual notifications and their dropdowns
      if (notif.classList.contains('au-virtual-notification')) {
        notif.style.display = isVisible ? '' : 'none';
        const dropdown = notif.nextElementSibling as HTMLElement;
        if (dropdown && dropdown.classList.contains('au-notification-dropdown')) {
          dropdown.style.display = 'none'; // Always close dropdown on search
        }
      } else if (!notif.classList.contains('au-sub-notification')) {
        notif.style.display = isVisible ? '' : 'none';
      }
    });

    log.debug(`[NotificationFilter] Applied filter: "${query}"`);
  }

  public getSearchQuery(): string { return this.searchQuery; }

  public cleanup(): void {
    this.searchBar?.remove();
    this.searchBar = null;
    this.searchQuery = '';
  }
}
