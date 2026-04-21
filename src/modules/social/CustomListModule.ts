/**
 * Custom List Module
 * Handles injection and routing for the Custom User List Manager in Settings
 */

import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { CustomListManager } from './components/CustomListManager';

export class CustomListModule extends BaseModule {
  private observerName = 'au-settings-router';
  private managerInstance: CustomListManager | null = null;
  private isManagerActive = false;

  public async init(): Promise<void> {
    log.info('CustomListModule: Initializing...');

    // 1. Initial check for injection and routing
    this.handleRouting();
    this.injectLink();

    // 2. Global observer for SPA navigation and settings page structure
    this.registerObserver(this.observerName, document.body, { childList: true, subtree: true }, () => {
      this.handleRouting();
      this.injectLink();
    });

    // 3. Listen for popstate (browser back/forward)
    window.addEventListener('popstate', () => this.handleRouting());
  }

  private injectLink(): void {
    if (!location.pathname.startsWith('/settings')) return;

    const navGroups = document.querySelectorAll('.nav-group.mobile-nav-hidden');
    const targetGroup = Array.from(navGroups).find(g => g.querySelector('.group-header')?.textContent === 'Settings');
    
    if (!targetGroup || targetGroup.querySelector('.au-custom-lists-link')) return;

    const link = document.createElement('a');
    link.className = 'au-custom-lists-link';
    link.href = '/settings/au-custom-lists';
    link.textContent = 'AU - Custom Lists';
    link.style.cursor = 'pointer';

    // AniList uses Vue Router, we intercept the click to avoid full reload or 404
    link.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/settings/au-custom-lists');
      this.handleRouting();
    });

    targetGroup.appendChild(link);
  }

  private handleRouting(): void {
    const isCustomPath = location.pathname === '/settings/au-custom-lists';
    
    if (isCustomPath && !this.isManagerActive) {
      this.activateManager();
    } else if (!isCustomPath && this.isManagerActive) {
      this.deactivateManager();
    }

    // Always update active state of the link
    this.updateLinkUI();
  }

  private activateManager(): void {
    const contentArea = document.querySelector('.settings.container > .content') as HTMLElement;
    if (!contentArea) return;

    log.info('CustomListModule: Activating Manager UI');
    this.isManagerActive = true;

    // 1. Hide original content
    contentArea.style.display = 'none';

    // 2. Create and inject our container if not exists
    let auContainer = document.getElementById('au-custom-settings-container');
    if (!auContainer) {
      auContainer = document.createElement('div');
      auContainer.id = 'au-custom-settings-container';
      auContainer.className = 'content'; // Keep AniList's class for layout
      contentArea.parentElement?.appendChild(auContainer);
    }
    auContainer.style.display = 'block';

    // 3. Render Manager
    if (!this.managerInstance) {
      this.managerInstance = new CustomListManager({});
      auContainer.appendChild(this.managerInstance.getElement());
    }
  }

  private deactivateManager(): void {
    log.info('CustomListModule: Deactivating Manager UI');
    this.isManagerActive = false;

    const nativeContent = document.querySelector('.settings.container > .content') as HTMLElement;
    if (nativeContent) nativeContent.style.display = 'block';

    const auContainer = document.getElementById('au-custom-settings-container');
    if (auContainer) auContainer.style.display = 'none';
  }

  private updateLinkUI(): void {
    const link = document.querySelector('.au-custom-lists-link');
    if (!link) return;

    if (location.pathname === '/settings/au-custom-lists') {
      link.classList.add('router-link-exact-active', 'router-link-active');
    } else {
      link.classList.remove('router-link-exact-active', 'router-link-active');
    }
  }

  public override destroy(): void {
    super.destroy();
    this.deactivateManager();
    this.managerInstance = null;
  }
}
