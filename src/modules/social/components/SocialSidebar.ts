/**
 * Social Sidebar Component
 * Displays detailed activity entries for a specific media
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { SocialActivityDetailed, SocialFilter } from '@core/types';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import { BestFriendService } from '../BestFriendService';
import { log } from '@core/logger';

export class SocialSidebar extends BaseComponent {
  private socialService = SocialService.getInstance();
  private bestFriendService = BestFriendService.getInstance();
  private currentMediaId: number | null = null;
  private currentFilter: SocialFilter = 'following';
  private currentPage = 1;
  private hasNextPage = true;
  private isLoading = false;
  private currentAnchor: HTMLElement | null = null;

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
        <div class="au-filter active" data-type="following">Following</div>
        <div class="au-filter" data-type="friends">Friends</div>
        <div class="au-filter" data-type="global">Global</div>
        <div class="au-filter" data-type="self">Self</div>
      </div>
      <div class="au-social-content">
        <div class="au-social-empty">Select an anime to see activity</div>
      </div>
    `;

    return sidebar;
  }

  protected attachEvents(): void {
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

    // Filter clicks
    const filters = this.querySelectorAll('.au-filter');
    filters.forEach(filter => {
      this.addEventListener(filter as HTMLElement, 'click', () => {
        const type = filter.getAttribute('data-type') as SocialFilter;
        this.setFilter(type);
      });
    });

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

  public open(mediaId: number, title: string, anchor?: HTMLElement): void {
    if (this.currentMediaId === mediaId && this.element.classList.contains('active')) {
      return;
    }

    this.currentMediaId = mediaId;
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
    if (this.currentFilter === type) return;

    this.currentFilter = type;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.querySelectorAll('.au-filter').forEach(f => {
      f.classList.toggle('active', f.getAttribute('data-type') === type);
    });

    if (this.currentMediaId) {
      this.loadData(this.currentMediaId, 1);
    }
  }

  private async loadData(mediaId: number, page: number): Promise<void> {
    if (this.isLoading) return;

    const content = this.querySelector('.au-social-content')!;
    if (page === 1) {
      content.innerHTML = '<div class="au-social-loading"><i class="fa fa-spinner fa-spin"></i></div>';
    } else {
      const loader = document.createElement('div');
      loader.className = 'au-social-loading';
      loader.id = 'au-social-more-loader';
      loader.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      content.appendChild(loader);
    }

    this.isLoading = true;

    try {
      // For "friends" filter, we actually fetch "following" and filter locally
      const fetchFilter = this.currentFilter === 'friends' ? 'following' : this.currentFilter;
      const { nodes, hasNextPage } = await this.socialService.getDetailedActivity(mediaId, fetchFilter, page);

      let processedNodes = nodes;
      if (this.currentFilter === 'friends') {
        processedNodes = nodes.filter(node => this.bestFriendService.isBestFriend(node.user.id));

        // If we filtered everything and there are more pages, keep fetching (simple recursion)
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

      this.renderEntries(processedNodes, page === 1);

    } catch (e) {
      log.error('[SocialSidebar] Load failed', e);
      this.isLoading = false;
      if (page === 1) {
        content.innerHTML = `<div class="au-social-empty">Failed to load activity. Is it available for this anime?</div>`;
      }
    }
  }

  private renderEntries(nodes: SocialActivityDetailed[], replace: boolean): void {
    const content = this.querySelector('.au-social-content')!;

    if (nodes.length === 0 && replace) {
      content.innerHTML = `<div class="au-social-empty">No activity found for this filter.</div>`;
      return;
    }

    const html = nodes.map(node => {
      const format = node.user.mediaListOptions?.scoreFormat || 'POINT_100';
      const formattedScore = ScoreFormatter.format(node.score, format);
      const scoreColor = ScoreFormatter.getColor(node.score);

      const isMalSync = node.notes && (node.notes.includes('malSync::') || node.notes.includes('autotrack'));
      const statusColor = this.getStatusColor(node.status);
      const relativeTime = this.timeAgo(node.updatedAt * 1000);

      const scoreHtml = node.score > 0
        ? `<span class="au-score-badge" style="color:${scoreColor}; background:${scoreColor}20">${formattedScore}</span>`
        : '';

      const notesHtml = (node.notes && !isMalSync)
        ? `<div class="au-friend-note">"${node.notes}"</div>`
        : '';

      const isBf = this.bestFriendService.isBestFriend(node.user.id);
      const starIcon = isBf ? 'fa-star' : 'fa-star-o';

      return `
        <div class="au-friend-row" data-user-id="${node.user.id}" data-user-name="${node.user.name}">
          <a href="/user/${node.user.name}" target="_blank" class="au-friend-avatar-link">
            <img src="${node.user.avatar.medium}" alt="${node.user.name}">
          </a>
          <div class="au-friend-info">
            <div class="au-friend-header">
              <a href="/user/${node.user.name}" target="_blank" class="au-friend-name">${node.user.name}</a>
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
