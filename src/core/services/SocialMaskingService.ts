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
import { log } from '@core/logger';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { CalendarStore } from '@/modules/calendar/CalendarStore';
import type { IConfigManager } from '@core/interfaces/IConfigManager';

@injectable()
export class SocialMaskingService {
  constructor(
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.CalendarStore) private store: CalendarStore
  ) {}

  /**
   * Initializes the masking service and registers persistence observers
   */
  public init(): void {
    log.info('[SocialMaskingService] Initializing...');

    // Initial sync
    this.sync();

    // 1. Subscribe to store changes for real-time updates
    this.store.subscribeToSelector(
      (state: any) => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      () => this.sync()
    );

    // 2. Register persistence observer to fight React re-renders of the body
    this.sharedObserver.register('social-masking-persistence', () => this.sync(), 2000);
    
    log.success('[SocialMaskingService] Initialized and observing');
  }

  /**
   * Synchronizes the DOM state with current preferences
   */
  public sync(): void {
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
      log.debug('[SocialMaskingService] Native social bubbles MASKED');
    } else {
      log.debug('[SocialMaskingService] Native social bubbles VISIBLE');
    }
  }
}
