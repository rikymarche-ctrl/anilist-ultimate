/**
 * @file SocialSidebar.ts
 * @description Fixed sidebar displaying detailed friend activity for a specific media
 *
 * Features:
 *   - Multiple filter types (self, following, custom lists, best friends)
 *   - Status sub-filters (watching, completed, dropped, etc.)
 *   - Real-time search across user names and notes
 *   - Infinite scroll pagination
 *   - Best friend toggle per-user
 *   - Score display with user's preferred format
 *
 * @warning User notes rendered via innerHTML without sanitization.
 *          See docs/SECURITY.md#sec-001.
 *
 * @see SocialService.ts for data fetching
 * @see SocialActivityModule.ts for mounting
 * @see docs/MODULES.md#9-social-activity-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { SocialActivityDetailed, SocialFilter } from '@core/types';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import { BestFriendService } from '../BestFriendService';
import { CustomListService } from '../CustomListService';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';

@injectable()
export class SocialSidebar extends BaseComponent {
  private currentMediaId: number | null = null;
  private currentFilter: SocialFilter = 'self';
  private currentCustomList: string | null = null; // New: track selected custom list
  private currentStatus: string = 'all';
  private searchQuery: string = '';
  private currentPage = 1;
  private hasNextPage = true;
  private isLoading = false;
  private currentAnchor: HTMLElement | null = null;
  private currentAnimeTitle: string = '';
  private lastLoadedNodes: SocialActivityDetailed[] = [];

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.BestFriendService) private bestFriendService: BestFriendService,
    @inject(TOKENS.CustomListService) private customListService: CustomListService
  ) {
    super({});
  }

  protected render(): HTMLElement {
    const sidebar = this.createElement('div', {
      class: 'au-social-sidebar',
      id: 'au-social-sidebar'
    });

    sidebar.innerHTML = `
      <div class="au-social-header">
        <h3 class="au-social-title">Social Activity</h3>
        <div class="au-social-close" title="Close">
          <i class="fa fa-times"></i>
        </div>
      </div>
      <div class="au-social-tabs">
        <div class="au-filter active" data-type="self">Self</div>
        <div class="au-filter" data-type="following">Following</div>
        <div class="au-filter au-filter-dropdown" data-type="custom-lists">
          <span class="au-filter-label">Custom Lists</span>
          <i class="fa fa-caret-down"></i>
          <div class="au-filter-dropdown-menu" style="display: none;">
            <!-- Will be populated dynamically -->
          </div>
        </div>
        <div class="au-filter" data-type="global">Global</div>
      </div>
      <div class="au-status-tabs">
        <div class="au-status-filter active" data-status="all">All</div>
        <div class="au-status-filter" data-status="current">Watching</div>
        <div class="au-status-filter" data-status="planning">Plans</div>
        <div class="au-status-filter" data-status="completed">Completed</div>
        <div class="au-status-filter" data-status="paused">Paused</div>
        <div class="au-status-filter" data-status="dropped">Dropped</div>
      </div>
      <div class="au-social-search-wrapper">
        <div class="au-social-search-inner">
          <i class="fa fa-search au-social-search-icon"></i>
          <input type="text" class="au-social-search-input" placeholder="Search friends or notes..." />
        </div>
      </div>
      <div class="au-social-content">
        <div class="au-social-empty">Select an anime to see activity</div>
      </div>
    `;

    return sidebar;
  }

  protected attachEvents(): void {
    // Initialize custom lists (async)
    this.populateCustomListsDropdown().catch(e => {
      log.error('[SocialSidebar] Failed to populate custom lists', e);
    });

    // Listen for open events
    window.addEventListener('au-open-social-sidebar', ((e: CustomEvent) => {
      const { mediaId, title, element } = e.detail;
      this.open(mediaId, title, element);
    }) as EventListener);

    // Close button
    const closeBtn = this.querySelector('.au-social-close');
    if (closeBtn) {
      this.addEventListener(closeBtn as HTMLElement, 'click', () => this.close());
    }

    // Filter clicks (non-dropdown)
    const filters = this.querySelectorAll('.au-filter:not(.au-filter-dropdown)');
    filters.forEach(filter => {
      this.addEventListener(filter as HTMLElement, 'click', () => {
        const type = filter.getAttribute('data-type') as SocialFilter;
        this.setFilter(type);
      });
    });

    // Custom Lists dropdown toggle
    const customListsFilter = this.querySelector('.au-filter-dropdown');
    if (customListsFilter) {
      this.addEventListener(customListsFilter as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        const menu = customListsFilter.querySelector('.au-filter-dropdown-menu') as HTMLElement;
        const isOpen = menu.style.display === 'block';

        // Close all other dropdowns
        this.querySelectorAll('.au-filter-dropdown-menu').forEach(m => {
          (m as HTMLElement).style.display = 'none';
        });

        menu.style.display = isOpen ? 'none' : 'block';
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.querySelectorAll('.au-filter-dropdown-menu').forEach(menu => {
        (menu as HTMLElement).style.display = 'none';
      });
    });

    // Status Filter clicks
    const statusFilters = this.querySelectorAll('.au-status-filter');
    statusFilters.forEach(filter => {
      this.addEventListener(filter as HTMLElement, 'click', () => {
        const status = filter.getAttribute('data-status')!;
        this.setStatus(status);
      });
    });

    // Search Input
    const searchInput = this.querySelector('.au-social-search-input') as HTMLInputElement;
    if (searchInput) {
      this.addEventListener(searchInput, 'input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.refreshEntries();
      });
    }

    // Infinite scroll
    const content = this.querySelector('.au-social-content');
    if (content) {
      this.addEventListener(content as HTMLElement, 'scroll', () => {
        const distanceToBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
        if (distanceToBottom < 100 && this.hasNextPage && !this.isLoading && this.currentMediaId) {
          this.loadData(this.currentMediaId, this.currentPage + 1);
        }
      });
    }

    // Close on escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.classList.contains('active')) {
        this.close();
      }
    });
  }

  private async populateCustomListsDropdown(): Promise<void> {
    log.debug('[SocialSidebar] Populating custom lists dropdown');
    await this.customListService.init();
    const lists = this.customListService.getLists();
    log.debug('[SocialSidebar] Lists loaded:', Object.keys(lists));

    const menu = this.querySelector('.au-filter-dropdown-menu');

    if (!menu) {
      log.warn('[SocialSidebar] Dropdown menu not found');
      return;
    }

    const listNames = Object.keys(lists);
    if (listNames.length === 0) {
      log.info('[SocialSidebar] No custom lists found');
      menu.innerHTML = '<div class="au-dropdown-item au-dropdown-empty">No lists created yet</div>';
      return;
    }

    log.info('[SocialSidebar] Populating with', listNames.length, 'lists');
    menu.innerHTML = listNames.map(name => `
      <div class="au-dropdown-item" data-list-name="${name}">
        <i class="fa fa-list-ul"></i> ${name}
      </div>
    `).join('');

    // Attach click events to dropdown items
    menu.querySelectorAll('.au-dropdown-item:not(.au-dropdown-empty)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const listName = item.getAttribute('data-list-name');
        if (listName) {
          this.setCustomListFilter(listName);
        }
      });
    });
  }

  private setCustomListFilter(listName: string): void {
    this.currentFilter = 'following'; // We fetch "following" but filter locally
    this.currentCustomList = listName;
    this.currentPage = 1;
    this.hasNextPage = true;

    // Update UI - set Custom Lists as active
    this.querySelectorAll('.au-filter').forEach(f => {
      f.classList.remove('active');
    });
    const customListsFilter = this.querySelector('.au-filter-dropdown');
    if (customListsFilter) {
      customListsFilter.classList.add('active');
      const label = customListsFilter.querySelector('.au-filter-label');
      if (label) label.textContent = listName;
    }

    // Close dropdown
    const menu = this.querySelector('.au-filter-dropdown-menu') as HTMLElement;
    if (menu) menu.style.display = 'none';

    if (this.currentMediaId) {
      this.loadData(this.currentMediaId, 1);
    }
  }

  public open(mediaId: number, title: string, anchor?: HTMLElement): void {
    if (this.currentMediaId === mediaId && this.element.classList.contains('active')) {
      return;
    }

    this.currentMediaId = mediaId;
    this.currentAnimeTitle = title;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.querySelector('.au-social-title')!.textContent = title;
    this.element.classList.add('active');

    // Handle highlighting
    if (this.currentAnchor) this.currentAnchor.classList.remove('au-anime-active');
    if (anchor) {
      this.currentAnchor = anchor;
      this.currentAnchor.classList.add('au-anime-active');
    }

    this.loadData(mediaId, 1);
  }

  public close(): void {
    this.element.classList.remove('active');
    this.currentMediaId = null;
    if (this.currentAnchor) {
      this.currentAnchor.classList.remove('au-anime-active');
      this.currentAnchor = null;
    }
  }

  private setFilter(type: SocialFilter): void {
    if (this.currentFilter === type && !this.currentCustomList) return;

    this.currentFilter = type;
    this.currentCustomList = null; // Reset custom list when switching to standard filter
    this.currentPage = 1;
    this.hasNextPage = true;

    this.querySelectorAll('.au-filter').forEach(f => {
      f.classList.toggle('active', f.getAttribute('data-type') === type);
    });

    // Reset Custom Lists dropdown label
    const customListsFilter = this.querySelector('.au-filter-dropdown');
    if (customListsFilter) {
      const label = customListsFilter.querySelector('.au-filter-label');
      if (label) label.textContent = 'Custom Lists';
    }

    if (this.currentMediaId) {
      this.loadData(this.currentMediaId, 1);
    }
  }

  private setStatus(status: string): void {
    if (this.currentStatus === status) return;

    this.currentStatus = status;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.querySelectorAll('.au-status-filter').forEach(f => {
      f.classList.toggle('active', f.getAttribute('data-status') === status);
    });

    if (this.currentMediaId) {
      this.loadData(this.currentMediaId, 1);
    }
  }

  private async loadData(mediaId: number, page: number): Promise<void> {
    if (this.isLoading) return;

    const content = this.querySelector('.au-social-content')!;
    if (page === 1) {
      content.innerHTML = `
        <div class="au-social-loading">
          <i class="fa fa-spinner fa-spin"></i>
          <span>Retrieving activities...</span>
        </div>`;
    } else {
      const loader = document.createElement('div');
      loader.className = 'au-social-loading';
      loader.id = 'au-social-more-loader';
      loader.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      content.appendChild(loader);
    }

    this.isLoading = true;

    try {
      // For "friends" and "custom lists" filters, we fetch "following" and filter locally
      const fetchFilter = (this.currentFilter === 'friends' || this.currentCustomList) ? 'following' : this.currentFilter;
      const { nodes, hasNextPage } = await this.socialService.getDetailedActivity(
        mediaId,
        fetchFilter,
        page,
        this.currentStatus
      );

      let processedNodes = nodes;

      // Filter by Best Friends (legacy)
      if (this.currentFilter === 'friends') {
        processedNodes = nodes.filter((node: SocialActivityDetailed) => this.bestFriendService.isBestFriend(node.user.id));

        if (processedNodes.length === 0 && hasNextPage && page < 5) {
          this.isLoading = false;
          return this.loadData(mediaId, page + 1);
        }
      }

      // Filter by Custom List
      if (this.currentCustomList) {
        const listUsers = this.customListService.getList(this.currentCustomList);
        const userIds = new Set(listUsers.map((u: any) => u.id));
        processedNodes = nodes.filter((node: SocialActivityDetailed) => userIds.has(node.user.id));

        if (processedNodes.length === 0 && hasNextPage && page < 5) {
          this.isLoading = false;
          return this.loadData(mediaId, page + 1);
        }
      }

      this.currentPage = page;
      this.hasNextPage = hasNextPage;
      this.isLoading = false;

      // Remove loader
      const moreLoader = this.querySelector('#au-social-more-loader');
      if (moreLoader) moreLoader.remove();

      this.lastLoadedNodes = page === 1 ? nodes : [...this.lastLoadedNodes, ...nodes];
      this.refreshEntries();

    } catch (e) {
      log.error('[SocialSidebar] Load failed', e);
      this.isLoading = false;
      if (page === 1) {
        content.innerHTML = `<div class="au-social-empty">Failed to load activity. Is it available for this anime?</div>`;
      }
    }
  }

  private refreshEntries(): void {
    let filtered = this.lastLoadedNodes;

    if (this.searchQuery) {
      filtered = filtered.filter(node =>
        node.user.name.toLowerCase().includes(this.searchQuery) ||
        (node.notes && node.notes.toLowerCase().includes(this.searchQuery))
      );
    }

    this.renderEntries(filtered, true); // Always re-render full list for local search
  }

  private renderEntries(nodes: SocialActivityDetailed[], replace: boolean): void {
    const content = this.querySelector('.au-social-content')!;

    if (nodes.length === 0 && replace) {
      content.innerHTML = `<div class="au-social-empty">No activity found for this filter.</div>`;
      return;
    }

    const html = nodes.map((node, i) => {
      const format = node.user.mediaListOptions?.scoreFormat || 'POINT_100';
      const formattedScore = ScoreFormatter.format(node.score, format);
      const scoreColor = ScoreFormatter.getColor(node.score);

      const isMalSync = node.notes && (node.notes.includes('malSync::') || node.notes.includes('autotrack'));
      const statusColor = this.getStatusColor(node.status);
      const relativeTime = this.timeAgo(node.updatedAt * 1000);

      const scoreHtml = node.score > 0
        ? `<span class="au-score-badge" style="color:${scoreColor}; border: 1px solid ${scoreColor}40; background:${scoreColor}15">${formattedScore}</span>`
        : '';

      const notesHtml = (node.notes && !isMalSync)
        ? `<div class="au-friend-note">"${node.notes}"</div>`
        : '';

      const isBf = this.bestFriendService.isBestFriend(node.user.id);
      const starIcon = isBf ? 'fa-star' : 'fa-star-o';

      // Staggered animation delay
      const animationDelay = replace ? `style="animation-delay: ${i * 0.06}s"` : '';

      return `
        <div class="au-friend-row" data-user-id="${node.user.id}" data-user-name="${node.user.name}" ${animationDelay}>
          <a href="/user/${node.user.name}" target="_blank" class="au-friend-avatar-link">
            <img src="${node.user.avatar.medium}" alt="${node.user.name}">
          </a>
          <div class="au-friend-info">
            <div class="au-friend-header">
              <span class="au-friend-name" data-profile-link="/user/${node.user.name}">${node.user.name}</span>
              <i class="fa ${starIcon} au-bf-toggle" title="${isBf ? 'Remove from Best Friends' : 'Add to Best Friends'}"></i>
            </div>
            <div class="au-friend-status" style="color:${statusColor}">
              ${this.formatStatus(node)} ${scoreHtml}
            </div>
            <div class="au-friend-date">${relativeTime}</div>
            ${notesHtml}
          </div>
        </div>
      `;
    }).join('');

    if (replace) {
      content.innerHTML = html;
    } else {
      content.insertAdjacentHTML('beforeend', html);
    }

    // Attach star toggle events
    content.querySelectorAll('.au-bf-toggle').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const row = (e.target as HTMLElement).closest('.au-friend-row') as HTMLElement;
        const userId = parseInt(row.getAttribute('data-user-id') || '0');
        const userName = row.getAttribute('data-user-name') || '';

        const isNowBf = await this.bestFriendService.toggleBestFriend(userId, userName);

        // Update UI immediately (all instances in sidebar)
        content.querySelectorAll(`.au-friend-row[data-user-id="${userId}"] .au-bf-toggle`).forEach(star => {
          star.className = `fa ${isNowBf ? 'fa-star' : 'fa-star-o'} au-bf-toggle`;
        });

        // If we are on the friends tab and just removed someone, remove row
        if (this.currentFilter === 'friends' && !isNowBf) {
          row.style.opacity = '0';
          setTimeout(() => row.remove(), 300);
        }
      });
    });

    // Attach row background click (Deep Linking)
    content.querySelectorAll('.au-friend-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const userName = row.getAttribute('data-user-name');

        // If clicking name/avatar specifically, stay with profile
        if (target.closest('.au-friend-avatar-link') || target.hasAttribute('data-profile-link')) {
          window.open(`/user/${userName}`, '_blank');
          return;
        }

        // Otherwise fallback to user list filtered by anime
        const encodedTitle = encodeURIComponent(this.currentAnimeTitle);
        window.open(`/user/${userName}/animelist?search=${encodedTitle}`, '_blank');
      });
    });
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case 'CURRENT': return '#3db4f2';
      case 'COMPLETED': return '#68d639';
      case 'PAUSED': return '#e89e3a';
      case 'DROPPED': return '#f14242';
      default: return '#9195a3';
    }
  }

  private formatStatus(node: SocialActivityDetailed): string {
    if (node.status === 'CURRENT') return `Watching Ep ${node.progress}`;
    if (node.status === 'COMPLETED') return 'Completed';
    return node.status.charAt(0) + node.status.slice(1).toLowerCase();
  }

  private timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
