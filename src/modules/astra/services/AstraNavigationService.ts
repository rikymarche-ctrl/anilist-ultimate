import { injectable, inject } from 'tsyringe';
import { AstraRoutingService } from './AstraRoutingService';

/**
 * Service responsible for Astra-related modifications to AniList's navigation and global UI.
 */
@injectable()
export class AstraNavigationService {
  constructor(
    @inject(AstraRoutingService) private routing: AstraRoutingService
  ) { }

  /**
   * Injects the global Astra dashboard link into the AniList navbar.
   */
  public injectNavbarButton(): boolean {
    const existing = document.querySelector('.au-astra-nav');

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
      if (existing) existing.remove();

      console.log('[Astra] Injecting indestructible link into:', linksContainer.className);
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

    // Inherit Vue attributes
    const sibling = container?.querySelector('.link') || document.querySelector('.nav .link');
    if (sibling) {
      const dataV = sibling.getAttributeNames().find(n => n.startsWith('data-v-'));
      if (dataV) astraLink.setAttribute(dataV, '');
    }

    this.ensureStyles();

    const logoSvg = `<svg viewBox="4.5 4 15 16" class="au-astra-logo-svg"><path d="M12 4L4.5 20H7L12 10.5L17 20H19.5L12 4Z"></path></svg>`;

    astraLink.innerHTML = `${logoSvg}<span class="au-astra-text">stra</span>`;

    const handleClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Astra] Navbar click intercepted!');
      this.routing.navigateToDashboard();
    };

    astraLink.addEventListener('click', handleClick, { capture: true });
    // Backup for some browser/router edge cases
    astraLink.onclick = handleClick;

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
    const topMoviesLink = document.querySelector('a[href*="top-movies"]');
    if (!topMoviesLink || topMoviesLink.parentElement?.querySelector('.au-seasonal-link')) return;

    const container = topMoviesLink.parentElement;
    const { season, year } = this.getCurrentSeason();

    const seasonalLink = document.createElement('a');
    seasonalLink.className = 'link au-seasonal-link';
    seasonalLink.href = `/search/anime?airing%20status=RELEASING&season=${season}&year=${year}`;
    seasonalLink.innerText = 'Seasonal';
    seasonalLink.style.marginLeft = '4px';

    (container as HTMLElement).style.display = 'flex';
    (container as HTMLElement).style.alignItems = 'center';
    topMoviesLink.insertAdjacentElement('afterend', seasonalLink);
  }

  /**
   * Replaces the native 'Add to List' button with Astra rater.
   */
  public hijackMediaButton(onOpen: (id: number) => void): void {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[2], 10);
    const btn = document.querySelector('.actions .list');

    if (btn && !btn.hasAttribute('data-astra-hijacked')) {
      btn.setAttribute('data-astra-hijacked', 'true');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpen(mediaId);
      }, { capture: true });
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
