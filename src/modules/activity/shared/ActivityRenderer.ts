/**
 * Activity Renderer
 * Handles activity filtering, rendering, and display logic
 * Shared between ActivityEnhancerModule and MediaSocialEnhancer
 */

import { injectable } from 'tsyringe';
import type { ILogger } from '@core/interfaces/ILogger';
import type { ActivityType, AniListActivity } from '../ActivityUtils';
import { getActivityType, getTimeAgo } from '../ActivityUtils';

export interface RendererOptions {
  /**
   * CSS selector for activity elements
   */
  activitySelector?: string;

  /**
   * Whether to show activity scores
   */
  showScores?: boolean;
}

/**
 * Activity Renderer Component
 * Manages activity visibility, filtering, and custom rendering
 */
@injectable()
export class ActivityRenderer {
  private options: RendererOptions = {
    activitySelector: '.activity-entry, .activity-anime, .activity-manga, .activity-text',
    showScores: false,
  };

  constructor(private logger: ILogger) {}

  /**
   * Configure renderer options
   */
  configure(options: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Apply filters to native activities
   */
  applyFilters(
    activeFilters: Set<ActivityType>,
    searchQuery: string = ''
  ): { shown: number; hidden: number } {
    const activities = Array.from(
      document.querySelectorAll(this.options.activitySelector!)
    ) as HTMLElement[];

    this.logger.debug(`[ActivityRenderer] Applying filters to ${activities.length} activities`);

    let hiddenCount = 0;
    let shownCount = 0;

    activities.forEach((el) => {
      const text = el.textContent?.toLowerCase() || '';
      const type = getActivityType(text);
      const typeMatch = activeFilters.has('all') || activeFilters.has(type);
      const searchMatch = !searchQuery || text.includes(searchQuery);

      if (typeMatch && searchMatch) {
        el.style.display = '';
        el.classList.remove('au-activity-hidden');
        shownCount++;
      } else {
        el.style.display = 'none';
        el.classList.add('au-activity-hidden');
        hiddenCount++;
      }
    });

    this.logger.info(
      `[ActivityRenderer] Filtered: ${shownCount} shown, ${hiddenCount} hidden`
    );

    return { shown: shownCount, hidden: hiddenCount };
  }

  /**
   * Hide all native activities
   */
  hideNativeActivities(): void {
    const activities = document.querySelectorAll(this.options.activitySelector!);
    activities.forEach((activity) => {
      (activity as HTMLElement).style.display = 'none';
    });
    this.logger.debug(`[ActivityRenderer] Hid ${activities.length} native activities`);
  }

  /**
   * Show all native activities
   */
  showNativeActivities(): void {
    const activities = document.querySelectorAll(this.options.activitySelector!);
    activities.forEach((activity) => {
      (activity as HTMLElement).style.display = '';
    });
    this.logger.debug(`[ActivityRenderer] Showed ${activities.length} native activities`);
  }

  /**
   * Render custom activities from GraphQL data
   */
  renderCustomActivities(
    activities: AniListActivity[],
    container: HTMLElement
  ): void {
    if (!activities || activities.length === 0) {
      this.showEmptyMessage(container);
      return;
    }

    const html = activities.map((activity) => this.renderActivity(activity)).join('');
    container.innerHTML = html;

    this.logger.info(`[ActivityRenderer] Rendered ${activities.length} custom activities`);
  }

  /**
   * Render a single activity
   */
  private renderActivity(activity: AniListActivity): string {
    const timeAgo = getTimeAgo(activity.createdAt);
    const userName = activity.user?.name || 'Unknown';
    const userAvatar = activity.user?.avatar?.medium || '';
    const userUrl = `https://anilist.co/user/${userName}`;

    let content = '';
    let mediaTitle = '';
    let mediaUrl = '';

    // Check activity type (note: type field contains strings like "ANIME_LIST", "MANGA_LIST", "TEXT")
    const isListActivity = activity.type?.includes('LIST');
    const isTextActivity = activity.type === 'TEXT';

    if (isListActivity && activity.media) {
      const status = activity.status || '';
      const progress = activity.progress || '';
      mediaTitle = activity.media.title?.romaji || 'Unknown';
      mediaUrl = `https://anilist.co/${activity.media.type?.toLowerCase() || 'anime'}/${activity.media.id}`;

      content = `
        <div class="au-activity-content">
          ${status} ${progress ? `<strong>${progress}</strong>` : ''} of
          <a href="${mediaUrl}" target="_blank" class="au-activity-media-link">${mediaTitle}</a>
        </div>
      `;
    } else if (isTextActivity) {
      const text = activity.text || '';
      content = `<div class="au-activity-content">${text}</div>`;
    }

    return `
      <div class="au-custom-activity" data-activity-id="${activity.id}">
        <div class="au-activity-header">
          <a href="${userUrl}" target="_blank" class="au-activity-user">
            ${userAvatar ? `<img src="${userAvatar}" class="au-activity-avatar" />` : ''}
            <span class="au-activity-username">${userName}</span>
          </a>
          <span class="au-activity-time">${timeAgo}</span>
        </div>
        ${content}
      </div>
    `;
  }

  /**
   * Show empty state message
   */
  showEmptyMessage(container: HTMLElement): void {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px; font-size: 1.4rem; color: var(--color-text-lighter);">
        No activities found for the users in this list.
      </div>
    `;
  }

  /**
   * Show loading spinner
   */
  showLoader(container: HTMLElement): void {
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; padding: 60px; font-size: 1.5rem; color: var(--color-text-lighter);">
        <i class="fa fa-spinner fa-spin" style="margin-right: 12px;"></i>
        Loading custom list activities...
      </div>
    `;
  }

  /**
   * Clear container
   */
  clear(container: HTMLElement): void {
    container.innerHTML = '';
  }
}
