/**
 * Social Enhancer Module
 * Injects social activity info into native AniList cards site-wide
 */

import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { SocialService } from './SocialService';
import { SocialRenderer } from './SocialRenderer';
import { calendarStore } from '../calendar/CalendarStore';

export class SocialEnhancerModule extends BaseModule {
  private socialService = SocialService.getInstance();
  private observerName = 'global-social-enhancer';
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingCards: Map<number, HTMLElement[]> = new Map();

  public async init(): Promise<void> {
    const { socialEnabled } = calendarStore.getState().preferences;
    if (!socialEnabled) return;

    log.info('SocialEnhancerModule: Initializing global observer...');

    this.startObservation();
    
    // Initial check
    this.processCards();
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'socialEnhancer';
  }

  private startObservation(): void {
    this.registerObserver(this.observerName, document.body, { childList: true, subtree: true }, () => {
      this.processCards();
    });
  }

  private processCards(): void {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.media-preview-card, .media-card'));
    
    let added = false;
    cards.forEach(card => {
      if (card.hasAttribute('data-au-social-processed')) return;
      
      const mediaId = this.extractMediaId(card);
      if (!mediaId) return;

      if (!this.pendingCards.has(mediaId)) {
        this.pendingCards.set(mediaId, []);
      }
      this.pendingCards.get(mediaId)!.push(card);
      card.setAttribute('data-au-social-processed', 'true');
      added = true;
    });

    if (added) {
      this.scheduleBatchFetch();
    }
  }

  private extractMediaId(card: HTMLElement): number | null {
    // Usually the card is an <a> or has an <a> descendant
    const link = card.classList.contains('media-preview-card') || card.classList.contains('media-card') 
      ? (card as HTMLAnchorElement).href 
      : card.querySelector<HTMLAnchorElement>('a')?.href;
      
    if (!link) return null;

    const match = link.match(/\/(anime|manga)\/(\d+)/);
    return match ? parseInt(match[2], 10) : null;
  }

  private scheduleBatchFetch(): void {
    if (this.batchTimeout) clearTimeout(this.batchTimeout);

    this.batchTimeout = setTimeout(() => {
      this.flushBatch();
    }, 800); // Wait for more cards to settle
  }

  private async flushBatch(): Promise<void> {
    const ids = Array.from(this.pendingCards.keys());
    if (ids.length === 0) return;

    const currentBatch = new Map(this.pendingCards);
    this.pendingCards.clear();

    log.debug(`[SocialEnhancer] Fetching social for ${ids.length} cards`);

    try {
      const results = await this.socialService.getFriendActivityBatch(ids);
      
      currentBatch.forEach((elements, mediaId) => {
        const activities = results.get(mediaId) || [];
        elements.forEach(card => {
          SocialRenderer.injectIntoCard(card, mediaId, activities);
        });
      });
    } catch (e) {
      log.error('[SocialEnhancer] Batch fetch failed', e);
    }
  }

  public override async destroy(): Promise<void> {
    super.destroy();
    if (this.batchTimeout) clearTimeout(this.batchTimeout);
    this.pendingCards.clear();
  }
}
