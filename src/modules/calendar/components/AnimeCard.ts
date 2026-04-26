/**
 * Anime Card Component
 * Displays individual anime entry with cover, title, episode info
 */

import { injectable, inject, container } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import { SocialRenderer } from '../../social/SocialRenderer';
import type { AnimeEntry, CardOptions } from '@core/types';

interface AnimeCardProps {
  anime: AnimeEntry;
  options: CardOptions;
}

@injectable()
export class AnimeCard extends BaseComponent<AnimeCardProps> {
  private socialBubble: HTMLElement | null = null;
  /** AbortController for portal-related card hover listeners — aborted on destroySocialPortal() */
  private portalAbortController: AbortController | null = null;
  /** Cached DOM queries for performance - invalidated on render */
  private cachedActionPills: NodeListOf<HTMLElement> | null = null;

  constructor(
    @inject('AnimeCardProps') props: AnimeCardProps
  ) {
    super(props);
  }

  private get calendarService(): ICalendarService {
    return container.resolve<ICalendarService>(TOKENS.CalendarService);
  }

  protected render(): HTMLElement {
    // Invalidate cached queries on render
    this.cachedActionPills = null;

    try {
      const { anime, options } = this.props;
      const classList = [`anime-card`, `anime-card--${options.layoutMode}`];

      if (options.layoutMode === 'standard' && options.fullWidthImages) {
        classList.push('anime-card--full-width-images');
      }

      if (options.titleAlignment === 'center') {
        classList.push('anime-card--title-center');
      }

      const card = this.createElement('div', {
        class: classList.join(' '),
      });
      card.setAttribute('data-media-id', anime.mediaId.toString());

      // Add status classes
      if (this.calendarService.hasAired(anime)) {
        card.classList.add('anime-card--aired');
      } else if (this.calendarService.isAiringSoon(anime)) {
        card.classList.add('anime-card--airing-soon');
      }

      const isBehind = (anime.progress || 0) < anime.episode - 1;
      if (isBehind) {
        card.classList.add('anime-card--is-behind');
      }

      card.innerHTML = this.getCardHTML(anime, options);
      return card;
    } catch (error: unknown) {
      console.error('[AnimeCard] Render failed', error);
      const errEl = this.createElement('div', { class: 'anime-card anime-card--error' });
      const errorContainer = document.createElement('div');
      errorContainer.style.cssText = 'font-size: 9px; padding: 5px; color: #ff8888;';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errorContainer.textContent = `Render Error: ${errorMessage}`;
      errEl.appendChild(errorContainer);
      return errEl;
    }
  }

  protected onMount(): void {
    // subscribeToSelector fires only when the relevant booleans actually change
    calendarStore.subscribeToSelector(
      state => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr, prev) => {
        if (curr.socialEnabled !== prev.socialEnabled || curr.socialShowAvatars !== prev.socialShowAvatars) {
          // 1. Surgically patch the pill (immediate, no rerender needed)
          this.refreshPillSocialButton();
          // 2. Sync the floating portal
          this.destroySocialPortal();
          this.syncSocialPortal();
        }
      }
    );

