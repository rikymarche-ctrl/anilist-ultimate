/**
 * @file SocialRenderer.ts
 * @description Service for rendering social avatars and action buttons on media cards.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { PreferencesService } from '@core/services/PreferencesService';
import { FriendActivity, MediaType } from '@core/types';
import { html } from '@core/utils/Template';
import { parseWebUrl } from '@core/utils/WebUrl';

/**
 * Service responsible for creating and attaching social UI elements to the AniList interface.
 */
@injectable()
export class SocialRenderer {
  constructor(
    @inject(TOKENS.PreferencesService) private preferences: PreferencesService
  ) {}

  /**
   * Creates the avatar stack element for a list of friend activities.
   */
  public getAvatarsElement(activities: FriendActivity[], max: number = 3, signal?: AbortSignal, owner?: HTMLElement): HTMLElement | null {
    if (!this.preferences.getPreferences().socialShowAvatars || !activities || activities.length === 0) {
      return null;
    }

    const totalToRender = Math.min(activities.length, 50);
    const container = html`<div class="au-social-stack"></div>`;

    for (let i = 0; i < totalToRender; i++) {
      const user = activities[i].user;
      const extraClass = i >= max ? 'au-social-avatar-extra' : '';
      const zIndex = 50 - i;
      const imageUrl = parseWebUrl(user.avatar.medium)?.href || '';

      const img = html`
        <img
          src="${imageUrl}"
          alt="${user.name}'s avatar"
          class="friend-avatar ${extraClass}"
          data-user-name="${user.name}"
          style="z-index:${zIndex}"
          loading="lazy"
          role="img"
          aria-label="${user.name}"
        />
      `;
      if (!imageUrl) img.removeAttribute('src');
      
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const prefs = this.preferences.getPreferences();
        if (!img.isConnected || (owner && !owner.isConnected) || signal?.aborted || !prefs.socialEnabled || !prefs.socialShowAvatars) return;
        window.open(`/user/${encodeURIComponent(user.name)}`, '_blank', 'noopener,noreferrer');
      }, { signal });
      
      container.appendChild(img);
    }

    if (activities.length > max) {
      const extraCount = Math.min(activities.length - max, 50 - max);
      container.appendChild(html`
        <div class="friend-avatar extra-count" style="z-index:5" role="presentation" aria-hidden="true">
          +${extraCount}
        </div>
      `);
    }

    return container;
  }

  /**
   * Creates a social activity trigger button.
   */
  public getSocialButton(onClick: () => void, signal?: AbortSignal): HTMLElement {
    const btn = html`
      <div class="au-social-button" data-action="social-activity" title="View Social Activity">
        <i class="fa-solid fa-users"></i>
      </div>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!btn.isConnected || signal?.aborted || !this.preferences.getPreferences().socialEnabled) return;
      onClick();
    }, { signal });
    return btn;
  }

  /**
   * Attaches a social bubble portal to a card.
   * @returns AbortController for cleanup
   */
  public attachPortal(
    card: HTMLElement,
    mediaId: number,
    title: string,
    activities: FriendActivity[],
    mediaType: MediaType
  ): AbortController {
    const abortController = new AbortController();
    const { signal } = abortController;

    let bubble: HTMLElement | null = null;
    let bubbleController: AbortController | null = null;

    const destroyBubble = () => {
      bubbleController?.abort(); bubbleController = null;
      if (bubble) {
        bubble.remove();
        bubble = null;
      }
    };

    const positionAndShow = () => {
      if (!bubble) return;
      
      bubble.style.position = 'absolute';
      bubble.style.left = '-9999px';
      bubble.style.top = '-9999px';
      bubble.style.transform = 'none';
      bubble.style.zIndex = '3000';
      bubble.classList.add('visible');

      void bubble.offsetHeight;

      const cardRect = card.getBoundingClientRect();
      const bubbleHeight = bubble.offsetHeight;
      const cardCenterX = cardRect.left + (cardRect.width / 2);

      let top = cardRect.top - bubbleHeight - 3;
      const padding = 10;
      if (top + window.scrollY < padding) {
        top = cardRect.bottom + 3;
      }

      bubble.style.left = `${cardCenterX + window.scrollX}px`;
      bubble.style.top = `${top + window.scrollY}px`;
      bubble.style.transform = 'translateX(-50%)';
    };

    const createBubble = () => {
      if (bubble?.isConnected) return;
      destroyBubble();
      bubbleController = new AbortController();
      const bubbleSignal = bubbleController.signal;
      
      bubble = html`<div class="au-social-bubble-portal"></div>`;
      
      const avatars = this.getAvatarsElement(activities, 3, bubbleSignal, card);
      if (avatars) bubble.appendChild(avatars);
      
      const btn = this.getSocialButton(() => {
        if (!card.isConnected || !this.preferences.getPreferences().socialShowAvatars) return;
        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card, type: mediaType }
        }));
      }, bubbleSignal);
      bubble.appendChild(btn);
      
      const target = document.body || document.documentElement;
      if (target) target.appendChild(bubble);

      bubble.addEventListener('mouseenter', () => {
        bubble?.classList.add('visible');
      }, { signal: bubbleSignal });

      bubble.addEventListener('mouseleave', () => {
        bubble?.classList.remove('visible');
      }, { signal: bubbleSignal });
    };

    card.addEventListener('mouseenter', () => {
      const prefs = this.preferences.getPreferences();
      if (!card.isConnected || !prefs.socialEnabled || !prefs.socialShowAvatars) return;

      createBubble();
      positionAndShow();
    }, { signal });

    card.addEventListener('mouseleave', (e) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (bubble && (!relatedTarget || !bubble.contains(relatedTarget))) {
        bubble.classList.remove('visible');
      }
    }, { signal });

    signal.addEventListener('abort', () => destroyBubble(), { once: true });

    return abortController;
  }
}
