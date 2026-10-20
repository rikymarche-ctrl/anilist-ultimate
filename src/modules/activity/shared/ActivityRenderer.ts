/**
 * @file ActivityRenderer.ts
 * @description Activity visibility filtering and custom rendering with template cloning
 *
 * Shared between ActivityEnhancerModule and MediaSocialEnhancer.
 * Manages show/hide of native activity DOM entries based on filter
 * type, search query, and custom list membership. Supports fallback
 * rendering when AniList DOM structure cannot be cloned.
 *
 * @see ActivityFilterBar.ts for the filter UI component
 * @see ActivityUtils.ts for type detection helpers
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { escapeHtml } from '@core/utils/Template';
import { cssImageUrl } from '@core/utils/WebUrl';
import type { ILogger } from '@core/interfaces/ILogger';
import type { ActivityFilterType, AniListActivity } from '../ActivityUtils';
import { getActivityType, getTimeAgo } from '../ActivityUtils';
import { parseFeedActivity } from '../ActivityResponse';

/**
 * Native feed rows only. Custom-list clones carry au-custom-activity and must
 * never be hidden, shown or filtered by the native-row passes.
 */
export const NATIVE_ACTIVITY_SELECTOR = [
  '.activity-feed > .activity-entry',
  '.activities > .activity-entry',
  '.activity-entry',
  '.activity-anime',
  '.activity-manga',
  '.activity-text',
].map(part => `${part}:not(.au-custom-activity)`).join(', ');

/** Native state classes copied into a clone would make it look filtered or liked. */
const NATIVE_STATE_CLASSES = ['au-activity-hidden', 'liked', 'is-liked'] as const;

