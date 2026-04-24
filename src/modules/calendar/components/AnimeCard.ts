/**
 * Anime Card Component
 * Displays individual anime entry with cover, title, episode info
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { CalendarService } from '../CalendarService';
import { SocialRenderer } from '../../social/SocialRenderer';
import type { AnimeEntry, CardOptions } from '@core/types';

interface AnimeCardProps {
  anime: AnimeEntry;
  options: CardOptions;
}

export class AnimeCard extends BaseComponent<AnimeCardProps> {
  private socialBubble: HTMLElement | null = null;

  protected render(): HTMLElement {
    const { anime, options } = this.props;
    const { layoutMode, fullWidthImages, titleAlignment } = options;

    const classList = [`anime-card`, `anime-card--${layoutMode}`];

    // Apply full width images class
    if (fullWidthImages) {
      classList.push('anime-card--full-width-images');
    }

    // Apply title alignment class
    if (titleAlignment === 'center') {
      classList.push('anime-card--title-center');
    }

    const card = this.createElement('div', {
      class: classList.join(' '),
    });

    card.setAttribute('data-media-id', anime.mediaId.toString());

    // Build card HTML
    card.innerHTML = this.getCardHTML(anime, options);

    // Add status classes
    const calendarService = container.resolve<CalendarService>(TOKENS.CalendarService);
    if (calendarService.hasAired(anime)) {
      card.classList.add('anime-card--aired');
    } else if (calendarService.isAiringSoon(anime)) {
      card.classList.add('anime-card--airing-soon');
    }

    // Add behind class — the red dot is rendered inside the episode text in getCardHTML
    const episodesBehind = Math.max(0, anime.episode - 1 - anime.progress);
    if (episodesBehind > 0) {
      card.classList.add('anime-card--is-behind');
    }

    return card;
  }

  protected onMount(): void {
    // Create social portal AFTER component is mounted
    const { anime } = this.props;
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    if (socialEnabled && socialShowAvatars) {
      this.createSocialPortal(anime);
    }
  }

  private getCardHTML(anime: AnimeEntry, options: CardOptions): string {
    const { layoutMode, showTime, showEpisodeNumbers, timeFormat } = options;
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    const showPillSocial = socialEnabled && !socialShowAvatars;
    // Social portal created in onMount(), not inline

    const socialSectionHTML = showPillSocial ? `
      <div class="pill-separator"></div>
      <div class="pill-section" data-action="social-activity">
        <i class="fa fa-users"></i>
      </div>
    ` : '';

    // Episode counter: "watched/available/total" (matches old version exactly)
    const available = anime.episode - 1;
    const watched = anime.progress;
    const total = anime.totalEpisodes;
    const episodesBehind = Math.max(0, available - watched);
    const isBehind = episodesBehind > 0;

    let episodeStr = "";
    if (isBehind) {
      episodeStr = total ? `${watched}/${available}/${total}` : `${watched}/${available}`;
    } else {
      // Caught up
      if (total && total > 1) {
        episodeStr = `${watched}/${total}`;
      } else if (total === 1 && watched === 1) {
        episodeStr = "1";
      } else {
        episodeStr = `${watched}`;
      }
    }

    // Red dot indicator (prepended), only when behind (no native title)
    const behindDotHTML = isBehind
      ? `<span class="behind-indicator"></span>`
      : '';

    // Common elements
    const titleHTML = `
      <h3 class="anime-card__title">${anime.cleanTitle}</h3>
    `;

    const episodeHTML = showEpisodeNumbers
      ? `<span class="anime-card__episode">${behindDotHTML}Ep ${episodeStr}</span>`
      : '';

    const timeHTML = showTime ? this.getTimeHTML(anime, timeFormat) : '';

    // Layout-specific structure
    if (layoutMode === 'compact') {
      // Compact mode: MINIMAL - Only text, NO images
      const actionPillHTML = `
        <div class="action-pill action-pill--compact">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      `;

      return `
        <div class="anime-card__compact-content">
          ${titleHTML}
          <div class="anime-card__meta">
            ${episodeHTML}
            ${timeHTML}
          </div>
        </div>
        <div class="anime-card__action anime-card__action--compact">
          ${actionPillHTML}
        </div>
      `;
    }

    if (layoutMode === 'extended') {
      // Extended mode: Vertical card with full-width cover (v2's old standard)
      const coverHTML = `
        <div class="anime-card__cover">
          <img
            src="${anime.coverImage}"
            alt="${anime.cleanTitle}"
            loading="lazy"
            class="anime-card__image"
          />
        </div>
      `;

      const actionPillHTML = `
        <div class="action-pill">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      `;

      return `
        <div class="anime-card__extended-layout">
          ${coverHTML}
          <div class="anime-card__content">
            ${titleHTML}
            <div class="anime-card__details">
              <div class="anime-card__meta-row">
                ${episodeHTML}
                ${timeHTML}
              </div>
            </div>
          </div>
          <div class="anime-card__action anime-card__action--extended">
            ${actionPillHTML}
          </div>
        </div>
      `;
    }

    // Standard layout: action pill is a SIBLING of image-container (not inside),
    // so it is not clipped by the image-container's overflow:hidden.
    // It stays within the card bounds and is positioned over the image area.
    const standardActionHTML = `
      <div class="anime-card__action anime-card__action--standard">
        <div class="action-pill">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      </div>
    `;

    const cardContentHTML = `
      <div class="anime-card__image-container">
        <img
          src="${anime.coverImage}"
          alt="${anime.cleanTitle}"
          loading="lazy"
          class="anime-card__image"
        />
        <div class="anime-card__image-overlay"></div>
      </div>
      <div class="anime-card__content">
        ${titleHTML}
        <div class="anime-card__meta">
          ${episodeHTML}
          ${timeHTML}
        </div>
      </div>
      ${standardActionHTML}
    `;

    return `
      <div class="anime-card__container">
        ${cardContentHTML}
      </div>
    `;
  }

  private getTimeHTML(anime: AnimeEntry, timeFormat: 'release' | 'countdown'): string {
    let timeText: string;

    const calendarService = container.resolve<CalendarService>(TOKENS.CalendarService);
    if (timeFormat === 'countdown') {
      timeText = calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeText = calendarService.formatAiringTime(anime.airingAt);
    }

    return `<span class="anime-card__time">${timeText}</span>`;
  }

  protected attachEvents(): void {
    // Card click - navigate to anime page (but NOT when clicking specific buttons)
    this.addEventListener(this.element, 'click', (e) => {
      const target = e.target as HTMLElement;

      // Handle avatar clicks first
      if (target.classList.contains('friend-avatar')) {
        const userName = target.getAttribute('data-user-name');
        if (userName) {
          e.stopPropagation();
          window.open(`/user/${userName}`, '_blank');
        }
        return;
      }

      // Only block if we clicked specifically on a button (pill-section)
      // or inside the social activity bubble
      if (target.closest('[data-action]') || target.closest('.au-social-wrapper')) {
        return;
      }

      // Check preference for opening tab
      const openInNewTab = this.props.options.openInNewTab;
      const windowTarget = openInNewTab ? '_blank' : '_self';

      window.open(this.props.anime.siteUrl, windowTarget);
    });

    // Action button click
    const markWatchedBtn = this.element.querySelector('[data-action="mark-watched"]');
    if (markWatchedBtn) {
      this.addEventListener(markWatchedBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleMarkWatched();
      });
    }

    // Edit button click
    const editBtn = this.element.querySelector('[data-action="edit-entry"]');
    if (editBtn) {
      this.addEventListener(editBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleEditEntry();
      });
    }

    // Social activity button click
    const socialBtn = this.element.querySelector('[data-action="social-activity"]');
    if (socialBtn) {
      this.addEventListener(socialBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleSocialActivity();
      });
    }

    // Tooltips for action buttons
    if (markWatchedBtn) {
      const lastAired = this.props.anime.episode - 1;
      this.addEventListener(markWatchedBtn as HTMLElement, 'mouseenter', (e) => {
        const episodesBehind = Math.max(0, lastAired - this.props.anime.progress);
        if (episodesBehind > 0) {
          const remaining = episodesBehind - 1;
          const text = remaining <= 0 ? "You'll be caught up!" :
            (remaining === 1 ? '1 episode will remain' : `${remaining} episodes will remain`);
          this.showCardTooltip(text, e);
        } else {
          const nextEp = this.props.anime.episode;
          this.showCardTooltip(`Mark episode ${nextEp} as watched`, e);
        }
      });
      this.addEventListener(markWatchedBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(markWatchedBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }

    if (editBtn) {
      this.addEventListener(editBtn as HTMLElement, 'mouseenter', (e) => {
        this.showCardTooltip('Quick edit', e);
      });
      this.addEventListener(editBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(editBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }

    if (socialBtn) {
      this.addEventListener(socialBtn as HTMLElement, 'mouseenter', (e) => {
        this.showCardTooltip('Social Activity', e);
      });
      this.addEventListener(socialBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(socialBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }
  }

  private handleSocialActivity(): void {
    const { anime } = this.props;
    // Emit custom event for SocialSidebar to handle
    window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
      detail: { mediaId: anime.mediaId, title: anime.cleanTitle, element: this.element }
    }));
  }

  private handleEditEntry(): void {
    const { anime } = this.props;
    const astraModal = container.resolve<any>(TOKENS.AstraRatingModal);
    astraModal.open(anime.mediaId);
  }

  private async handleMarkWatched(): Promise<void> {
    const { anime, options } = this.props;

    if (options.onMarkWatched) {
      const pillSection = this.element.querySelector(
        '[data-action="mark-watched"]'
      ) as HTMLElement;

      // Show loading spinner in pill
      if (pillSection) {
        pillSection.style.pointerEvents = 'none';
        pillSection.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      }

      try {
        await options.onMarkWatched(anime.mediaId);
        // Restore icon after success
        if (pillSection) {
          pillSection.style.pointerEvents = '';
          pillSection.innerHTML = '<i class="fa fa-plus"></i>';
        }
      } catch (error) {
        // Restore on error
        if (pillSection) {
          pillSection.style.pointerEvents = '';
          pillSection.innerHTML = '<i class="fa fa-plus"></i>';
        }
      }
    }
  }

  private showCardTooltip(text: string, e: MouseEvent): void {
    let tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'au-card-tooltip';
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 16}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }

  private moveCardTooltip(e: MouseEvent): void {
    const tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (tip) {
      tip.style.left = `${e.clientX + 16}px`;
      tip.style.top = `${e.clientY + 14}px`;
    }
  }

  private hideCardTooltip(): void {
    const tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (tip) tip.style.display = 'none';
  }


  public updateTime(timeFormat: 'release' | 'countdown'): void {
    const timeElement = this.element.querySelector('.anime-card__time');
    if (!timeElement) return;

    const { anime } = this.props;

    const calendarService = container.resolve<CalendarService>(TOKENS.CalendarService);
    if (timeFormat === 'countdown') {
      timeElement.textContent = calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeElement.textContent = calendarService.formatAiringTime(anime.airingAt);
    }
  }

  /**
   * Hide the card
   */
  public hide(): void {
    this.element.classList.add('anime-card--hidden');
  }

  /**
   * Show the card
   */
  public show(): void {
    this.element.classList.remove('anime-card--hidden');
  }

  /**
   * Create social bubble as portal (position: fixed outside calendar)
   */
  private createSocialPortal(anime: AnimeEntry): void {
    // Create bubble element
    const bubble = document.createElement('div');
    bubble.className = 'au-social-bubble-portal';
    bubble.innerHTML = `
      ${SocialRenderer.getAvatarsHTML(anime.friendActivity || [])}
      ${SocialRenderer.getSocialButtonHTML()}
    `;

    document.body.appendChild(bubble);
    this.socialBubble = bubble;

    // Handle mouse enter/leave on card
    this.addEventListener(this.element, 'mouseenter', () => {
      this.positionAndShowBubble();
    });

    this.addEventListener(this.element, 'mouseleave', (e) => {
      // Check if mouse is moving to bubble
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (!bubble.contains(relatedTarget)) {
        bubble.classList.remove('visible');
      }
    });

    // Keep bubble visible when hovering it
    bubble.addEventListener('mouseenter', () => {
      bubble.classList.add('visible');
    });

    bubble.addEventListener('mouseleave', () => {
      bubble.classList.remove('visible');
    });

    // Handle avatar clicks
    bubble.querySelectorAll('.friend-avatar').forEach(avatar => {
      avatar.addEventListener('click', (e) => {
        const userName = (avatar as HTMLElement).getAttribute('data-user-name');
        if (userName) {
          e.stopPropagation();
          window.open(`/user/${userName}`, '_blank');
        }
      });
    });

    // Handle social button click
    const socialBtn = bubble.querySelector('[data-action="social-activity"]');
    if (socialBtn) {
      socialBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: {
            mediaId: anime.mediaId,
            title: anime.cleanTitle,
            element: this.element
          }
        }));
      });
    }
  }

  /**
   * Position and show the social bubble portal
   */
  private positionAndShowBubble(): void {
    if (!this.socialBubble) return;

    const cardRect = this.element.getBoundingClientRect();
    const bubbleWidth = this.socialBubble.offsetWidth || 300;
    const bubbleHeight = this.socialBubble.offsetHeight || 100;

    // ALWAYS center the bubble on the card
    let left = cardRect.left + (cardRect.width / 2) - (bubbleWidth / 2);
    let top = cardRect.top - bubbleHeight - 3; // 3px gap

    // NO CLAMP - always keep centered even if it goes off-screen
    // const padding = 10;
    // const viewportWidth = window.innerWidth;
    // left = Math.max(padding, Math.min(left, viewportWidth - bubbleWidth - padding));

    // Prevent from going off-screen vertically (show below if not enough space above)
    const padding = 10;
    if (top < padding) {
      top = cardRect.bottom + 3;
    }

    this.socialBubble.style.left = `${left}px`;
    this.socialBubble.style.top = `${top}px`;
    this.socialBubble.classList.add('visible');
  }

  /**
   * Cleanup: remove portal on unmount
   */
  protected onUnmount(): void {
    if (this.socialBubble) {
      this.socialBubble.remove();
      this.socialBubble = null;
    }
  }
}
