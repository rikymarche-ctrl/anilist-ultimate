/**
 * Media Social Enhancer Module
 * Adds Custom Lists dropdown to media social pages (/anime/.../social, /manga/.../social)
 * Filters displayed user entries by selected custom list
 */

import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { CustomListService } from './CustomListService';

export class MediaSocialEnhancer extends BaseModule {
  private customListService = CustomListService.getInstance();
  private currentCustomList: string | null = null;
  private customListDropdown: HTMLElement | null = null;
  private readonly OBSERVER_NAME = 'media-social-enhancer';

  public async init(): Promise<void> {
    log.info('MediaSocialEnhancer: Initializing...');

    this.watchPageNavigation(() => {
      this.cleanupDropdown();
      if (this.isOnMediaSocialPage()) {
        this.startObservation();
      }
    });

    if (this.isOnMediaSocialPage()) {
      this.startObservation();
    }
  }

  private isOnMediaSocialPage(): boolean {
    const path = window.location.pathname;
    return /^\/(anime|manga)\/\d+\/social/.test(path);
  }

  private cleanupDropdown(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    this.customListDropdown?.remove();
    this.customListDropdown = null;
    this.currentCustomList = null;
    this.resumeObserver(this.OBSERVER_NAME);
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });
  }

  private checkAndProcess(): void {
    // Inject Custom Lists dropdown if not present
    if (!this.customListDropdown) {
      this.injectCustomListsDropdown();
    }

    // Apply filters if custom list is selected
    if (this.currentCustomList) {
      this.suspendObserver(this.OBSERVER_NAME);
      this.applyFilters();
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Inject Custom Lists dropdown next to Self/Following/Global tabs
   */
  private async injectCustomListsDropdown(): Promise<void> {
    // Find the tab navigation container
    // Usually it's a .filter-group or navigation section before the .following section
    const filterGroup = document.querySelector('.filter-group, .media-social-filter, .section-header .filter-wrap');
    if (!filterGroup) return;

    // Check if already injected
    if (document.querySelector('.au-media-social-custom-list')) return;

    // Initialize service
    await this.customListService.init();
    const lists = this.customListService.getLists();
    const listNames = Object.keys(lists);

    log.debug('[MediaSocialEnhancer] Found lists:', listNames);

    // Build menu items
    let menuItems = '<div class="au-media-social-cl-item" data-list=""><i class="fa fa-times-circle"></i> Clear Filter</div>';
    if (listNames.length > 0) {
      menuItems += listNames.map(name => `
        <div class="au-media-social-cl-item" data-list="${name}">
          <i class="fa fa-list-ul"></i> ${name}
        </div>
      `).join('');
    } else {
      menuItems += '<div class="au-media-social-cl-item au-media-social-cl-empty">No custom lists</div>';
    }

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'au-media-social-custom-list';
    dropdown.innerHTML = `
      <div class="au-media-social-cl-btn">
        <i class="fa fa-list-ul"></i>
        <span class="au-media-social-cl-label">Custom Lists</span>
        <i class="fa fa-caret-down"></i>
      </div>
      <div class="au-media-social-cl-menu" style="display: none;">
        ${menuItems}
      </div>
    `;

    log.info('[MediaSocialEnhancer] Created dropdown with', listNames.length, 'lists');

    // Insert after the filter group
    filterGroup.appendChild(dropdown);
    this.customListDropdown = dropdown;

    // Attach events
    const btn = dropdown.querySelector('.au-media-social-cl-btn');
    const menu = dropdown.querySelector('.au-media-social-cl-menu') as HTMLElement;

    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // Close on outside click
    document.addEventListener('click', () => {
      if (menu) menu.style.display = 'none';
    });

    // Handle list selection
    dropdown.querySelectorAll('.au-media-social-cl-item:not(.au-media-social-cl-empty)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const listName = item.getAttribute('data-list');
        this.setCustomListFilter(listName || null);
        menu.style.display = 'none';
      });
    });

    // Sync with native tabs: clear custom list filter if user clicks another tab
    const nativeTabs = filterGroup.querySelectorAll('.link:not(.au-media-social-cl-btn)');
    nativeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (this.currentCustomList !== null) {
          log.info('[MediaSocialEnhancer] Native tab clicked. Clearing Custom List context.');
          this.setCustomListFilter(null);
        }
      });
    });
  }

  /**
   * Set custom list filter and update UI
   */
  private setCustomListFilter(listName: string | null): void {
    this.currentCustomList = listName;

    // Update button label and active state
    const label = this.customListDropdown?.querySelector('.au-media-social-cl-label');
    const btn = this.customListDropdown?.querySelector('.au-media-social-cl-btn');
    
    if (label) {
      label.textContent = listName || 'Custom Lists';
      
      if (listName) {
        btn?.classList.add('router-link-active');
      } else {
        btn?.classList.remove('router-link-active');
      }
    }

    // Update active state in menu
    this.customListDropdown?.querySelectorAll('.au-media-social-cl-item').forEach(item => {
      const itemList = item.getAttribute('data-list');
      item.classList.toggle('active', itemList === (listName || ''));
    });

    // Apply filters
    this.checkAndProcess();
  }

  /**
   * Apply filters to user entries based on selected custom list
   */
  private applyFilters(): void {
    if (!this.currentCustomList) {
      // Show all entries if no custom list selected
      document.querySelectorAll<HTMLElement>('.media-list-entry, .list-preview, .following > *').forEach(entry => {
        entry.style.display = '';
      });
      return;
    }

    // Get users in selected custom list
    const listUsers = this.customListService.getList(this.currentCustomList);
    const userNames = new Set(listUsers.map(u => u.name.toLowerCase()));

    // Find all user entries and filter
    const followingSection = document.querySelector('.following, .media-social-following');
    if (!followingSection) return;

    const entries = Array.from(followingSection.querySelectorAll<HTMLElement>('.media-list-entry, .list-preview, a[href^="/user/"]'));

    entries.forEach(entry => {
      // Extract username from the entry
      const userLink = entry.querySelector('a[href^="/user/"]') as HTMLAnchorElement;
      if (!userLink) {
        entry.style.display = 'none';
        return;
      }

      const username = userLink.textContent?.trim().toLowerCase();
      if (username && userNames.has(username)) {
        entry.style.display = '';
      } else {
        entry.style.display = 'none';
      }
    });
  }

  public override destroy(): void {
    this.cleanupDropdown();
    super.destroy();
  }
}
