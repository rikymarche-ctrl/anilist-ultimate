import { injectable, inject, type Disposable } from 'tsyringe';
import { AstraRoutingService } from './AstraRoutingService';
import { logger } from '@core/logger';
import { getMediaRoute } from '@core/navigation/MediaRoute';

interface MediaButtonBinding {
  button: HTMLElement;
  marker: string | null;
}

/**
 * Service responsible for Astra-related modifications to AniList's navigation and global UI.
 */
@injectable()
export class AstraNavigationService implements Disposable {
  private active = true;
  private disposed = false;
  private mediaButton: MediaButtonBinding | null = null;
  private mediaClickListener: EventListener | null = null;
  private onMediaOpen: ((id: number) => void | Promise<void>) | null = null;
  private mediaHoverListener: EventListener | null = null;
  private onMediaPrefetch: { start(id: number): void; cancel(): void } | null = null;
  private navbarBinding: { link: HTMLElement; listener: EventListener } | null = null;
  private readonly navbarOwner = crypto.randomUUID();
  constructor(@inject(AstraRoutingService) private routing: AstraRoutingService) {}

  /**
   * Injects the global Astra dashboard link into the AniList navbar.
   */
  public injectNavbarButton(): boolean {
    if (!this.active || this.disposed) return false;
    const existing =
      document.querySelector(`[data-astra-nav-owner="${this.navbarOwner}"]`) ||
      document.querySelector('.au-astra-nav');

    // Core AniList Nav Containers (Aggressive List)
    const linksContainer =
      document.querySelector('.nav .links') ||
      document.querySelector('.nav .wrap .links') ||
      document.querySelector('.links[data-v-62eacfff]') ||
      document.querySelector('#nav .links') ||
      document.querySelector('.nav .wrap') ||
      document.querySelector('.nav');

    if (linksContainer) {
      if (existing && existing.parentElement === linksContainer) return true;
      if (existing?.getAttribute('data-astra-nav-owner') === this.navbarOwner) existing.remove();
      this.releaseNavbarLink();

      logger.debug('[Astra] Injecting navbar link into:', linksContainer.className);
      const astraLink = this.createAstraLink(linksContainer as HTMLElement);

      const forumLink = linksContainer.querySelector('a[href*="/forum"]');
      if (forumLink) {
        forumLink.insertAdjacentElement('afterend', astraLink);
      } else {
        linksContainer.appendChild(astraLink);
      }
      return true;
    }
    return false;
  }

  /**
   * Helper to create the Astra navbar link element.
   */
  private createAstraLink(container?: HTMLElement): HTMLElement {
    const astraLink = document.createElement('a');
    astraLink.href = '/astra';
    astraLink.className = 'link au-astra-nav';
    astraLink.setAttribute('data-astra-nuclear', 'true');
    // Vue may clone this node; the instance token also identifies those copies
    // without treating an unrelated element with the same CSS class as ours.
    astraLink.setAttribute('data-astra-nav-owner', this.navbarOwner);

    // Inherit Vue attributes
    const sibling = container?.querySelector('.link') || document.querySelector('.nav .link');
    if (sibling) {
      const dataV = sibling.getAttributeNames().find((n) => n.startsWith('data-v-'));
      if (dataV) astraLink.setAttribute(dataV, '');
    }

    this.ensureStyles();

    const logoSvg = `<svg viewBox="4.5 4 15 16" class="au-astra-logo-svg"><path d="M12 4L4.5 20H7L12 10.5L17 20H19.5L12 4Z"></path><path d="M12 10.5L10.75 14.1H13.25L12 10.5Z"></path></svg>`;

    astraLink.innerHTML = `${logoSvg}<span class="au-astra-text">stra</span>`;

    const handleClick = (e: Event) => {
      // The global bridge may already have consumed this same native click.
      if (e.defaultPrevented || !this.active || this.disposed || !astraLink.isConnected) return;
      e.preventDefault();
      e.stopPropagation();
      logger.debug('[Astra] Navbar click intercepted');
      this.routing.navigateToDashboard();
    };

    astraLink.addEventListener('click', handleClick, { capture: true });
    // Backup for some browser/router edge cases
    astraLink.onclick = handleClick;
    this.navbarBinding = { link: astraLink, listener: handleClick };

    return astraLink;
  }

