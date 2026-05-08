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
import { AstraService } from '../AstraService';
import { PreferencesService } from '@core/services/PreferencesService';

/**
 * Service responsible for scanning the AniList DOM and injecting Astra action pills.
 * Coordinates multiple enhancement strategies to ensure context-aware UI injection.
 */
@injectable()
export class AstraEnhancementService {
  constructor(
    @inject(TOKENS.AstraPillBuilder) private pillBuilder: PillUIBuilder,
    @inject(TOKENS.AstraStrategies) private strategies: ICardEnhancementStrategy[],
    @inject(delay(() => AstraService)) private astraService: AstraService,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.PreferencesService) private preferences: PreferencesService
  ) { }

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
          log.debug(`[AstraEnhancementService] Strategy "${strategy.name}" found ${cards.length} cards`);
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
      const isUserListCard = path.includes('/animelist') || path.includes('/mangalist');

      // ROBUST TARGET SELECTION: Find the image container or the best relative ancestor
      const target = card.querySelector('.cover, .image, .img, .banner-image, .media-preview-card .image, [style*="background-image"]') || card;
      
      log.debug(`[AstraEnhancer] Target found for card ${mediaId}:`, target.className);
      
      const summaries = this.astraService.getWorks();
      const workSummary = summaries.find(s => s.mediaId === mediaId);
      const score = workSummary ? workSummary.currentScore : null;

      const astraFeatureFlag = this.config.isFeatureEnabled('astra');
      
      log.debug(`[AstraEnhancer] Enhancing card ${mediaId} (Score: ${score}, AstraEnabled: ${astraFeatureFlag})`);

      const options = {
        mediaId,
        isUserListCard: isUserListCard || path === '/' || path === '/home',
        socialEnabled,
        socialShowAvatars,
        score,
        astraEnabled: astraFeatureFlag
      };

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
    const summaries = this.astraService.getWorks();
    const { socialEnabled, socialShowAvatars } = this.preferences.getPreferences();
    const astraEnabled = this.config.isFeatureEnabled('astra');
    const path = window.location.pathname;
    const isUserListCard = path.includes('/animelist') || path.includes('/mangalist');

    wrappers.forEach(wrapper => {
      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      if (!mediaId) return;

      const workSummary = summaries.find(s => s.mediaId === mediaId);
      const score = workSummary ? workSummary.currentScore : null;

      const pill = this.pillBuilder.build({
        mediaId,
        isUserListCard: isUserListCard || path === '/' || path === '/home',
        socialEnabled,
        socialShowAvatars,
        score,
        astraEnabled
      });

      (wrapper as HTMLElement).innerHTML = '';
      (wrapper as HTMLElement).appendChild(pill);
    });
  }
}
