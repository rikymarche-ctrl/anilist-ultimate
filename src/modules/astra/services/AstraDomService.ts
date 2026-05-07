/**
 * @file AstraDomService.ts
 * @description Dedicated service for Astra DOM manipulations and card enhancements.
 */

import { injectable, inject } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { PillUIBuilder } from '../ui/PillUIBuilder';
import { ICardEnhancementStrategy } from '../strategies/ICardEnhancementStrategy';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { calendarStore } from '@/modules/calendar/CalendarStore';
import { AstraService } from '../AstraService';

@injectable()
export class AstraDomService {
  constructor(
    @inject(TOKENS.AstraPillBuilder) private pillBuilder: PillUIBuilder,
    @inject(TOKENS.AstraStrategies) private strategies: ICardEnhancementStrategy[],
    @inject(TOKENS.AstraService) private astraService: AstraService,
    @inject(TOKENS.Config) private config: IConfigManager
  ) { }

  /**
   * Scans the current page and enhances matching media cards.
   */
  public enhanceCards(path: string): void {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(path)) {
        const cards = strategy.getCards();
        if (cards.length > 0) {
          log.debug(`[AstraDomService] Strategy "${strategy.name}" found ${cards.length} cards`);
        }
        
        cards.forEach(card => {
          if (strategy.shouldEnhanceCard(card)) {
            this.processCard(card, path);
          }
        });
      }
    }
  }

  /**
   * Processes a single card and injects the Astra action pill.
   */
  private processCard(card: HTMLElement, path: string): void {
    try {
      if (card.querySelector('.au-pill-wrapper') || card.hasAttribute('data-astra-processed')) {
        return;
      }

      // 1. Try to find the media link (prioritize card itself if it's an 'a' tag)
      let link = '';
      if (card.tagName.toLowerCase() === 'a') {
        link = card.getAttribute('href') || '';
      } else {
        const linkEl = card.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
        link = linkEl?.getAttribute('href') || '';
      }

      if (!link) return;

      const match = link.match(/\/(anime|manga)\/(\d+)/);
      if (!match) return;

      const mediaId = parseInt(match[2], 10);
      card.setAttribute('data-astra-processed', 'true');
      card.classList.add('au-astra-card');
      
      const state = calendarStore.getState();
      const { socialEnabled, socialShowAvatars } = state.preferences;
      const isUserListCard = path.includes('/animelist') || path.includes('/mangalist');

      // ROBUST TARGET SELECTION: Find the image container or the best relative ancestor
      const target = card.querySelector('.cover, .image, .img, .banner-image, [style*="background-image"]') || card;
      
      const summaries = this.astraService.getWorks();
      const workSummary = summaries.find(s => s.mediaId === mediaId);
      const score = workSummary ? workSummary.currentScore : null;

      this.pillBuilder.inject(target as HTMLElement, {
        mediaId,
        isUserListCard: isUserListCard || path === '/' || path === '/home',
        socialEnabled,
        socialShowAvatars,
        score,
        astraEnabled: this.config.isFeatureEnabled('astra')
      });
    } catch (error) {
      log.error('[AstraDomService] Failed to process card', error);
    }
  }

  /**
   * Injects the global Astra dashboard link into the AniList navbar.
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
}
