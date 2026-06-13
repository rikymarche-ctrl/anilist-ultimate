/**
 * @file SocialSidebar.ts
 * @description Fixed sidebar displaying detailed friend activity for a specific media.
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { MediaListStatus, MediaType, SocialActivityDetailed, SocialFilter } from '@core/types';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { CustomListService } from '../CustomListService';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { html } from '@core/utils/Template';
import { Sanitizer } from '@core/utils/Sanitizer';

/**
 * Enterprise-grade sidebar for social activity.
 * Hardened against XSS and optimized for performance via event delegation.
 */
@injectable()
export class SocialSidebar extends BaseComponent {
  private currentMediaId: number | null = null;
  private currentFilter: SocialFilter = 'self';
  private currentCustomList: string | null = null;
  private currentStatus: MediaListStatus | 'all' = 'all';
  private searchQuery: string = '';
  private currentPage = 1;
  private hasNextPage = true;
  private isLoading = false;
  private currentAnchor: HTMLElement | null = null;
  private currentAnimeTitle: string = '';
  private currentMediaType: MediaType = 'ANIME';
  private lastLoadedNodes: SocialActivityDetailed[] = [];

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.CustomListService) private customListService: CustomListService
  ) {
    super({});
  }

  /**
   * Renders the base sidebar structure using secure templates.
   */
  protected render(): HTMLElement {
    return html`
      <div class="au-social-sidebar" id="au-social-sidebar">
        <div class="au-social-header">
          <h3 class="au-social-title">Social Activity</h3>
          <div class="au-social-close" title="Close" id="au-social-close">
            <i class="fa fa-times"></i>
          </div>
        </div>
        <div class="au-social-tabs">
          <div class="au-filter active" data-type="self">Self</div>
          <div class="au-filter" data-type="following">Following</div>
          <div class="au-filter au-filter-dropdown" data-type="custom-lists" id="au-custom-lists-trigger">
            <span class="au-filter-label">Custom Lists</span>
            <i class="fa fa-caret-down"></i>
            <div class="au-filter-dropdown-menu" style="display: none;" id="au-custom-lists-menu"></div>
          </div>
          <div class="au-filter" data-type="global">Global</div>
        </div>
        <div class="au-status-tabs">
          <div class="au-status-filter active" data-status="all">All</div>
          <div class="au-status-filter" data-status="${MediaListStatus.CURRENT}">Watching</div>
          <div class="au-status-filter" data-status="${MediaListStatus.PLANNING}">Plans</div>
          <div class="au-status-filter" data-status="${MediaListStatus.COMPLETED}">Completed</div>
          <div class="au-status-filter" data-status="${MediaListStatus.PAUSED}">Paused</div>
          <div class="au-status-filter" data-status="${MediaListStatus.DROPPED}">Dropped</div>
        </div>
        <div class="au-social-search-wrapper">
          <div class="au-social-search-inner">
            <i class="fa fa-search au-social-search-icon"></i>
            <input type="text" class="au-social-search-input" id="au-social-search" placeholder="Search friends or notes..." />
          </div>
        </div>
        <div class="au-social-content" id="au-social-content">
          <div class="au-social-empty">Select an anime to see activity</div>
        </div>
      </div>
    `;
  }

  /**
   * Attaches events using a mix of direct binding and delegation.
   */
  protected attachEvents(): void {
    // 1. External Events
    // Managed listeners: BaseComponent removes them on unmount/destroy.
    this.addEventListener(window, 'au-open-social-sidebar', ((e: CustomEvent) => {
      const { mediaId, title, element, type } = e.detail;
      this.open(mediaId, title, element, type);
    }) as EventListener);

    // 2. Navigation & Actions
    this.$('#au-social-close')?.addEventListener('click', () => this.close());

    this.$$('.au-filter:not(.au-filter-dropdown)').forEach(filter => {
      filter.addEventListener('click', () => {
        const type = filter.getAttribute('data-type') as SocialFilter;
        this.setFilter(type);
      });
    });

    const dropdownTrigger = this.$('#au-custom-lists-trigger');
    const dropdownMenu = this.$('#au-custom-lists-menu');
    if (dropdownTrigger && dropdownMenu) {
      dropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.style.display === 'block';
        dropdownMenu.style.display = isOpen ? 'none' : 'block';
      });
    }

    this.addEventListener(document, 'click', () => {
      if (dropdownMenu) dropdownMenu.style.display = 'none';
    });

    this.$$('.au-status-filter').forEach(filter => {
      filter.addEventListener('click', () => {
        const status = filter.getAttribute('data-status')!;
        this.setStatus(status);
      });
    });

    // 3. Search & Scroll
    const searchInput = this.$('#au-social-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.refreshEntries();
      });
    }

    const content = this.$('#au-social-content');
    if (content) {
      content.addEventListener('scroll', () => {
        const distanceToBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
        if (distanceToBottom < 100 && this.hasNextPage && !this.isLoading && this.currentMediaId) {
          this.loadData(this.currentMediaId, this.currentPage + 1);
        }
      });

      // EVENT DELEGATION for activity rows
      content.addEventListener('click', (e) => this.handleContentClick(e));
    }

    // 4. Keyboard
    this.addEventListener(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.element.classList.contains('active')) {
        this.close();
      }
    }) as EventListener);

    // Initialize custom lists
    this.populateCustomListsDropdown().catch(() => {});
  }

  /**
   * Handles all clicks inside the social content area via delegation.
   * @private
   */
  private async handleContentClick(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;
    
    // Star toggle
    const starBtn = target.closest('.au-bf-toggle');
    if (starBtn) {
      e.stopPropagation();
      const row = starBtn.closest('.au-friend-row') as HTMLElement;
      const userId = parseInt(row.dataset.userId || '0');
      const userName = row.dataset.userName || '';
      
      const isNowBf = !this.customListService.isUserInList('Best Friends', userId);
      await this.customListService.toggleUserInList('Best Friends', {
        id: userId,
        name: userName,
        avatar: row.querySelector('img')?.src || ''
      }, isNowBf);

      // Update all instances of this star
      this.$$(`.au-friend-row[data-user-id="${userId}"] .au-bf-toggle`).forEach(star => {
        star.className = `fa ${isNowBf ? 'fa-star' : 'fa-star-o'} au-bf-toggle`;
      });

      if (this.currentFilter === 'friends' && !isNowBf) {
        (row as any).style.opacity = '0';
        setTimeout(() => row.remove(), 300);
      }
      return;
    }

    // Row deep linking
    const row = target.closest('.au-friend-row') as HTMLElement;
    if (row) {
      const userName = row.dataset.userName;
      if (target.closest('.au-friend-avatar-link') || target.hasAttribute('data-profile-link')) {
        window.open(`/user/${userName}`, '_blank');
      } else {
        const encodedTitle = encodeURIComponent(this.currentAnimeTitle);
        window.open(`/user/${userName}/animelist?search=${encodedTitle}`, '_blank');
      }
    }
  }

  private async populateCustomListsDropdown(): Promise<void> {
    await this.customListService.init();
    const lists = this.customListService.getLists();
    const menu = this.$('#au-custom-lists-menu');
    if (!menu) return;

    const listNames = Object.keys(lists);
    if (listNames.length === 0) {
      menu.appendChild(html`<div class="au-dropdown-item au-dropdown-empty">No lists found</div>`);
      return;
    }

    menu.innerHTML = '';
    listNames.forEach(name => {
      const item = html`
        <div class="au-dropdown-item" data-list-name="${name}">
          <i class="fa fa-list-ul"></i> ${name}
        </div>
      `;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setCustomListFilter(name);
      });
      menu.appendChild(item);
    });
  }

  private setCustomListFilter(listName: string): void {
    this.currentFilter = 'following';
    this.currentCustomList = listName;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.$$('.au-filter').forEach(f => f.classList.remove('active'));
    this.$('#au-custom-lists-trigger')?.classList.add('active');
    const label = this.$('#au-custom-lists-trigger .au-filter-label');
    if (label) label.textContent = listName;

    const menu = this.$('#au-custom-lists-menu');
    if (menu) menu.style.display = 'none';

    if (this.currentMediaId) this.loadData(this.currentMediaId, 1);
  }

  public open(mediaId: number, title: string, anchor?: HTMLElement, type: MediaType = 'ANIME'): void {
    if (this.currentMediaId === mediaId && this.element.classList.contains('active')) return;

    this.currentMediaId = mediaId;
    this.currentAnimeTitle = title;
    this.currentMediaType = type;
    this.currentPage = 1;
    this.hasNextPage = true;

    const titleEl = this.$('.au-social-title');
    if (titleEl) titleEl.textContent = title;
    this.element.classList.add('active');

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
    this.currentCustomList = null;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.$$('.au-filter').forEach(f => {
      f.classList.toggle('active', f.getAttribute('data-type') === type);
    });

    const label = this.$('#au-custom-lists-trigger .au-filter-label');
    if (label) label.textContent = 'Custom Lists';

    if (this.currentMediaId) this.loadData(this.currentMediaId, 1);
  }

  private setStatus(status: string): void {
    const statusVal = status === 'all' ? 'all' : status as MediaListStatus;
    if (this.currentStatus === statusVal) return;

    this.currentStatus = statusVal;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.$$('.au-status-filter').forEach(f => {
      f.classList.toggle('active', f.getAttribute('data-status') === status);
    });

    if (this.currentMediaId) this.loadData(this.currentMediaId, 1);
  }

  private async loadData(mediaId: number, page: number): Promise<void> {
    if (this.isLoading) return;

    const content = this.$('#au-social-content')!;
    if (page === 1) {
      content.innerHTML = '';
      content.appendChild(html`
        <div class="au-social-loading">
          <i class="fa fa-spinner fa-spin"></i>
          <span>Retrieving activities...</span>
        </div>`);
    } else {
      const loader = html`
        <div class="au-social-loading" id="au-social-more-loader">
          <i class="fa fa-spinner fa-spin"></i>
        </div>`;
      content.appendChild(loader);
    }

    this.isLoading = true;

    try {
      const fetchFilter = (this.currentFilter === 'friends' || this.currentCustomList) ? 'following' : this.currentFilter;
      const { nodes, hasNextPage } = await this.socialService.getDetailedActivity(
        mediaId,
        fetchFilter,
        page,
        this.currentStatus
      );

      this.currentPage = page;
      this.hasNextPage = hasNextPage;
      this.isLoading = false;

      this.$('#au-social-more-loader')?.remove();

      this.lastLoadedNodes = page === 1 ? nodes : [...this.lastLoadedNodes, ...nodes];
      this.refreshEntries();

    } catch (e) {
      log.error('[SocialSidebar] Load failed', e);
      this.isLoading = false;
      if (page === 1) {
        content.innerHTML = '';
        content.appendChild(html`<div class="au-social-empty">Failed to load activity. Is it available for this anime?</div>`);
      }
    }
  }

  private refreshEntries(): void {
    let filtered = this.lastLoadedNodes;

    // Local filtering for Friends/Custom Lists
    if (this.currentFilter === 'friends') {
      filtered = filtered.filter(node => this.customListService.isUserInList('Best Friends', node.user.id));
    } else if (this.currentCustomList) {
      const listUsers = this.customListService.getList(this.currentCustomList);
      const userIds = new Set(listUsers.map((u: any) => u.id));
      filtered = filtered.filter(node => userIds.has(node.user.id));
    }

    if (this.searchQuery) {
      filtered = filtered.filter(node =>
        node.user.name.toLowerCase().includes(this.searchQuery) ||
        (node.notes && node.notes.toLowerCase().includes(this.searchQuery))
      );
    }

    this.renderEntries(filtered);
  }

  /**
   * Renders activity rows using secure templates.
   * @private
   */
  private renderEntries(nodes: SocialActivityDetailed[]): void {
    const content = this.$('#au-social-content')!;
    content.innerHTML = '';

    if (nodes.length === 0) {
      content.appendChild(html`<div class="au-social-empty">No activity found.</div>`);
      return;
    }

    nodes.forEach((node, i) => {
      const format = node.user.mediaListOptions?.scoreFormat || 'POINT_100';
      const formattedScore = ScoreFormatter.format(node.score, format);
      const scoreColor = ScoreFormatter.getColor(node.score);
      const isMalSync = node.notes && (node.notes.includes('malSync::') || node.notes.includes('autotrack'));
      const relativeTime = this.timeAgo(node.updatedAt * 1000);
      const isBf = this.customListService.isUserInList('Best Friends', node.user.id);
      
      const row = html`
        <div class="au-friend-row" data-user-id="${node.user.id}" data-user-name="${node.user.name}" style="animation-delay: ${i * 0.05}s">
          <div class="au-friend-avatar-link">
            <img src="${node.user.avatar.medium}" alt="${node.user.name}">
          </div>
          <div class="au-friend-info">
            <div class="au-friend-header">
              <span class="au-friend-name" data-profile-link="true">${node.user.name}</span>
              <i class="fa ${isBf ? 'fa-star' : 'fa-star-o'} au-bf-toggle" title="Toggle Best Friend"></i>
            </div>
            <div class="au-friend-status au-status--${node.status.toLowerCase()}">
              ${this.formatStatus(node)}
              ${node.score > 0 ? html`
                <span class="au-score-badge" style="color:${scoreColor}; border-color: ${scoreColor}40; background:${scoreColor}15">
                  ${formattedScore}
                </span>
              ` : ''}
            </div>
            <div class="au-friend-date">${relativeTime}</div>
            ${node.notes && !isMalSync ? html`<div class="au-friend-note">"${Sanitizer.escape(node.notes)}"</div>` : ''}
          </div>
        </div>
      `;
      content.appendChild(row);
    });
  }

  private formatStatus(node: SocialActivityDetailed): string {
    const label = getStatusLabel(node.status, this.currentMediaType);
    return node.status === MediaListStatus.CURRENT ? `${label} Ep ${node.progress}` : label;
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
