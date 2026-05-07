import { injectable } from 'tsyringe';

/**
 * Service responsible for Astra-related modifications to AniList's navigation and global UI.
 */
@injectable()
export class AstraNavigationService {
  /**
   * Injects the global Astra dashboard link into the AniList navbar.
   * @param onClick Callback when the astra link is clicked
   */
  public injectNavbarButton(onClick: () => void): boolean {
    let navLinks = document.querySelector('.nav .links')
      || document.querySelector('.header .links')
      || document.querySelector('.nav-wrap .links');

    if (!navLinks) {
      const browseLink = document.querySelector('a[href^="/browse"]') || document.querySelector('a.link[href*="browse"]');
      navLinks = browseLink?.parentElement || null;
    }

    if (!navLinks || navLinks.querySelector('.au-astra-nav')) return !!navLinks?.querySelector('.au-astra-nav');

    const astraLink = document.createElement('a');
    astraLink.className = 'link au-astra-nav';
    astraLink.href = '/astra';
    astraLink.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px; height: 16px; margin-right: -2px;">
        <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
      </svg>
      <span class="desktop">stra</span>
    `;

    astraLink.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });

    navLinks.appendChild(astraLink);
    return true;
  }

  /**
   * Adds a 'Seasonal' link to the Browse dropdown for quick access.
   */
  public enhanceBrowseDropdown(): void {
    let topMoviesLink = document.querySelector('a[href="/search/anime/top-movies"]') || document.querySelector('a[href*="top-movies"]');
    if (!topMoviesLink) {
      topMoviesLink = Array.from(document.querySelectorAll('a')).find(a => a.innerText.trim() === 'Top Movies') || null;
    }
    if (!topMoviesLink) return;

    const container = topMoviesLink.parentElement;
    if (!container || container.querySelector('.au-seasonal-link')) return;

    const { season, year } = this.getCurrentSeason();
    const seasonalLink = document.createElement('a');
    seasonalLink.className = 'link au-seasonal-link';
    seasonalLink.href = `/search/anime?airing%20status=RELEASING&season=${season}&year=${year}`;
    seasonalLink.innerText = 'Seasonal';
    seasonalLink.style.marginLeft = '4px';
    seasonalLink.style.display = 'inline-block';

    (container as HTMLElement).style.display = 'flex';
    (container as HTMLElement).style.alignItems = 'center';

    topMoviesLink.insertAdjacentElement('afterend', seasonalLink);

    const dropdown = container.closest('.dropdown, .menu, .nav-dropdown, .dropdown-wrap') as HTMLElement;
    if (dropdown) {
      dropdown.style.setProperty('width', 'max-content', 'important');
      dropdown.style.setProperty('min-width', 'max-content', 'important');
    }
  }

  /**
   * Replaces the native 'Add to List' or 'Edit' button on media pages with Astra rater.
   */
  public hijackMediaButton(onOpen: (id: number) => void): void {
    const path = window.location.pathname;
    const match = path.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[2], 10);
    const btn = document.querySelector('.header .actions .list') || document.querySelector('.actions .list');
    
    if (btn && !btn.hasAttribute('data-astra-hijacked')) {
      btn.setAttribute('data-astra-hijacked', 'true');
      btn.classList.add('au-astra-hijacked-btn');
      
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpen(mediaId);
      }, { capture: true });
    }
  }

  private getCurrentSeason(): { season: string; year: number } {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth();
    let season = 'WINTER';
    if (month >= 3 && month <= 5) season = 'SPRING';
    else if (month >= 6 && month <= 8) season = 'SUMMER';
    else if (month >= 9 && month <= 11) season = 'FALL';
    return { season, year };
  }
}
