import { logger } from '@core/logger';
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

import { injectable, inject, delay } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { CalendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import { SocialRenderer } from '../../social/SocialRenderer';
import { AstraRatingModal } from '../../astra/ui/AstraRatingModal';
import { html } from '@core/utils/Template';
import type { AnimeEntry, CardOptions } from '@core/types';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { parseWebUrl } from '@core/utils/WebUrl';
import { availableEpisodes, formatAiringDay, isBeyondWeek } from '../CalendarAiring';

interface AnimeCardProps {
  anime: AnimeEntry;
  options: CardOptions;
}

@injectable()
export class AnimeCard extends BaseComponent<AnimeCardProps> {
  private socialPortalController: AbortController | null = null;
  private cachedActionPills: NodeListOf<HTMLElement> | null = null;
  private storeUnsubscribe: (() => void) | null = null;
  private viewVersion = 0;
  private viewContext: ApiContext | undefined;
  private tooltip: HTMLElement | null = null;
  private pressTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private markPending: object | null = null;

  constructor(
    @inject('AnimeCardProps') props: AnimeCardProps,
    @inject(TOKENS.CalendarStore) private store: CalendarStore,
    @inject(TOKENS.CalendarService) private calendarService: ICalendarService,
    @inject(delay(() => SocialRenderer)) private socialRenderer: SocialRenderer,
    @inject(delay(() => AstraRatingModal)) private ratingController: AstraRatingModal,
    @inject(TOKENS.ApiClient) private api: IApiClient,
  ) {
    super(props);
    // Re-render now that this.store is assigned (BaseComponent constructor calls render BEFORE this assignment)
    this.element = this.render();
  }

  protected render(): HTMLElement {
    if (!this.store) return this.createElement('div', { class: 'anime-card-loading' });
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
      if (anime.calendarKind === 'personal') classList.push('anime-card--personal-plan');

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

      const isBehind = (anime.progress || 0) < availableEpisodes(anime);
      if (isBehind) {
        card.classList.add('anime-card--is-behind');
      }

      const content = this.getCardContent(anime, options);
      card.appendChild(content);
      return card;
    } catch (error: unknown) {
      logger.error('[AnimeCard] Render failed', error);
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
    this.viewVersion++;
    const context = this.api.getContext?.();
    this.viewContext = context ? { ...context } : undefined;
    this.markPending = null;
    this.restoreMarkControl(this.element.querySelector<HTMLButtonElement>('[data-action="mark-watched"]'));
    // subscribeToSelector fires only when the relevant booleans actually change
    this.storeUnsubscribe = this.store.subscribeToSelector(
      state => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr, prev) => {
        if (!this.canInteract()) { this.destroySocialPortal(); this.hideCardTooltip(); return; }
        if (
          curr.socialEnabled !== prev.socialEnabled ||
          curr.socialShowAvatars !== prev.socialShowAvatars
        ) {
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
    if (prevAnime.mediaId === anime.mediaId && prevAnime.calendarKind === anime.calendarKind) {
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
      const image = this.element.querySelector<HTMLImageElement>('.anime-card__image');
      if (image) {
        const cover = parseWebUrl(anime.coverImage);
        if (cover) { if (image.getAttribute('src') !== cover.href) image.src = cover.href; }
        else image.removeAttribute('src');
        if (image.alt !== anime.cleanTitle) image.alt = anime.cleanTitle;
      }
      this.updateTime(options.timeFormat);

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

  /**
   * Synchronize the social portal based on current preferences.
   * Always starts fresh (portal was destroyed before this call).
   */
  private syncSocialPortal(): void {
    if (!this.canInteract()) return;
    const { socialEnabled, socialShowAvatars } = this.store.getState().preferences;
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
    const { socialEnabled, socialShowAvatars } = this.store.getState().preferences;
    const showPillSocial = socialEnabled && !socialShowAvatars;

    // Use cached query instead of querying every time
    this.getActionPills().forEach((pill) => {
      // Remove existing social separator + button (the separator immediately before the social btn)
      const existingSocialBtn = pill.querySelector<HTMLElement>('[data-action="social-activity"]');
      if (existingSocialBtn) {
        this.clearPressTimer(existingSocialBtn);
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
        socialBtn.innerHTML = '<i class="fa-solid fa-users" aria-hidden="true"></i>';

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
    const available = availableEpisodes(anime);
    const watched = anime.progress;
    const total = anime.totalEpisodes;
    const episodesBehind = Math.max(0, available - watched);
    const isBehind = episodesBehind > 0;

    let episodeStr: string;
    if (isBehind) {
      episodeStr = total ? `${watched}/${available}/${total}` : `${watched}/${available}`;
    } else {
      // Caught up
      if (total && total > 1) {
        episodeStr = `${watched}/${total}`;
      } else if (total === 1 && watched === 1) {
        episodeStr = '1';
      } else {
        episodeStr = `${watched}`;
      }
    }

    return { episodeStr, isBehind };
  }

  /**
   * Render action pill (mark watched, edit, optional social)
   */
  private renderActionPill(
    socialSection: HTMLElement | null,
    compact: boolean = false,
    personalPlan: boolean = false
  ): HTMLElement {
    const compactClass = `${compact ? ' action-pill--compact' : ''}${personalPlan ? ' action-pill--personal' : ''}`;
    const pill = html`
      <div class="action-pill${compactClass}" role="toolbar" aria-label="Anime actions">
        <button
          type="button"
          class="pill-section"
          data-action="mark-watched"
          aria-label="Mark episode as watched"
        >
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
      </div>
    `;

    if (this.props.options.astraEnabled) {
      pill.appendChild(html`<div class="pill-separator" aria-hidden="true"></div>`);
      pill.appendChild(html`
        <button type="button" class="pill-section" data-action="edit-entry" aria-label="Edit entry">
          <i class="fa-solid fa-pencil" aria-hidden="true"></i>
        </button>
      `);
    }

    if (personalPlan && this.props.options.onManagePersonalPlan) {
      pill.appendChild(html`<div class="pill-separator" aria-hidden="true"></div>`);
      pill.appendChild(html`<button type="button" class="pill-section" data-action="manage-personal-plan" aria-label="Manage personal calendar plan"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i></button>`);
    }

    if (socialSection) {
      pill.appendChild(socialSection);
    }

    return pill;
  }

  private getCardContent(anime: AnimeEntry, options: CardOptions): HTMLElement {
    const { layoutMode, showTime, showEpisodeNumbers, timeFormat } = options;
    const { socialEnabled, socialShowAvatars } = this.store.getState().preferences;

    const showPillSocial = socialEnabled && !socialShowAvatars;
    let socialSection: HTMLElement | null = null;

    if (showPillSocial) {
      const container = document.createElement('div');
      container.style.display = 'contents';
      container.appendChild(html`<div class="pill-separator"></div>`);
      container.appendChild(html`
        <button type="button" class="pill-section" data-action="social-activity" aria-label="View social activity">
          <i class="fa-solid fa-users" aria-hidden="true"></i>
        </button>
      `);
      socialSection = container;
    }

    // Calculate episode string
    const { episodeStr, isBehind } = this.getEpisodeString(anime);

    // Common elements
    const title = html`<h3 class="anime-card__title">${anime.cleanTitle}</h3>`;
    const badge = anime.calendarKind === 'personal'
      ? html`<span class="anime-card__personal-badge"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> Personal plan</span>`
      : null;

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
            ${title} ${badge}
            <div class="anime-card__meta">${episode} ${time}</div>
          </div>
          <div class="anime-card__action anime-card__action--compact">
            ${this.renderActionPill(socialSection, true, anime.calendarKind === 'personal')}
          </div>
        </div>
      `;
    }

    if (layoutMode === 'extended') {
      return html`
        <div class="anime-card__extended-layout">
          <div class="anime-card__cover">
            ${this.createCoverImage(anime)}
          </div>
          <div class="anime-card__content">
            ${title} ${badge}
            <div class="anime-card__details">
              <div class="anime-card__meta-row">${episode} ${time}</div>
            </div>
          </div>
          <div class="anime-card__action anime-card__action--extended">
            ${this.renderActionPill(socialSection, false, anime.calendarKind === 'personal')}
          </div>
        </div>
      `;
    }

    return html`
      <div class="anime-card__container">
        <div class="anime-card__image-container">
          ${this.createCoverImage(anime)}
          <div class="anime-card__image-overlay"></div>
        </div>
        <div class="anime-card__content">
          ${title} ${badge}
          <div class="anime-card__meta">${episode} ${time}</div>
        </div>
        <div class="anime-card__action anime-card__action--standard">
          ${this.renderActionPill(socialSection, false, anime.calendarKind === 'personal')}
        </div>
      </div>
    `;
  }

  private getTimeElement(anime: AnimeEntry, timeFormat: 'release' | 'countdown'): HTMLElement {
    return html`<span class="anime-card__time">${this.airingTimeText(anime, timeFormat)}</span>`;
  }

  /**
   * Time label for a card. Airings a week or more out show their real date, because the
   * weekday column alone is ambiguous. Countdown mode shows "Aired" once the airing time
   * has passed instead of clamping to "0m".
   */
  private airingTimeText(anime: AnimeEntry, timeFormat: 'release' | 'countdown'): string {
    const now = Date.now();
    if (isBeyondWeek(anime.airingAt, now)) {
      return `${formatAiringDay(anime.airingAt)} · ${this.calendarService.formatAiringTime(anime.airingAt)}`;
    }
    if (timeFormat === 'countdown') {
      if (anime.airingAt.getTime() <= now) return 'Aired';
      return this.calendarService.formatTimeUntilAiring(Math.floor((anime.airingAt.getTime() - now) / 1000));
    }
    return this.calendarService.formatAiringTime(anime.airingAt);
  }

  private createCoverImage(anime: AnimeEntry): HTMLImageElement {
    const image = this.createElement('img', { alt: anime.cleanTitle, loading: 'lazy', class: 'anime-card__image' });
    const cover = parseWebUrl(anime.coverImage);
    if (cover) image.src = cover.href;
    return image;
  }

  protected attachEvents(): void {
    // Delegate to the mounted root so preference changes do not retain old buttons.
    const actionFor = (event: Event): HTMLElement | null => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest<HTMLElement>('[data-action]') ?? null;
      return action && this.element.contains(action) ? action : null;
    };
    this.addEventListener(this.element, 'click', event => {
      if (!this.canInteract()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const avatar = target.closest<HTMLElement>('.friend-avatar');
      if (avatar && this.element.contains(avatar)) {
        event.stopPropagation(); event.preventDefault();
        const name = avatar.getAttribute('data-user-name');
        if (name?.trim()) {
          try { window.open(`/user/${encodeURIComponent(name)}`, '_blank', 'noopener,noreferrer'); }
          catch { /* Invalid UTF-16 names cannot identify a profile URL. */ }
        }
        return;
      }
      const action = actionFor(event);
      if (action) {
        event.stopPropagation(); event.preventDefault();
        if (action instanceof HTMLButtonElement && action.disabled) return;
        if (action.dataset.action === 'mark-watched' && this.markPending) return;
        this.pressAction(action);
        switch (action.dataset.action) {
          case 'mark-watched': void this.handleMarkWatched(); break;
          case 'edit-entry': this.handleEditEntry(); break;
          case 'social-activity': this.handleSocialActivity(); break;
          case 'manage-personal-plan': this.props.options.onManagePersonalPlan?.(this.props.anime.mediaId); break;
        }
        return;
      }
      if (target.closest('.au-social-wrapper')) return;
      const url = parseWebUrl(this.props.anime.siteUrl);
      if (!url) return;
      if (this.props.options.openInNewTab) window.open(url.href, '_blank', 'noopener,noreferrer');
      else window.open(url.href, '_self');
    });
    this.addEventListener(this.element, 'mouseenter', event => {
      const action = actionFor(event);
      if (!action || !(event instanceof MouseEvent)) return;
      if (event.relatedTarget instanceof Node && action.contains(event.relatedTarget)) return;
      switch (action.dataset.action) {
        case 'mark-watched': {
          const behind = Math.max(0, availableEpisodes(this.props.anime) - this.props.anime.progress);
          const remaining = behind - 1;
          const text = behind > 0
            ? remaining <= 0 ? "You'll be caught up!" : remaining === 1 ? '1 episode will remain' : `${remaining} episodes will remain`
            : `Mark episode ${this.props.anime.episode} as watched`;
          this.showCardTooltip(text, event); break;
        }
        case 'edit-entry': this.showCardTooltip('Quick edit', event); break;
        case 'social-activity': this.showCardTooltip('Social Activity', event); break;
        case 'manage-personal-plan': this.showCardTooltip('Manage personal plan', event); break;
      }
    }, true);
    this.addEventListener(this.element, 'mousemove', event => {
      if (actionFor(event) && event instanceof MouseEvent) this.moveCardTooltip(event);
    });
    this.addEventListener(this.element, 'mouseleave', event => {
      const action = actionFor(event);
      if (!action && event.target === this.element) { this.hideCardTooltip(); return; }
      if (!action || !(event instanceof MouseEvent)) return;
      if (event.relatedTarget instanceof Node && action.contains(event.relatedTarget)) return;
      this.hideCardTooltip();
    }, true);
  }

  private handleSocialActivity(): void {
    const { anime } = this.props;
    // Emit custom event for SocialSidebar to handle
    window.dispatchEvent(
      new CustomEvent('au-open-social-sidebar', {
        detail: {
          mediaId: anime.mediaId,
          title: anime.cleanTitle,
          element: this.element,
          type: 'ANIME',
        },
      })
    );
  }

  private handleEditEntry(): void {
    const { anime } = this.props;
    try { void Promise.resolve(this.ratingController.open(anime.mediaId)).catch(error => logger.error('[AnimeCard] Edit failed', error)); }
    catch (error) { logger.error('[AnimeCard] Edit failed', error); }
  }

  private async handleMarkWatched(): Promise<void> {
    const { anime, options } = this.props;
    if (!options.onMarkWatched || this.markPending || !this.canInteract()) return;
    const token = {}; this.markPending = token;
    const version = this.viewVersion;
    const root = this.element;
    const pillSection = root.querySelector<HTMLButtonElement>('[data-action="mark-watched"]');
    if (pillSection) {
      pillSection.disabled = true;
      pillSection.setAttribute('aria-busy', 'true');
      pillSection.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }
    try { await options.onMarkWatched(anime.mediaId); }
    catch (error) { logger.error('[AnimeCard] Mark watched failed', error); }
    finally {
      if (this.markPending === token && version === this.viewVersion && root === this.element
        && this.props.anime.mediaId === anime.mediaId && this.canInteract()) {
        this.markPending = null;
        if (pillSection && root.contains(pillSection)) this.restoreMarkControl(pillSection);
      }
    }
  }

  private restoreMarkControl(button: HTMLButtonElement | null): void {
    if (!button) return;
    button.disabled = false; button.removeAttribute('aria-busy'); button.style.pointerEvents = '';
    button.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
  }

  private canInteract(): boolean {
    if (!this.mounted || !this.element.isConnected) return false;
    if (!this.viewContext) return true;
    const current = this.api.getContext?.();
    return current?.sessionId === this.viewContext.sessionId && current.userId === this.viewContext.userId;
  }

  private clearPressTimer(button: HTMLElement): void {
    const timer = this.pressTimers.get(button);
    if (timer !== undefined) clearTimeout(timer);
    this.pressTimers.delete(button); button.classList.remove('au-pill-pressed');
  }

  private pressAction(button: HTMLElement): void {
    this.clearPressTimer(button); button.classList.add('au-pill-pressed');
    const version = this.viewVersion;
    const timer = setTimeout(() => {
      this.pressTimers.delete(button);
      if (version === this.viewVersion && this.canInteract() && this.element.contains(button)) button.classList.remove('au-pill-pressed');
    }, 300);
    this.pressTimers.set(button, timer);
  }

  private showCardTooltip(text: string, e: MouseEvent): void {
    if (!this.canInteract()) return;
    let tip = this.tooltip;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'au-card-tooltip';
      const target = document.body || document.documentElement;
      if (target) target.appendChild(tip);
      this.tooltip = tip;
    }
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 16}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }

  private moveCardTooltip(e: MouseEvent): void {
    const tip = this.canInteract() ? this.tooltip : null;
    if (tip) {
      tip.style.left = `${e.clientX + 16}px`;
      tip.style.top = `${e.clientY + 14}px`;
    }
  }

  private hideCardTooltip(): void {
    this.tooltip?.remove(); this.tooltip = null;
  }

  public updateTime(timeFormat: 'release' | 'countdown'): void {
    if (!this.canInteract()) return;
    const { episodeStr, isBehind } = this.getEpisodeString(this.props.anime);
    this.toggleClass('anime-card--is-behind', isBehind);
    this.toggleClass('anime-card--aired', this.calendarService.hasAired(this.props.anime));
    this.toggleClass('anime-card--airing-soon', this.calendarService.isAiringSoon(this.props.anime));
    const episode = this.element.querySelector('.anime-card__episode');
    if (episode && (episode.textContent !== `Ep ${episodeStr}` || !!episode.querySelector('.behind-indicator') !== isBehind)) {
      episode.replaceChildren();
      if (isBehind) episode.appendChild(html`<span class="behind-indicator"></span>`);
      episode.append(`Ep ${episodeStr}`);
    }
    const timeElement = this.element.querySelector('.anime-card__time');
    if (!timeElement) return;

    const text = this.airingTimeText(this.props.anime, timeFormat);
    if (timeElement.textContent !== text) timeElement.textContent = text;
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
    this.viewVersion++;
    this.markPending = null;
    for (const button of this.pressTimers.keys()) this.clearPressTimer(button);
    // The active action can disappear during a calendar refresh before it emits
    // mouseleave; hide the body-level tooltip as part of the card lifecycle.
    this.hideCardTooltip();

    // Use destroySocialPortal to ensure complete cleanup (removes bubble + aborts listeners)
    this.destroySocialPortal();

    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
  }
}