  /**
   * Ensures global styles for the Astra navbar link are injected.
   */
  private ensureStyles(): void {
    const existing = document.getElementById('au-astra-nav-v4-style');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'au-astra-nav-v4-style';
    style.textContent = `
      .au-astra-nav, 
      .au-astra-nav:hover,
      .au-astra-nav span.au-astra-text,
      .au-astra-nav svg.au-astra-logo-svg {
        color: var(--astra-accent, #8b5cf6) !important;
        background: transparent !important;
        background-color: transparent !important;
        text-decoration: none !important;
        box-shadow: none !important;
      }

      .au-astra-nav {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 16px !important;
        height: 100% !important;
        font-weight: 800 !important;
        text-transform: lowercase !important;
        cursor: pointer !important;
        position: relative !important;
        z-index: 100 !important;
        visibility: visible !important;
        opacity: 1 !important;
        transition: opacity 0.2s ease !important;
      }

      .au-astra-nav:hover {
        opacity: 0.7 !important;
      }

      .au-astra-logo-svg {
        width: 13.5px !important;
        height: 14px !important;
        display: inline-block !important;
        fill: currentColor !important;
        stroke: none !important;
        margin-right: -1px !important;
        transform: translateY(-2.2px) !important;
        position: relative !important;
        left: 4px !important;
      }

      .au-astra-text {
        color: var(--astra-accent, #8b5cf6) !important;
        display: inline !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Adds a 'Seasonal' link to the Browse dropdown.
   */
  public enhanceBrowseDropdown(): void {
    if (!this.active || this.disposed) return;
    const topMoviesLink = document.querySelector('a[href*="top-movies"]');
    if (!topMoviesLink || topMoviesLink.parentElement?.querySelector('.au-seasonal-link')) return;

    const container = topMoviesLink.parentElement;
    const dropdown = topMoviesLink.closest<HTMLElement>('.dropdown');
    const { season, year } = this.getCurrentSeason();

    const seasonalLink = document.createElement('a');
    seasonalLink.className = 'link au-seasonal-link';
    seasonalLink.href = `/search/anime?airing%20status=RELEASING&season=${season}&year=${year}`;
    seasonalLink.innerText = 'Seasonal';
    // AniList fixes the outer Browse menu width. A trailing margin on this link
    // only enlarges the row's overflow; it does not create visible room at the
    // menu edge. Expand the menu itself until 25px remain after the link.
    seasonalLink.style.whiteSpace = 'nowrap';
    seasonalLink.style.flexShrink = '0';

    (container as HTMLElement).style.display = 'flex';
    (container as HTMLElement).style.alignItems = 'center';
    (container as HTMLElement).style.flexWrap = 'nowrap';
    (container as HTMLElement).style.width = 'max-content';
    topMoviesLink.insertAdjacentElement('afterend', seasonalLink);

    if (dropdown) {
      const menuRect = dropdown.getBoundingClientRect();
      const linkRect = seasonalLink.getBoundingClientRect();
      const menuWidth = menuRect.width || Number.parseFloat(getComputedStyle(dropdown).width) || 0;
      const trailingSpace = menuRect.right - linkRect.right;
      if (menuWidth > 0 && trailingSpace < 25) {
        dropdown.style.width = `${menuWidth + 25 - trailingSpace}px`;
      }
    }
  }

  /**
   * Replaces the native 'Add to List' button with Astra rater.
   */
  public hijackMediaButton(
    onOpen: (id: number) => void | Promise<void>,
    onPrefetch?: { start(id: number): void; cancel(): void }
  ): void {
    if (!this.active || this.disposed) return;
    this.onMediaOpen = onOpen;
    this.onMediaPrefetch = onPrefetch ?? null;
    if (!this.mediaHoverListener) {
      // Hover intent warms the Quick Edit data so the click opens without a network wait.
      const listener: EventListener = (event) => {
        if (!this.active || this.disposed || this.mediaHoverListener !== listener) return;
        const target = event.target;
        const button =
          target instanceof Element ? target.closest<HTMLElement>('.actions .list') : null;
        if (!button) return;
        try {
          if (event.type === 'pointerout') {
            const next = (event as PointerEvent).relatedTarget;
            if (!(next instanceof Node && button.contains(next))) this.onMediaPrefetch?.cancel();
            return;
          }
          const route = getMediaRoute(window.location.pathname);
          if (route && route.id <= 2147483647) this.onMediaPrefetch?.start(route.id);
        } catch {
          /* Prefetch is best-effort; the click still loads. */
        }
      };
      this.mediaHoverListener = listener;
      window.addEventListener('pointerover', listener, { capture: true, passive: true });
      window.addEventListener('pointerout', listener, { capture: true, passive: true });
    }
    if (!this.mediaClickListener) {
      const listener: EventListener = (event) => {
        if (!this.active || this.disposed || this.mediaClickListener !== listener) return;
        const target = event.target;
        const button =
          target instanceof Element ? target.closest<HTMLElement>('.actions .list') : null;
        const route = getMediaRoute(window.location.pathname);
        if (
          !route ||
          route.id > 2147483647 ||
          !button?.isConnected ||
          document.querySelector('.actions .list') !== button
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          Promise.resolve(this.onMediaOpen?.(route.id)).catch(() =>
            logger.error('[Astra] Rating open failed')
          );
        } catch {
          logger.error('[Astra] Rating open failed');
        }
      };
      this.mediaClickListener = listener;
      // Vue replaces/clones media buttons between routes. Delegate before its
      // native handlers and resolve the current work at click time.
      window.addEventListener('click', listener, true);
    }
    const route = getMediaRoute(window.location.pathname);
    const button = document.querySelector<HTMLElement>('.actions .list');
    if (!route || route.id > 2147483647 || !button) {
      this.releaseMediaButton();
      return;
    }
    if (this.mediaButton?.button === button) return;
    this.releaseMediaButton();
    this.mediaButton = { button, marker: button.getAttribute('data-astra-hijacked') };
    button.setAttribute('data-astra-hijacked', 'true');
  }

  private releaseMediaButton(): void {
    const binding = this.mediaButton;
    this.mediaButton = null;
    if (!binding) return;
    if (binding.button.getAttribute('data-astra-hijacked') === 'true') {
      if (binding.marker === null) binding.button.removeAttribute('data-astra-hijacked');
      else binding.button.setAttribute('data-astra-hijacked', binding.marker);
    }
  }

  private releaseNavbarLink(): void {
    const binding = this.navbarBinding;
    this.navbarBinding = null;
    if (binding) {
      binding.link.removeEventListener('click', binding.listener, true);
      if (binding.link.onclick === binding.listener) binding.link.onclick = null;
      binding.link.removeAttribute('href');
      binding.link.remove();
    }
    document.querySelectorAll(`[data-astra-nav-owner="${this.navbarOwner}"]`).forEach((link) => {
      link.removeAttribute('href');
      link.remove();
    });
  }

  public activate(): void {
    if (!this.disposed) this.active = true;
  }
  public deactivate(): void {
    this.active = false;
    if (this.mediaClickListener) window.removeEventListener('click', this.mediaClickListener, true);
    this.mediaClickListener = null;
    this.onMediaOpen = null;
    if (this.mediaHoverListener) {
      window.removeEventListener('pointerover', this.mediaHoverListener, true);
      window.removeEventListener('pointerout', this.mediaHoverListener, true);
    }
    this.mediaHoverListener = null;
    this.onMediaPrefetch = null;
    this.releaseMediaButton();
    this.releaseNavbarLink();
  }
  public dispose(): void {
    if (!this.disposed) {
      this.deactivate();
      this.disposed = true;
    }
  }

  private getCurrentSeason(): { season: string; year: number } {
    const date = new Date();
    const month = date.getMonth();
    let season = 'WINTER';
    if (month >= 3 && month <= 5) season = 'SPRING';
    else if (month >= 6 && month <= 8) season = 'SUMMER';
    else if (month >= 9 && month <= 11) season = 'FALL';
    return { season, year: date.getFullYear() };
  }
}
