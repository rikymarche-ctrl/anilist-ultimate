/**
 * @file AstraEnhancementService.ts
 * @description Dedicated service for media card enhancements and pill injections.
 */

import { injectable, inject, delay } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { PillUIBuilder } from '../ui/PillUIBuilder';
import { ICardEnhancementStrategy } from '../strategies/ICardEnhancementStrategy';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { PreferencesService } from '@core/services/PreferencesService';

/**
 * Service responsible for scanning the AniList DOM and injecting Astra action pills.
 * Coordinates multiple enhancement strategies to ensure context-aware UI injection.
 */
@injectable()
export class AstraEnhancementService {
  private static readonly HOME_PROGRESS_DISABLED_SECTIONS = [
    'trending anime & manga',
    'newly added anime',
    'newly added manga'
  ];

  /**
   * Initializes the AstraEnhancementService.
   *
   * @param pillBuilder The UI builder for creating action pills.
   * @param strategies The strategies used for matching and enhancing media cards.
   * @param config The configuration manager for feature flags.
   * @param preferences The service for retrieving user preferences.
   */
  constructor(
    @inject(TOKENS.AstraPillBuilder) private pillBuilder: PillUIBuilder,
    @inject(TOKENS.AstraStrategies) private strategies: ICardEnhancementStrategy[],
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.PreferencesService) private preferences: PreferencesService
  ) {}

  /**
   * Scans the current page and enhances matching media cards using registered strategies.
   *
   * @param path The current URL path to match against strategies.
   */
  public enhanceCards(path: string): void {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(path)) {
        const cards = strategy.getCards();
        if (cards.length > 0) {
          log.debug(
            `[AstraEnhancementService] Strategy "${strategy.name}" found ${cards.length} cards`
          );
        }

        cards.forEach((card) => {
          if (strategy.shouldEnhanceCard(card)) {
            this.processCard(card, path);
          }
        });
      }
    }
  }

  /**
   * Processes a single card element and injects the secure Astra action pill.
   *
   * @param card The native HTMLElement of the AniList media card.
   * @param path The current URL path for context-aware injection logic.
   * @private
   */
  private processCard(card: HTMLElement, path: string): void {
    try {
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

      // Check for existing pill and see if it matches current media
      const existingWrapper = card.querySelector('.au-pill-wrapper');
      if (existingWrapper) {
        const existingId = parseInt(existingWrapper.getAttribute('data-au-media-id') || '0', 10);
        if (existingId === mediaId) {
          return; // Already processed for THIS media
        } else {
          existingWrapper.remove(); // Stale pill from reused element
        }
      }

      card.setAttribute('data-astra-processed', 'true');
      card.classList.add('au-astra-card');

      const { socialEnabled, socialShowAvatars } = this.preferences.getPreferences();
      const isHome = path === '/' || path.startsWith('/home') || path.endsWith('/astra');
      const isUserList = this.shouldShowProgressAction(card, path, isHome);

      const cover = card.querySelector('.cover, .image, .img, .banner-image');
      const target = cover || card;

      const astraFeatureFlag = this.config.isFeatureEnabled('astra');

      const options = {
        mediaId,
        isUserListCard: isUserList,
        socialEnabled,
        socialShowAvatars,
        astraEnabled: astraFeatureFlag,
      };

      log.debug(`[Astra] Injecting pill for ${mediaId} into:`, target.className);
      const wrapper = this.pillBuilder.inject(target as HTMLElement, options);

      if (!wrapper) {
        log.warn(`[AstraEnhancer] Failed to inject pill for media ${mediaId}`);
      }
    } catch (error) {
      log.error(`[AstraEnhancer] Error processing card`, error);
    }
  }

  /**
   * Refreshes all existing Astra pills on the page to reflect preference changes.
   * Uses secure DOM manipulation via the PillUIBuilder.
   */
  public refreshAllPills(): void {
    const wrappers = document.querySelectorAll('.au-pill-wrapper');
    const { socialEnabled, socialShowAvatars } = this.preferences.getPreferences();
    const astraEnabled = this.config.isFeatureEnabled('astra');
    const path = window.location.pathname;

    wrappers.forEach((wrapper) => {
      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      if (!mediaId) return;

      const card = wrapper.closest('.au-astra-card') as HTMLElement | null;
      const pill = this.pillBuilder.build({
        mediaId,
        isUserListCard: this.shouldShowProgressAction(card, path),
        socialEnabled,
        socialShowAvatars,
        astraEnabled,
      });

      (wrapper as HTMLElement).innerHTML = '';
      (wrapper as HTMLElement).appendChild(pill);
    });
  }

  private shouldShowProgressAction(
    card: HTMLElement | null,
    path: string,
    isHome = path === '/' || path.startsWith('/home') || path.endsWith('/astra')
  ): boolean {
    if (path.includes('/animelist') || path.includes('/mangalist')) {
      return true;
    }

    if (!isHome || !card) {
      return false;
    }

    const sectionTitle = this.getCardSectionTitle(card);
    if (!sectionTitle) {
      return true;
    }

    return !AstraEnhancementService.HOME_PROGRESS_DISABLED_SECTIONS.some((title) =>
      sectionTitle.includes(title)
    );
  }

  private getCardSectionTitle(card: HTMLElement): string {
    const sectionCandidates: Array<HTMLElement | null> = [
      card.closest('section'),
      card.closest('.section'),
      card.closest('.home'),
      card.parentElement ?? null,
      card.parentElement?.parentElement ?? null
    ];

    for (const section of sectionCandidates) {
      if (!section) continue;

      const ownHeader = section.querySelector(
        ':scope > h1, :scope > h2, :scope > h3, :scope > .section-header, :scope > .header, :scope > .title'
      );
      if (ownHeader?.textContent?.trim()) {
        return ownHeader.textContent.trim().toLowerCase();
      }

      const previousHeader = section.previousElementSibling;
      if (
        previousHeader instanceof HTMLElement &&
        previousHeader.matches('h1, h2, h3, .section-header, .header, .title') &&
        previousHeader.textContent?.trim()
      ) {
        return previousHeader.textContent.trim().toLowerCase();
      }
    }

    return '';
  }
}