    this.syncSocialPortal();
  }

  public override update(props: Partial<AnimeCardProps>): void {
    const prevProps = { ...this.props };

    // 1. Destroy portal BEFORE rerender so it's not left orphaned
    this.destroySocialPortal();

    // 2. Standard update cycle (calls rerender() which replaces this.element)
    super.update(props);

    // 3. Recreate portal linked to the new element, if needed
    if (this.shouldUpdate(prevProps, this.props)) {
      this.syncSocialPortal();
    }
  }

  /**
   * Destroy social portal and its event bindings cleanly
   */
  private destroySocialPortal(): void {
    if (this.socialBubble) {
      console.log('[AnimeCard] Destroying portal');
    }

    // Abort card hover listeners first (prevents stuck-visible bubble)
    this.portalAbortController?.abort();
    this.portalAbortController = null;

    if (this.socialBubble) {
      this.socialBubble.classList.remove('visible');
      this.socialBubble.remove();
      this.socialBubble = null;
    }
  }

  /**
   * Synchronize the social portal based on current preferences.
   * Always starts fresh (portal was destroyed before this call).
   */
  private syncSocialPortal(): void {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
    const { anime } = this.props;

    if (socialEnabled && socialShowAvatars) {
      // socialBubble is guaranteed null here (destroyed before update cycle)
      this.createSocialPortal(anime);
    }
    // If not enabled/avatars off: nothing to do, portal is already null
  }

  /**
   * Surgically update the social button inside the action pill(s) without full rerender.
   * Guaranteed immediate DOM update, bypasses shouldUpdate/JSON comparison.
   */
  /**
   * Get action pills with caching for performance
   */
  private getActionPills(): NodeListOf<HTMLElement> {
    if (!this.cachedActionPills) {
      this.cachedActionPills = this.element.querySelectorAll<HTMLElement>('.action-pill');
    }
    return this.cachedActionPills;
  }

  private refreshPillSocialButton(): void {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
    const showPillSocial = socialEnabled && !socialShowAvatars;

    // Use cached query instead of querying every time
    this.getActionPills().forEach(pill => {
      // Remove existing social separator + button (the separator immediately before the social btn)
      const existingSocialBtn = pill.querySelector<HTMLElement>('[data-action="social-activity"]');
      if (existingSocialBtn) {
        // The sibling immediately before it is the pill-separator
        existingSocialBtn.previousElementSibling?.remove();
        existingSocialBtn.remove();
      }

      if (showPillSocial) {
        const separator = document.createElement('div');
        separator.className = 'pill-separator';
        separator.setAttribute('aria-hidden', 'true');

        const socialBtn = document.createElement('button');
        socialBtn.type = 'button';
        socialBtn.className = 'pill-section';
        socialBtn.setAttribute('data-action', 'social-activity');
        socialBtn.setAttribute('aria-label', 'View social activity');
        socialBtn.innerHTML = '<i class="fa fa-users" aria-hidden="true"></i>';

        socialBtn.addEventListener('mouseenter', (e) => this.showCardTooltip('Social Activity', e));
        socialBtn.addEventListener('mousemove', (e) => this.moveCardTooltip(e));
        socialBtn.addEventListener('mouseleave', () => this.hideCardTooltip());
        socialBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.handleSocialActivity();
        });

        pill.appendChild(separator);
        pill.appendChild(socialBtn);
      }
    });
  }

  /**
   * Calculate episode display string
   * Format: "watched/available/total" or "watched/total" or "watched"
   */
  private getEpisodeString(anime: AnimeEntry): { episodeStr: string; isBehind: boolean } {
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

    return { episodeStr, isBehind };
  }

  /**
   * Render action pill HTML (mark watched, edit, optional social)
   */
  private renderActionPillHTML(socialSectionHTML: string, compact: boolean = false): string {
    const compactClass = compact ? ' action-pill--compact' : '';
    return `
      <div class="action-pill${compactClass}" role="toolbar" aria-label="Anime actions">
        <button type="button" class="pill-section" data-action="mark-watched" aria-label="Mark episode as watched">
          <i class="fa fa-plus" aria-hidden="true"></i>
        </button>
        <div class="pill-separator" aria-hidden="true"></div>
        <button type="button" class="pill-section" data-action="edit-entry" aria-label="Edit entry">
          <i class="fa fa-pencil" aria-hidden="true"></i>
        </button>
        ${socialSectionHTML}
      </div>
    `;
  }

  private getCardHTML(anime: AnimeEntry, options: CardOptions): string {
    const { layoutMode, showTime, showEpisodeNumbers, timeFormat } = options;
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    const showPillSocial = socialEnabled && !socialShowAvatars;
    const socialSectionHTML = showPillSocial ? `
      <div class="pill-separator"></div>
      <div class="pill-section" data-action="social-activity">
        <i class="fa fa-users"></i>
      </div>
    ` : '';

    // Calculate episode string
    const { episodeStr, isBehind } = this.getEpisodeString(anime);
    const behindDotHTML = isBehind ? `<span class="behind-indicator"></span>` : '';

    // Common elements
    const titleHTML = `<h3 class="anime-card__title">${anime.cleanTitle}</h3>`;
    const episodeHTML = showEpisodeNumbers
      ? `<span class="anime-card__episode">${behindDotHTML}Ep ${episodeStr}</span>`
      : '';
    const timeHTML = showTime ? this.getTimeHTML(anime, timeFormat) : '';

    // Layout-specific structure
    if (layoutMode === 'compact') {
      // Compact mode: MINIMAL - Only text, NO images
      return `
        <div class="anime-card__compact-content">
          ${titleHTML}
          <div class="anime-card__meta">
            ${episodeHTML}
            ${timeHTML}
          </div>
        </div>
        <div class="anime-card__action anime-card__action--compact">
          ${this.renderActionPillHTML(socialSectionHTML, true)}
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
            ${this.renderActionPillHTML(socialSectionHTML)}
          </div>
        </div>
      `;
    }

    // Standard layout: action pill is a SIBLING of image-container (not inside),
    // so it is not clipped by the image-container's overflow:hidden.
    // It stays within the card bounds and is positioned over the image area.
    const standardActionHTML = `
      <div class="anime-card__action anime-card__action--standard">
        ${this.renderActionPillHTML(socialSectionHTML)}
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

    if (timeFormat === 'countdown') {
      timeText = this.calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeText = this.calendarService.formatAiringTime(anime.airingAt);
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
    const modal = container.resolve<any>(TOKENS.AstraRatingModal);
    modal.open(anime.mediaId);
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

    if (timeFormat === 'countdown') {
      timeElement.textContent = this.calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeElement.textContent = this.calendarService.formatAiringTime(anime.airingAt);
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
    // Safety: destroy any existing portal first to prevent duplicates
    if (this.socialBubble) {
      console.error('[AnimeCard] DUPLICATE PORTAL DETECTED! Stack:', new Error().stack);
      this.destroySocialPortal();
    }

    console.log('[AnimeCard] Creating portal for:', anime.cleanTitle);

    // Create bubble element
    const bubble = document.createElement('div');
    bubble.className = 'au-social-bubble-portal';
    bubble.innerHTML = `
      ${SocialRenderer.getAvatarsHTML(anime.friendActivity || [])}
      ${SocialRenderer.getSocialButtonHTML()}
    `;

    document.body.appendChild(bubble);
    this.socialBubble = bubble;

    // Create a fresh AbortController for this portal's card-hover listeners
    this.portalAbortController = new AbortController();
    const { signal } = this.portalAbortController;

    // Handle mouse enter/leave on card — using { signal } so they're removed atomically on destroy
    this.element.addEventListener('mouseenter', () => {
      this.positionAndShowBubble();
    }, { signal });

    this.element.addEventListener('mouseleave', (e) => {
      // If mouse is going to the bubble itself, keep it visible
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (!relatedTarget || !bubble.contains(relatedTarget)) {
        bubble.classList.remove('visible');
      }
    }, { signal });

    // Keep bubble visible when hovering it — using { signal } for cleanup
    bubble.addEventListener('mouseenter', () => {
      bubble.classList.add('visible');
    }, { signal });

    bubble.addEventListener('mouseleave', () => {
      bubble.classList.remove('visible');
    }, { signal });

    // Handle avatar clicks — using { signal } for cleanup
    bubble.querySelectorAll('.friend-avatar').forEach(avatar => {
      avatar.addEventListener('click', (e) => {
        const userName = (avatar as HTMLElement).getAttribute('data-user-name');
        if (userName) {
          e.stopPropagation();
          window.open(`/user/${userName}`, '_blank');
        }
      }, { signal });
    });

    // Handle social button click — using { signal } for cleanup
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
      }, { signal });
    }
  }

  /**
   * Position and show the social bubble portal
   */
  private positionAndShowBubble(): void {
    if (!this.socialBubble) return;

    // Make bubble visible off-screen to calculate height
    this.socialBubble.style.left = '-9999px';
    this.socialBubble.style.top = '-9999px';
    this.socialBubble.style.transform = 'none';
    this.socialBubble.classList.add('visible');

    // Force reflow
    void this.socialBubble.offsetHeight;

    const cardRect = this.element.getBoundingClientRect();
    const bubbleHeight = this.socialBubble.offsetHeight;

    // Calculate center of card horizontally
    const cardCenterX = cardRect.left + (cardRect.width / 2);

    // Position above card
    let top = cardRect.top - bubbleHeight - 3; // 3px gap

    // Prevent from going off-screen vertically
    const padding = 10;
    if (top < padding) {
      top = cardRect.bottom + 3;
    }

    // Use transform to center perfectly - this ALWAYS centers regardless of bubble width
    this.socialBubble.style.left = `${cardCenterX}px`;
    this.socialBubble.style.top = `${top}px`;
    this.socialBubble.style.transform = 'translateX(-50%)';
  }

  /**
   * Cleanup: remove portal on unmount
   */
  protected onUnmount(): void {
    // Use destroySocialPortal to ensure complete cleanup (removes bubble + aborts listeners)
    this.destroySocialPortal();
  }
}