function isHiddenRow(row: HTMLElement): boolean {
  return row.classList.contains('au-activity-hidden') || row.style.display === 'none';
}

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
    // BUG FIX: Use a more specific selector to avoid nested matches (especially on profile pages)
    activitySelector: NATIVE_ACTIVITY_SELECTOR,
    showScores: false,
  };

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger
  ) { }

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
    activeFilters: Set<ActivityFilterType>,
    searchQuery: string = ''
  ): { shown: number; hidden: number } {
    const allActivities = document.querySelectorAll(this.options.activitySelector!);
    
    // BUG FIX: Filter out nested elements to avoid double-processing or conflicts
    // Keep only elements that don't have a parent which is also an activity
    const activities = Array.from(allActivities).filter(el => {
      return !Array.from(allActivities).some(potentialParent => 
        potentialParent !== el && potentialParent.contains(el)
      );
    }) as HTMLElement[];

    this.logger.debug(`[ActivityRenderer] Applying filters to ${activities.length} top-level activities`);
    this.logger.debug(`[ActivityRenderer] Active filters:`, Array.from(activeFilters));
    this.logger.debug('[ActivityRenderer] Search active:', Boolean(searchQuery));

    let hiddenCount = 0;
    let shownCount = 0;

    activities.forEach((el, index) => {
      const text = el.textContent?.toLowerCase() || '';
      const type = getActivityType(text);
      const typeMatch = activeFilters.has('ALL') || activeFilters.has(type);
      const searchMatch = !searchQuery || text.includes(searchQuery);

      // Detailed logging for first 3 entries
      if (index < 3) {
        this.logger.debug(`[ActivityRenderer] Entry ${index}:`, {
          preview: text.substring(0, 100),
          detectedType: type,
          typeMatch,
          searchMatch,
          willShow: typeMatch && searchMatch
        });
      }

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

    // Clear container
    container.innerHTML = '';

    // Find templates for different types
    const templates = {
      anime: this.pickTemplate('.activity-anime:not(.au-custom-activity), .activity-manga:not(.au-custom-activity)'),
      text: this.pickTemplate('.activity-text:not(.au-custom-activity)'),
    };

    activities.forEach(row => {
      // Direct renderer callers still cannot bypass the domain boundary.
      let activity: AniListActivity;
      try { activity = parseFeedActivity(row); } catch { return; }
      const type = activity.type === 'TEXT' ? 'text' : 'anime';
      const el = this.renderActivity(activity, templates[type] as HTMLElement);
      if (el) container.appendChild(el);
    });

    this.logger.info(`[ActivityRenderer] Rendered ${activities.length} custom activities`);
  }

  /**
   * Prefer a visible native row as clone source: a filtered-out row carries
   * au-activity-hidden (display:none !important) that clones would inherit.
   */
  private pickTemplate(selector: string): HTMLElement | null {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(selector));
    return rows.find(row => !isHiddenRow(row)) ?? rows[0] ?? null;
  }

  /**
   * Render a single activity
   */
  private renderActivity(activity: AniListActivity, template?: HTMLElement | null): HTMLElement {
    const timeAgo = getTimeAgo(activity.createdAt);
    const userName = activity.user?.name || 'Unknown';
    const userAvatar = activity.user?.avatar?.medium || '';
    const userUrl = `/user/${encodeURIComponent(userName)}`;

    // If we have a template, clone it and swap data
    if (template) {
      const clone = template.cloneNode(true) as HTMLElement;
      clone.classList.add('au-custom-activity');
      clone.classList.remove('activity-anime', 'activity-manga', 'activity-text');
      clone.classList.remove(...NATIVE_STATE_CLASSES);
      clone.querySelectorAll(NATIVE_STATE_CLASSES.map(state => `.${state}`).join(', '))
        .forEach(node => node.classList.remove(...NATIVE_STATE_CLASSES));
      clone.classList.add(activity.type === 'TEXT' ? 'activity-text' : activity.type === 'MANGA_LIST' ? 'activity-manga' : 'activity-anime');
      clone.setAttribute('data-activity-id', activity.id.toString());
      clone.style.display = ''; // Reset display

      // 1. Update User Avatar & Name
      const avatar = clone.querySelector('.avatar') as HTMLElement;
      if (avatar) {
        avatar.style.backgroundImage = cssImageUrl(userAvatar);
        if (avatar.tagName === 'A') {
          if (activity.user) avatar.setAttribute('href', userUrl);
          else avatar.removeAttribute('href');
        }
      }

      const name = clone.querySelector('.name') as HTMLElement;
      if (name) {
        name.textContent = userName;
        if (name.tagName === 'A') {
          if (activity.user) name.setAttribute('href', userUrl);
          else name.removeAttribute('href');
        }
      }

      // 2. Update Time
      const time = clone.querySelector('.time') as HTMLElement;
      if (time) {
        time.textContent = timeAgo;
        if (time.tagName === 'A') time.setAttribute('href', `/activity/${activity.id}`);
      }

      // 3. Update Activity Content (Status/Title)
      const status = clone.querySelector('.status, .text') as HTMLElement;
      if (status) {
        if (activity.type === 'TEXT') {
          status.textContent = activity.text || '';
        } else {
          const actType = activity.status?.toLowerCase() || 'watched';
          const mediaUrl = activity.media ? `/${activity.media.type.toLowerCase()}/${activity.media.id}` : '';
          status.innerHTML = `
            ${escapeHtml(actType)} ${activity.progress ? `<strong>${escapeHtml(activity.progress)}</strong>` : ''}
            ${activity.media ? `of <a href="${mediaUrl}" class="title">${escapeHtml(activity.media.title.romaji)}</a>` : ''}
          `;
        }
      }

      // 4. Update Media Cover (Surgical)
      let cover = clone.querySelector('.cover') as HTMLElement;
      if (activity.media) {
        const mediaUrl = `/${activity.media.type?.toLowerCase()}/${activity.media.id}`;
        const mediaCover = activity.media.coverImage.medium;

        if (!cover) {
          // If template doesn't have a cover (e.g. text template used for list activity)
          // Create one manually to match native structure
          cover = document.createElement('a');
          cover.className = 'cover';
          const list = clone.querySelector('.list') || clone;
          list.insertBefore(cover, list.firstChild);
        }

        cover.style.backgroundImage = cssImageUrl(mediaCover);
        cover.setAttribute('href', mediaUrl);
        cover.style.display = '';
      } else if (cover) {
        cover.style.display = 'none';
      }

      // 5. Update Replies/Likes
      const replies = clone.querySelector('.activity-replies, .replies') as HTMLElement;
      if (replies) {
        const count = replies.querySelector('.count');
        if (count) count.textContent = (activity.replyCount || 0).toString();
      }

      const likes = clone.querySelector('.activity-likes, .likes') as HTMLElement;
      if (likes) {
        const count = likes.querySelector('.count');
        if (count) count.textContent = (activity.likeCount || 0).toString();
      }

      // Cleanup some native elements we don't support or need to hide
      clone.querySelectorAll('.donors-icon, .plus-icon').forEach(el => (el as HTMLElement).style.display = 'none');

      return clone;
    }

    // Fallback to manual rendering if no template found
    const div = document.createElement('div');
    const isListActivity = activity.type?.includes('LIST');
    const isTextActivity = activity.type === 'TEXT';

    div.className = 'au-custom-activity activity-entry';
    if (isListActivity) div.classList.add(activity.type === 'MANGA_LIST' ? 'activity-manga' : 'activity-anime');
    if (isTextActivity) div.classList.add('activity-text');

    div.innerHTML = this.renderManualHTML(activity, timeAgo, userName, userUrl);
    if (!activity.user) div.querySelectorAll('.avatar, .name').forEach(node => node.removeAttribute('href'));
    // Assign image URLs through the DOM, never through an HTML style attribute.
    div.querySelectorAll<HTMLElement>('.avatar').forEach(avatar => {
      avatar.style.backgroundImage = cssImageUrl(userAvatar);
    });
    const cover = div.querySelector<HTMLElement>('.cover');
    if (cover) {
      cover.style.backgroundImage = cssImageUrl(activity.media?.coverImage?.medium);
    }
    return div;
  }

  /**
   * Fallback manual HTML rendering
   */
  private renderManualHTML(activity: AniListActivity, timeAgo: string, userName: string, userUrl: string): string {
    const isListActivity = activity.type?.includes('LIST');
    const isTextActivity = activity.type === 'TEXT';

    // XSS PROTECTION: Escape all user-provided and API data
    const userNameSafe = escapeHtml(userName);

    if (isListActivity) {
      const status = escapeHtml(activity.status?.toLowerCase() || 'watched');
      const progress = escapeHtml(activity.progress || '');
      const mediaTitle = activity.media?.title.romaji || 'Unknown';
      const mediaUrl = activity.media ? `/${activity.media.type.toLowerCase()}/${activity.media.id}` : '';
      const mediaTitleSafe = escapeHtml(mediaTitle);

      return `
        <div class="wrap">
          <div class="list">
            ${activity.media ? `<a href="${mediaUrl}" class="cover"></a>` : ''}
            <div class="details">
              <a href="${userUrl}" class="name">${userNameSafe}</a>
              <div class="status">
                ${status} ${progress ? `<strong>${progress}</strong>` : ''}
                ${activity.media ? `of <a href="${mediaUrl}" class="title">${mediaTitleSafe}</a>` : ''}
              </div>
              <a href="${userUrl}" class="avatar"></a>
            </div>
          </div>
          <div class="time">${timeAgo}</div>
          <div class="actions">
            <div class="action replies">
              ${activity.replyCount && activity.replyCount > 0 ? `<span class="count">${activity.replyCount}</span>` : ''}
              <i class="fa-solid fa-comments"></i>
            </div>
            <div class="action likes">
              ${activity.likeCount && activity.likeCount > 0 ? `<span class="count">${activity.likeCount}</span>` : ''}
              <i class="fa-solid fa-heart"></i>
            </div>
          </div>
        </div>
      `;
    } else if (isTextActivity) {
      const activityTextSafe = escapeHtml(activity.text || '');

      return `
        <div class="wrap">
          <div class="text-activity">
            <div class="details">
              <a href="${userUrl}" class="avatar"></a>
              <a href="${userUrl}" class="name">${userNameSafe}</a>
              <div class="text">${activityTextSafe}</div>
            </div>
          </div>
          <div class="time">${timeAgo}</div>
          <div class="actions">
            <div class="action replies">
              ${activity.replyCount && activity.replyCount > 0 ? `<span class="count">${activity.replyCount}</span>` : ''}
              <i class="fa-solid fa-comments"></i>
            </div>
            <div class="action likes">
              ${activity.likeCount && activity.likeCount > 0 ? `<span class="count">${activity.likeCount}</span>` : ''}
              <i class="fa-solid fa-heart"></i>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  /**
   * Show empty state message
   */
  showEmptyMessage(container: HTMLElement): void {
    container.innerHTML = `
      <div class="activity-entry" style="text-align:center; padding: 40px; font-size: 1.4rem; color: var(--color-text-lighter); background: var(--color-foreground); border-radius: 3px;">
        No activities found for the users in this list.
      </div>
    `;
  }

  /** A failed request is not a confirmed empty feed. Retry controls belong to this DOM. */
  showErrorMessage(container: HTMLElement, retry: () => void): void {
    container.innerHTML = '<div class="activity-entry" style="text-align:center; padding:40px; color:var(--color-text-lighter); background:var(--color-foreground); border-radius:3px;">Activities could not be loaded. <button type="button">Try again</button></div>';
    const button = container.querySelector<HTMLButtonElement>('button')!;
    button.addEventListener('click', () => {
      if (!container.isConnected || !container.contains(button) || button.disabled) return;
      button.disabled = true;
      retry();
    });
  }

  /**
   * Show loading spinner
   */
  showLoader(container: HTMLElement): void {
    container.innerHTML = `
      <div class="activity-entry" style="display: flex; justify-content: center; align-items: center; padding: 60px; font-size: 1.5rem; color: var(--color-text-lighter); background: var(--color-foreground); border-radius: 3px;">
        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 12px;"></i>
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
