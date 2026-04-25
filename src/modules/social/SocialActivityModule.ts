/**
 * Social Activity Module
 * Core module for managing social features in the calendar
 */

import { injectable, inject } from 'tsyringe';
import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { container } from '@core/di/container';
import { SocialSidebar } from './components/SocialSidebar';

@injectable()
export class SocialActivityModule extends BaseModule {
  private sidebar: SocialSidebar | null = null;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public override async init(): Promise<void> {
    log.info('Initializing Social Activity Module');
    
    try {
      // Initialize and mount the global sidebar
      this.initSidebar();
      
      log.success('Social Activity Module initialized');
    } catch (e) {
      log.error('Failed to initialize Social Activity Module', e);
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

    this.sidebar = container.resolve(SocialSidebar);
    
    // We mount to document.body to ensure it's always on top and not clipped
    this.sidebar.mount(document.body);
    
    log.debug('Social Sidebar mounted');
  }

  public getSidebar(): SocialSidebar | null {
    return this.sidebar;
  }
}
