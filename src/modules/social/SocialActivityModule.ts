/**
 * @file SocialActivityModule.ts
 * @description Module that mounts the SocialSidebar component globally
 *
 * Simple orchestrator that initializes and mounts the SocialSidebar
 * on media pages to display detailed friend activity with filtering,
 * search, and infinite scroll.
 *
 * @see SocialSidebar.ts for the sidebar component
 * @see SocialService.ts for the data layer
 * @see docs/MODULES.md#9-social-activity-module
 */

import { injectable, inject } from 'tsyringe';
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { SocialSidebar } from './components/SocialSidebar';

@injectable()
export class SocialActivityModule extends BaseModule {
  private sidebar: SocialSidebar | null = null;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(SocialSidebar) private component: SocialSidebar
  ) {
    super(eventBus);
  }

  public override async init(): Promise<void> {
    if (this.sidebar) return;
    logger.info('Initializing Social Activity Module');
    
    try {
      // Initialize and mount the global sidebar
      this.initSidebar();

      logger.success('Social Activity Module initialized');
    } catch (e) {
      logger.error('Failed to initialize Social Activity Module', e);
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'socialActivity';
  }

  private initSidebar(): void {
    if (this.sidebar) return;

    this.sidebar = this.component;
    
    // We mount to document.body to ensure it's always on top and not clipped
    this.sidebar.mount(document.body);
    
    logger.debug('Social Sidebar mounted');
  }

  public getSidebar(): SocialSidebar | null {
    return this.sidebar;
  }

  public override async destroy(): Promise<void> {
    this.sidebar?.unmount();
    this.sidebar = null;
    await super.destroy();
  }
}
