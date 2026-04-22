import { injectable } from 'tsyringe';
import { log } from '@core/logger';

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

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'au-notification-search-wrapper';
    searchWrapper.innerHTML = `
      <div class="au-search-container">
        <i class="fa fa-search au-search-icon"></i>
        <input type="text" class="au-search-input" placeholder="Search notifications by user, content, or media..." />
      </div>
    `;

    container.parentNode?.insertBefore(searchWrapper, container);
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
