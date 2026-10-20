/**
 * @file SocialMaskingService.ts
 * @description Centralized enforcer for social element visibility (the "4-point rule")
 *
 * This service manages the global 'au-social-avatars-hidden' body class which 
 * powers the CSS masking rules in astra.css. It centralizes logic previously 
 * duplicated in CalendarModule and AstraModule.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { CalendarStore } from '@/modules/calendar/CalendarStore';
import type { IConfigManager } from '@core/interfaces/IConfigManager';

@injectable()
export class SocialMaskingService {
  private active = false;
  private destroyed = false;
  private generation = 0;
  private unsubscribePreferences: (() => void) | null = null;
  private unsubscribeConfig: (() => void) | null = null;
  constructor(
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.CalendarStore) private store: CalendarStore
  ) {}

  /**
   * Initializes the masking service and registers persistence observers
   */
  public init(): void {
    if (this.active) return;
    this.active = true;
    this.destroyed = false;
    const generation = ++this.generation;
    const syncCurrent = () => {
      if (this.active && generation === this.generation) this.sync();
    };
    logger.info('[SocialMaskingService] Initializing...');

    // Initial sync
    this.sync();

    // 1. Subscribe to store changes for real-time updates
    this.unsubscribePreferences = this.store.subscribeToSelector(
      state => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      syncCurrent
    );
    this.unsubscribeConfig = this.config.onChange('features', syncCurrent);

    // 2. Register persistence observer to fight React re-renders of the body
    this.sharedObserver.register('social-masking-persistence', syncCurrent, 2000);
    
    logger.success('[SocialMaskingService] Initialized and observing');
  }

  /**
   * Synchronizes the DOM state with current preferences
   */
  public sync(): void {
    if (this.destroyed || !document.body) return;
    const state = this.store.getState();
    const { socialEnabled, socialShowAvatars } = state.preferences;
    const astraEnabled = this.config.isFeatureEnabled('astra');

    // 4-Point Rule: Hide native social bubbles if Astra is enabled AND either global social or avatars are disabled
    const shouldHide = astraEnabled && (!socialEnabled || !socialShowAvatars);

    document.body.classList.toggle('au-social-avatars-hidden', shouldHide);
    document.body.classList.toggle('au-social-enabled', astraEnabled && socialEnabled);
    document.body.classList.toggle('au-social-avatars-enabled', astraEnabled && socialShowAvatars);
    document.body.classList.toggle('au-astra-enabled', astraEnabled);

    if (shouldHide) {
      logger.debug('[SocialMaskingService] Native social bubbles MASKED');
    } else {
      logger.debug('[SocialMaskingService] Native social bubbles VISIBLE');
    }
  }

  public destroy(): void {
    if (!this.active) return;
    this.active = false;
    this.destroyed = true;
    this.generation++;
    this.unsubscribePreferences?.();
    this.unsubscribePreferences = null;
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;
    this.sharedObserver.unregister('social-masking-persistence');
    document.body?.classList.remove('au-social-avatars-hidden', 'au-social-enabled', 'au-social-avatars-enabled', 'au-astra-enabled');
  }
}
