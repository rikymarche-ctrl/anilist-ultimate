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
import { calendarStore } from '@/modules/calendar/CalendarStore';
import type { IConfigManager } from '@core/interfaces/IConfigManager';

@injectable()
export class SocialMaskingService {
  constructor(
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.Config) private config: IConfigManager
  ) {}

  /**
   * Initializes the masking service and registers persistence observers
   */
  public init(): void {
    log.info('[SocialMaskingService] Initializing...');

    // Initial sync
    this.sync();

    // 1. Subscribe to store changes for real-time updates
    calendarStore.subscribeToSelector(
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
    const state = calendarStore.getState();
    const { socialEnabled, socialShowAvatars } = state.preferences;
    const astraEnabled = this.config.isFeatureEnabled('astra');

    // 4-Point Rule: Hide native social bubbles if either global social or avatars are disabled
    const shouldHide = !socialEnabled || !socialShowAvatars;

    if (shouldHide) {
      if (!document.body.classList.contains('au-social-avatars-hidden')) {
        document.body.classList.add('au-social-avatars-hidden');
        log.debug('[SocialMaskingService] Native social bubbles MASKED');
      }
    } else {
      if (document.body.classList.contains('au-social-avatars-hidden')) {
        document.body.classList.remove('au-social-avatars-hidden');
        log.debug('[SocialMaskingService] Native social bubbles VISIBLE');
      }
    }

    // Always maintain the astra-enabled class for feature-specific CSS
    if (astraEnabled) {
      document.body.classList.add('au-astra-enabled');
    } else {
      document.body.classList.remove('au-astra-enabled');
    }
  }
}
