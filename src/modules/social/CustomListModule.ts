/**
 * @file CustomListModule.ts
 * @description Router module for the custom lists settings page
 *
 * Intercepts hash-based navigation (#au-custom-lists) on the settings
 * page, injects a navigation link in the AniList settings sidebar,
 * and shows/hides the CustomListManager UI component.
 *
 * @see CustomListManager.ts for the UI component
 * @see CustomListService.ts for the data layer
 * @see docs/MODULES.md#7-custom-list-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { container } from '@core/di/container';
import { CustomListManager } from './components/CustomListManager';

@injectable()
export class CustomListModule extends BaseModule {
  private observerName = 'au-settings-router';
  private managerInstance: CustomListManager | null = null;
  private isManagerActive = false;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.info('CustomListModule: Initializing...');

    // 1. Rescue from Legacy Path (Fixes 404 on refresh)
    if (location.pathname === '/settings/au-custom-lists') {
      log.info('CustomListModule: Legacy path detected, redirecting to hash route...');
      location.replace('/settings#au-custom-lists');
      return;
    }

    // 2. Initial check for injection and routing
    this.handleRouting();
    this.injectLink();

    // 3. Global observer for SPA navigation and settings page structure
    this.registerObserver(this.observerName, document.body, { childList: true, subtree: true }, () => {
      this.handleRouting();
      this.injectLink();
    });

    // 4. Listen for popstate and hashchange
    window.addEventListener('popstate', () => this.handleRouting());
    window.addEventListener('hashchange', () => this.handleRouting());
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'customList';
  }

  private injectLink(): void {
    if (!location.pathname.startsWith('/settings')) return;

    const navGroups = document.querySelectorAll('.nav-group.mobile-nav-hidden');
    const targetGroup = Array.from(navGroups).find(g => g.querySelector('.group-header')?.textContent === 'Settings');
    
    if (!targetGroup || targetGroup.querySelector('.au-custom-lists-link')) return;

    const link = document.createElement('a');
    link.className = 'au-custom-lists-link';
    link.setAttribute('data-v-48560ace', ''); // Inherit AniList scoped styles
    link.href = '#au-custom-lists'; // Use hash for refresh stability
    link.textContent = 'AU - Custom Lists';
    link.style.cursor = 'pointer';

    link.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = 'au-custom-lists';
      this.handleRouting();
    });

    targetGroup.appendChild(link);
  }

  private handleRouting(): void {
    const isCustomPath = location.hash === '#au-custom-lists';
    
    if (isCustomPath && !this.isManagerActive) {
      this.activateManager();
    } else if (!isCustomPath && this.isManagerActive) {
      this.deactivateManager();
    }

    // Always update active state of the link
    this.updateLinkUI();
  }

  private activateManager(): void {
    // Try both specific and general selectors as AniList IDs/Classes can be dynamic
    const contentArea = document.querySelector('.settings.container > .content') || 
                        document.querySelector('.settings .content');
    
    if (!contentArea) {
      log.warn('CustomListModule: Content area not found, will retry via observer');
      return;
    }

    log.info('CustomListModule: Activating Manager UI');
    this.isManagerActive = true;

    // 1. Hide original content
    (contentArea as HTMLElement).style.display = 'none';

    // 2. Create and inject our container
    let auContainer = document.getElementById('au-custom-settings-container');
    if (!auContainer) {
      auContainer = document.createElement('div');
      auContainer.id = 'au-custom-settings-container';
      auContainer.className = 'content'; 
      auContainer.setAttribute('data-v-48560ace', ''); // Inherit layout styles
      contentArea.parentElement?.appendChild(auContainer);
    }
    auContainer.style.display = 'block';

    // 3. Render Manager
    if (!this.managerInstance) {
      this.managerInstance = container.resolve(CustomListManager);
      auContainer.appendChild(this.managerInstance.getElement());
    }
  }

  private deactivateManager(): void {
    log.info('CustomListModule: Deactivating Manager UI');
    this.isManagerActive = false;

    const nativeContent = document.querySelector('.settings.container > .content') || 
                          document.querySelector('.settings .content');
    if (nativeContent) (nativeContent as HTMLElement).style.display = 'block';

    const auContainer = document.getElementById('au-custom-settings-container');
    if (auContainer) auContainer.style.display = 'none';
  }

  private updateLinkUI(): void {
    const isCustomPath = location.hash === '#au-custom-lists';
    const link = document.querySelector('.au-custom-lists-link');
    
    // 1. Clear active classes from ALL links in the sidebar if we are on our path
    if (isCustomPath) {
      const navGroups = document.querySelectorAll('.nav-group.mobile-nav-hidden');
      navGroups.forEach(group => {
        group.querySelectorAll('a').forEach(a => {
          if (a !== link) {
            a.classList.remove('router-link-exact-active', 'router-link-active');
          }
        });
      });
    }

    // 2. Update our link
    if (link) {
      if (isCustomPath) {
        link.classList.add('router-link-exact-active', 'router-link-active');
      } else {
        link.classList.remove('router-link-exact-active', 'router-link-active');
      }
    }
  }

  public override async destroy(): Promise<void> {
    super.destroy();
    this.deactivateManager();
    this.managerInstance = null;
  }
}
