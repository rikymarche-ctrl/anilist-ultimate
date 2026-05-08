/**
 * @file AnimeCard.ts
 * @description Individual anime card component with cover, episode info, and social overlay
 *
 * Renders an anime entry with cover image, title, episode/time display,
 * mark-watched action button, and optional friend activity avatar bubble.
 * Supports standard/compact/extended layout modes.
 *
 * @see DayColumn.ts for the parent container
 * @see CalendarSocialService.ts for friend activity data
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject, container } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import { SocialRenderer } from '../../social/SocialRenderer';
import { html } from '@core/utils/Template';
import type { AnimeEntry, CardOptions } from '@core/types';

interface AnimeCardProps {
  anime: AnimeEntry;
  options: CardOptions;
}

@injectable()
export class AnimeCard extends BaseComponent<AnimeCardProps> {
  private socialPortalController: AbortController | null = null;
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

      const content = this.getCardContent(anime, options);
      card.appendChild(content);
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
      (state: any) => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr: any, prev: any) => {
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

  /**
   * Surgical update logic to prevent full rerender flickering.
   */
  protected override onUpdate(prevProps: AnimeCardProps): boolean {
    const { anime: prevAnime, options: prevOptions } = prevProps;
    const { anime, options } = this.props;

    // 1. If options changed (layout mode, etc.), we need a full rerender
    if (JSON.stringify(prevOptions) !== JSON.stringify(options)) {
      return false; 
    }

    // 2. Surgical update for Anime data changes
    if (prevAnime.mediaId === anime.mediaId) {
      // Update Progress text
      const { episodeStr, isBehind } = this.getEpisodeString(anime);
      const episodeEl = this.element.querySelector('.anime-card__episode');
      if (episodeEl) {
        episodeEl.innerHTML = '';
        if (isBehind) {
          episodeEl.appendChild(html`<span class="behind-indicator"></span>`);
        }
        episodeEl.append(`Ep ${episodeStr}`);
      }

      // Update behind class
      this.toggleClass('anime-card--is-behind', isBehind);

      // Update status classes (aired/airing soon)
      this.toggleClass('anime-card--aired', this.calendarService.hasAired(anime));
      this.toggleClass('anime-card--airing-soon', this.calendarService.isAiringSoon(anime));

      // Update title if it changed (unlikely but possible)
      if (prevAnime.cleanTitle !== anime.cleanTitle) {
        const titleEl = this.element.querySelector('.anime-card__title');
        if (titleEl) titleEl.textContent = anime.cleanTitle;
      }

      // Social portal update (if activity changed)
      if (JSON.stringify(prevAnime.friendActivity) !== JSON.stringify(anime.friendActivity)) {
         this.destroySocialPortal();
         this.syncSocialPortal();
      }

      return true; // Handled surgically
    }

    return false; // Different anime or complex change, fallback to rerender
  }

  public override update(props: Partial<AnimeCardProps>): void {
    const prevProps = { ...this.props };

    // Update props first
    this.props = { ...this.props, ...props };

    if (this.shouldUpdate(prevProps, this.props)) {
      // Try surgical update
      if (!this.onUpdate(prevProps)) {
        // Fallback: Full Rerender
        this.destroySocialPortal();
        super.rerender();
        this.syncSocialPortal();
      }
    }
  }

  /**
   * Destroy social portal and its event bindings cleanly
   */
  private destroySocialPortal(): void {
    if (this.socialPortalController) {
      this.socialPortalController.abort();
      this.socialPortalController = null;
    }
  }

  private get socialRenderer(): SocialRenderer {
    return container.resolve<SocialRenderer>(TOKENS.SocialRenderer);
  }

  /**
   * Synchronize the social portal based on current preferences.
   * Always starts fresh (portal was destroyed before this call).
   */
  private syncSocialPortal(): void {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;
    const { anime } = this.props;

    // Only show portal on home page (BUG-035 fix)
    const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';

    if (socialEnabled && socialShowAvatars && isHomePage) {
      if (!this.socialPortalController) {
        this.socialPortalController = this.socialRenderer.attachPortal(
          this.element,
          anime.mediaId,
          anime.cleanTitle,
          anime.friendActivity || [],
          'ANIME'
        );
      }
    } else {
      this.destroySocialPortal();
    }
  }

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
   * Render action pill (mark watched, edit, optional social)
   */
  private renderActionPill(socialSection: HTMLElement | null, compact: boolean = false): HTMLElement {
    const compactClass = compact ? ' action-pill--compact' : '';
    const pill = html`
      <div class="action-pill${compactClass}" role="toolbar" aria-label="Anime actions">
        <button type="button" class="pill-section" data-action="mark-watched" aria-label="Mark episode as watched">
          <i class="fa fa-plus" aria-hidden="true"></i>
        </button>
      </div>
    `;

    if (this.props.options.astraEnabled) {
      pill.appendChild(html`<div class="pill-separator" aria-hidden="true"></div>`);
      pill.appendChild(html`
        <button type="button" class="pill-section" data-action="edit-entry" aria-label="Edit entry">
          <i class="fa fa-pencil" aria-hidden="true"></i>
        </button>
      `);
    }

    if (socialSection) {
      pill.appendChild(socialSection);
    }

    return pill;
  }

  private getCardContent(anime: AnimeEntry, options: CardOptions): HTMLElement {
    const { layoutMode, showTime, showEpisodeNumbers, timeFormat } = options;
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    const showPillSocial = socialEnabled && !socialShowAvatars;
    let socialSection: HTMLElement | null = null;
    
    if (showPillSocial) {
      const container = document.createElement('div');
      container.style.display = 'contents';
      container.appendChild(html`<div class="pill-separator"></div>`);
      container.appendChild(html`
        <div class="pill-section" data-action="social-activity">
          <i class="fa fa-users"></i>
        </div>
      `);
      socialSection = container;
    }

    // Calculate episode string
    const { episodeStr, isBehind } = this.getEpisodeString(anime);

    // Common elements
    const title = html`<h3 class="anime-card__title">${anime.cleanTitle}</h3>`;
    
    let episode: HTMLElement | null = null;
    if (showEpisodeNumbers) {
      episode = html`<span class="anime-card__episode"></span>`;
      if (isBehind) {
        episode.appendChild(html`<span class="behind-indicator"></span>`);
      }
      episode.append(`Ep ${episodeStr}`);
    }

    const time = showTime ? this.getTimeElement(anime, timeFormat) : null;

    // Layout-specific structure
    if (layoutMode === 'compact') {
      return html`
        <div style="display: contents;">
          <div class="anime-card__compact-content">
            ${title}
            <div class="anime-card__meta">
              ${episode}
              ${time}
            </div>
          </div>
          <div class="anime-card__action anime-card__action--compact">
            ${this.renderActionPill(socialSection, true)}
          </div>
        </div>
      `;
    }

    if (layoutMode === 'extended') {
      return html`
        <div class="anime-card__extended-layout">
          <div class="anime-card__cover">
            <img
              src="${anime.coverImage}"
              alt="${anime.cleanTitle}"
              loading="lazy"
              class="anime-card__image"
            />
          </div>
          <div class="anime-card__content">
            ${title}
            <div class="anime-card__details">
              <div class="anime-card__meta-row">
                ${episode}
                ${time}
              </div>
            </div>
          </div>
          <div class="anime-card__action anime-card__action--extended">
            ${this.renderActionPill(socialSection)}
          </div>
        </div>
      `;
    }

    return html`
      <div class="anime-card__container">
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
          ${title}
          <div class="anime-card__meta">
            ${episode}
            ${time}
          </div>
        </div>
        <div class="anime-card__action anime-card__action--standard">
          ${this.renderActionPill(socialSection)}
        </div>
      </div>
    `;
  }

  private getTimeElement(anime: AnimeEntry, timeFormat: 'release' | 'countdown'): HTMLElement {
    let timeText: string;

    if (timeFormat === 'countdown') {
      timeText = this.calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeText = this.calendarService.formatAiringTime(anime.airingAt);
    }

    return html`<span class="anime-card__time">${timeText}</span>`;
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
      detail: { mediaId: anime.mediaId, title: anime.cleanTitle, element: this.element, type: 'ANIME' }
    }));
  }

  private handleEditEntry(): void {
    const { anime } = this.props;
    const modal = container.resolve<any>(TOKENS.AstraRatingController);
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
   * Cleanup: remove portal on unmount
   */
  protected onUnmount(): void {
    // Use destroySocialPortal to ensure complete cleanup (removes bubble + aborts listeners)
    this.destroySocialPortal();
  }
}
