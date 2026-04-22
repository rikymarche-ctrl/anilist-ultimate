/**
 * Social Activity Module
 * Core module for managing social features in the calendar
 */

import { log } from '@core/logger';
import { SocialSidebar } from './components/SocialSidebar';
import type { IModule } from '@core/interfaces/IModule';

export class SocialActivityModule implements IModule {
  private sidebar: SocialSidebar | null = null;

  public async init(): Promise<void> {
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

    this.sidebar = new SocialSidebar({});
    
    // We mount to document.body to ensure it's always on top and not clipped
    this.sidebar.mount(document.body);
    
    log.debug('Social Sidebar mounted');
  }

  public getSidebar(): SocialSidebar | null {
    return this.sidebar;
  }
}
