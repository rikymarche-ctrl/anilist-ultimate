/**
 * @file AstraModule.ts
 * @description Orchestrator for the Astra advanced multi-criteria scoring system.
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { AstraService } from './AstraService';
import { AstraDashboard } from './ui/AstraDashboard';
import { AstraRatingController } from './ui/AstraRatingController';
import { SocialMaskingService } from '@core/services/SocialMaskingService';
import { AstraEnhancementService } from './services/AstraEnhancementService';
import { AstraNavigationService } from './services/AstraNavigationService';
import { AstraPreferencesService } from './services/AstraPreferencesService';
import type { ToastService } from '@core/services/ToastService';

/**
 * Main module for the Astra scoring system.
 * Coordinates data flow, UI injection, and event handling across the AniList interface.
 */
@injectable()
export class AstraModule extends BaseModule {
  private intervals: number[] = [];
  private globalClickListener: ((e: MouseEvent) => void) | null = null;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard,
    @inject(TOKENS.AstraRatingController) private ratingModal: AstraRatingController,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventbus: IEventBus,
    @inject(TOKENS.SocialMaskingService) private maskingService: SocialMaskingService,
    @inject(TOKENS.AstraEnhancementService) private enhancementService: AstraEnhancementService,
    @inject(TOKENS.AstraNavigationService) private navService: AstraNavigationService,
    @inject(TOKENS.AstraPreferencesService) private preferences: AstraPreferencesService,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super(eventbus);
  }

  /**
   * Initializes the Astra module, sets up observers, and triggers initial DOM scanning.
   */
  public async init(): Promise<void> {
    log.info('[Astra] Module booting...');

    if (this.apiClient.isAuthenticated()) {
      await this.service.init();
    }

    this.maskingService.sync();

    // 1. Navigation handling
    this.onPageChange(async (event) => {
      const path = event?.path || window.location.pathname;
      if (path.includes('/astra')) this.renderDashboard();
      this.enhancementService.enhanceCards(path);
    });

    // 2. Continuous enhancement via SharedObserver
    this.sharedObserver.register('astra-enhancer', () => {
      const path = window.location.pathname;
      this.enhancementService.enhanceCards(path);
      this.navService.injectNavbarButton(() => this.eventbus.emit(EVENT_TYPES.ASTRA_OPEN));
      this.navService.hijackMediaButton((id) => this.ratingModal.open(id));
      this.navService.enhanceBrowseDropdown();
    });

    // 3. Global Interaction Handler
    this.setupGlobalClickListener();

    // Initial run
    const currentPath = window.location.pathname;
    this.enhancementService.enhanceCards(currentPath);
    this.navService.injectNavbarButton(() => this.eventbus.emit(EVENT_TYPES.ASTRA_OPEN));
    this.navService.hijackMediaButton((id) => this.ratingModal.open(id));

    // 4. Reactive UI Updates
    this.preferences.onChanges(() => {
      log.debug('[Astra] Settings changed, refreshing pills...');
      this.enhancementService.refreshAllPills();
    });

    // Cleanup interval for navbar redundancy
    this.intervals.push(window.setInterval(() => {
      this.navService.injectNavbarButton(() => this.eventbus.emit(EVENT_TYPES.ASTRA_OPEN));
    }, 5000));
  }

  /**
   * Sets up a global event listener to handle clicks on dynamically injected Astra pills.
   * @private
   */
  private setupGlobalClickListener(): void {
    if (this.globalClickListener) return;

    this.globalClickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const section = target?.closest<HTMLElement>('[data-action]');
      const wrapper = section?.closest<HTMLElement>('.au-pill-wrapper');

      if (!section || !wrapper) return;

      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      const action = section.getAttribute('data-action');
      if (!mediaId || !action) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      this.handlePillAction(section, mediaId, action);
    };

    window.addEventListener('click', this.globalClickListener, { capture: true });
  }

  /**
   * Routes pill actions to their respective handlers.
   * 
   * @param section The specific pill section clicked.
   * @param mediaId The AniList media ID associated with the card.
   * @param action The action type (e.g., 'mark-watched', 'edit-entry').
   * @private
   */
  private async handlePillAction(section: HTMLElement, mediaId: number, action: string): Promise<void> {
    section.classList.add('au-pill-pressed');
    setTimeout(() => section.classList.remove('au-pill-pressed'), 300);

    if (action === 'mark-watched') {
      try {
        const result = await this.service.incrementProgress(mediaId);
        if (result) {
          this.toast.success(`✓ ${result.title} → Ep ${result.progress}`);
        }
      } catch (err: any) {
        this.toast.error(err.message || 'Failed to update progress');
      }
    } else if (action === 'edit-entry') {
      await this.ratingModal.open(mediaId);
    } else if (action === 'social-activity') {
      const card = section.closest<HTMLElement>('.au-astra-card');
      const title = card?.querySelector('.title')?.textContent?.trim() || 'Media';
      window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
        detail: { mediaId, title, element: card, type: 'ANIME' }
      }));
    }
  }

  /**
   * Renders the Astra dashboard by mounting it to the user profile content area.
   * @private
   */
  private renderDashboard(): void {
    const container = document.querySelector('.user .content');
    if (!container) return;
    container.innerHTML = '';
    (container as HTMLElement).style.display = 'block';
    this.dashboard.mount(container as HTMLElement);
    this.service.syncWithAniList(this.apiClient).catch(() => { });
  }

  /**
   * Returns the unique module identifier.
   */
  public getName(): string { return 'astra'; }

  /**
   * Cleans up resources, observers, and listeners when the module is destroyed.
   */
  public override async destroy(): Promise<void> {
    this.intervals.forEach(id => window.clearInterval(id));
    if (this.globalClickListener) {
      window.removeEventListener('click', this.globalClickListener, { capture: true });
      this.globalClickListener = null;
    }
    this.sharedObserver.unregister('astra-enhancer');
    await super.destroy();
  }
}
