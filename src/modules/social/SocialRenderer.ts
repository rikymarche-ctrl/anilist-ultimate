/**
 * Social Renderer Utility
 * Handles the creation and injection of social UI elements (avatars, buttons)
 */

import { FriendActivity } from '@core/types';
import { calendarStore } from '../calendar/CalendarStore';

export class SocialRenderer {
  /**
   * Creates the avatar stack HTML for a list of friend activities
   */
  public static getAvatarsHTML(activities: FriendActivity[], max: number = 3): string {
    const { socialShowAvatars } = calendarStore.getState().preferences;
    if (!socialShowAvatars || !activities || activities.length === 0) return '';
    
    // Render up to 50 for the grid effect
    const totalToRender = Math.min(activities.length, 50);
    let html = '<div class="au-social-stack">';
    
    for (let i = 0; i < totalToRender; i++) {
      const u = activities[i].user;
      const extraClass = i >= max ? 'au-social-avatar-extra' : '';
      html += `<div class="friend-avatar ${extraClass}" title="${u.name}" data-user-name="${u.name}" style="background-image:url(${u.avatar.medium}); z-index:${50-i}"></div>`;
    }
    
    if (activities.length > 50) {
      html += `<div class="friend-avatar extra-count" style="z-index:5">+${activities.length - 50}</div>`;
    }
    
    html += '</div>';
    return html;
  }

  /**
   * Creates a social activity trigger button
   */
  public static getSocialButtonHTML(): string {
    return `
      <div class="au-social-button" data-action="social-activity" title="View Social Activity">
        <i class="fa fa-users"></i>
      </div>
    `;
  }

  /**
   * Injects the social UI into a native AniList card
   */
  public static injectIntoCard(card: HTMLElement, mediaId: number, activities: FriendActivity[]): void {
    // 1. Remove existing if any
    card.querySelector('.au-social-wrapper')?.remove();

    if (activities.length === 0) return;

    // 2. Find target container (usually .cover or .image)
    const target = card.querySelector('.cover, .image, .image-container');
    if (!target) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'au-social-wrapper';
    wrapper.innerHTML = `
      ${this.getAvatarsHTML(activities)}
      ${this.getSocialButtonHTML()}
    `;

    target.appendChild(wrapper);

    // 3. Prevent bubble background clicks from triggering the card's navigation
    // but allowed specific elements (avatars and button) to work
    wrapper.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('friend-avatar')) {
        const userName = target.getAttribute('data-user-name');
        if (userName) {
          e.stopPropagation();
          window.open(`/user/${userName}`, '_blank');
        }
      } else {
        e.stopPropagation();
      }
    });

    // 4. Attach event to button
    const btn = wrapper.querySelector('.au-social-button');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const titleEl = card.querySelector('.title');
        const title = titleEl ? titleEl.textContent?.trim() || 'Anime' : 'Anime';

        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card }
        }));
      });
    }
  }
}
