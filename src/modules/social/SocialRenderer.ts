/**
 * @file SocialRenderer.ts
 * @description Static utility class for rendering social avatars and action buttons
 *
 * Creates avatar stack elements with +N overflow badge, profile click
 * handlers, and "View Social" buttons. Used by SocialEnhancerModule
 * to inject social overlays onto native AniList media cards.
 *
 * @see SocialEnhancerModule.ts for the integration layer
 * @see docs/MODULES.md#10-social-enhancer-module
 */

import { calendarStore } from '../calendar/CalendarStore';
import { FriendActivity, MediaType } from '@core/types';

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
  /**
   * Creates a social bubble portal attached to a card
   * @returns AbortController for cleanup
   */
  public static attachPortal(
    card: HTMLElement,
    mediaId: number,
    title: string,
    activities: FriendActivity[],
    mediaType: MediaType
  ): AbortController {
    const abortController = new AbortController();
    const { signal } = abortController;

    let bubble: HTMLElement | null = null;

    const destroyBubble = () => {
      if (bubble) {
        bubble.remove();
        bubble = null;
      }
    };

    const positionAndShow = () => {
      if (!bubble) return;
      
      // Use absolute positioning relative to document to scroll WITH the page
      bubble.style.position = 'absolute';
      bubble.style.left = '-9999px';
      bubble.style.top = '-9999px';
      bubble.style.transform = 'none';
      bubble.style.zIndex = '3000';
      bubble.classList.add('visible');

      // Force reflow
      void bubble.offsetHeight;

      const cardRect = card.getBoundingClientRect();
      const bubbleHeight = bubble.offsetHeight;
      const cardCenterX = cardRect.left + (cardRect.width / 2);

      // Position above card
      let top = cardRect.top - bubbleHeight - 3; // 3px gap
      
      // Prevent from going off-screen vertically
      const padding = 10;
      if (top + window.scrollY < padding) {
        top = cardRect.bottom + 3;
      }

      bubble.style.left = `${cardCenterX + window.scrollX}px`;
      bubble.style.top = `${top + window.scrollY}px`;
      bubble.style.transform = 'translateX(-50%)';
    };

    const createBubble = () => {
      if (bubble) return;
      
      bubble = document.createElement('div');
      bubble.className = 'au-social-bubble-portal';
      bubble.innerHTML = `
        ${this.getAvatarsHTML(activities)}
        ${this.getSocialButtonHTML()}
      `;
      document.body.appendChild(bubble);

      // Hover on bubble itself keeps it visible
      bubble.addEventListener('mouseenter', () => {
        bubble?.classList.add('visible');
      }, { signal });

      bubble.addEventListener('mouseleave', () => {
        bubble?.classList.remove('visible');
      }, { signal });

      // Handle avatar clicks
      bubble.querySelectorAll('.friend-avatar').forEach(avatar => {
        avatar.addEventListener('click', (e) => {
          const userName = (avatar as HTMLElement).getAttribute('data-user-name');
          if (userName) {
            e.stopPropagation();
            window.open(`/user/${userName}`, '_blank');
          }
        }, { signal });
      });

      // Handle social button click
      const socialBtn = bubble.querySelector('[data-action="social-activity"]');
      if (socialBtn) {
        socialBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
            detail: { mediaId, title, element: card, type: mediaType }
          }));
        }, { signal });
      }
    };

    card.addEventListener('mouseenter', () => {
      const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
      if (!socialEnabled || !socialShowAvatars) return;

      createBubble();
      positionAndShow();
    }, { signal });

    card.addEventListener('mouseleave', (e) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (bubble && (!relatedTarget || !bubble.contains(relatedTarget))) {
        bubble.classList.remove('visible');
      }
    }, { signal });

    // Cleanup on signal abort
    signal.addEventListener('abort', () => {
      destroyBubble();
    });

    return abortController;
  }
}
