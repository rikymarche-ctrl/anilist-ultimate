/**
 * Social Renderer Utility
 * Handles the creation and injection of social UI elements (avatars, buttons)
 */

import { FriendActivity } from '@core/types';
import { calendarStore } from '../calendar/CalendarStore';

export class SocialRenderer {
  /**
   * Creates the avatar stack HTML for a list of friend activities
   * Uses IMG tags instead of background-image for screen reader accessibility
   */
  public static getAvatarsHTML(activities: FriendActivity[], max: number = 3): string {
    const { socialShowAvatars } = calendarStore.getState().preferences;
    if (!socialShowAvatars || !activities || activities.length === 0) return '';

    // Render up to 50 for the stack effect
    const totalToRender = Math.min(activities.length, 50);
    let html = '<div class="au-social-stack">';

    for (let i = 0; i < totalToRender; i++) {
      const user = activities[i].user;
      const extraClass = i >= max ? 'au-social-avatar-extra' : '';
      const zIndex = 50 - i;

      // Use IMG tag for accessibility - screen readers can read alt text
      html += `<img
        src="${user.avatar.medium}"
        alt="${user.name}'s avatar"
        class="friend-avatar ${extraClass}"
        data-user-name="${user.name}"
        style="z-index:${zIndex}"
        loading="lazy"
        role="img"
        aria-label="${user.name}"
      />`;
    }

    // Show +X badge if there are more than max visible avatars
    if (activities.length > max) {
      const extraCount = Math.min(activities.length - max, 50 - max);
      html += `<div class="friend-avatar extra-count" style="z-index:5" role="presentation" aria-hidden="true">+${extraCount}</div>`;
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
   * @param card - The card element to inject into
   * @param mediaId - The media ID
   * @param activities - Friend activities to display
   * @param signal - Optional AbortSignal for cleanup (recommended to prevent memory leaks)
   */
  public static injectIntoCard(card: HTMLElement, mediaId: number, activities: FriendActivity[] = [], signal?: AbortSignal): void {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
    if (!socialEnabled || !socialShowAvatars) return;

    // 1. Remove existing wrapper to prevent duplicate listeners
    card.querySelector('.au-social-wrapper')?.remove();

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
    // Use signal if provided for automatic cleanup
    const listenerOptions = signal ? { signal } : undefined;

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
    }, listenerOptions);

    // 4. Attach event to button with signal for cleanup
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
      }, listenerOptions);
    }
  }
}
