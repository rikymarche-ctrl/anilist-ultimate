/**
 * @file CustomListTabManager.ts
 * @description Custom list dropdown tab and list selection management
 *
 * Shared between ActivityEnhancerModule and MediaSocialEnhancer.
 * Injects a "Custom Lists" tab into the AniList activity feed toggle,
 * manages tab exclusivity (only one active at a time), and renders
 * a dropdown for selecting which custom list to display.
 *
 * @see ActivityEnhancerModule.ts for home page usage
 * @see MediaSocialEnhancer.ts for media page usage
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ILogger } from '@core/interfaces/ILogger';
import type { CustomListService } from '@/modules/social/CustomListService';

export interface TabManagerOptions {
  /**
   * CSS selector for feed type toggle container
   */
  toggleSelector?: string;

  /**
   * Data attribute for scoped styles (for media pages)
   */
  scopeAttribute?: string;

  /**
   * Callback when list selection changes
   */
  onListChange?: (listName: string | null) => void;

  /**
   * Initial list selection to restore on re-injection
   * BUG-005 fix: Prevents auto-reset on AniList refresh
   */
  initialSelection?: string | null;
}

/**
 * Custom List Tab Manager
 * Handles dropdown UI and list selection logic
 */
@injectable()
export class CustomListTabManager {
  private currentList: string | null = null;
  private button: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private tabObserver: MutationObserver | null = null;
  private options: TabManagerOptions = {
    toggleSelector: '.feed-type-toggle',
  };

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.CustomListService) private customListService: CustomListService
  ) {}

  /**
   * Configure manager options
   */
  configure(options: Partial<TabManagerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Initialize and inject custom list dropdown
   */
  async inject(): Promise<boolean> {
    const feedToggle = document.querySelector(this.options.toggleSelector!);
    if (!feedToggle) {
      this.logger.debug('[CustomListTabManager] Feed toggle not found');
      return false;
    }

    // Check if already injected
    if (document.querySelector('.au-custom-list-btn')) {
      this.logger.debug('[CustomListTabManager] Already injected');
      return true;
    }

    this.logger.info('[CustomListTabManager] Injecting custom lists dropdown');

    // Initialize service
    await this.customListService.init();
    const lists = this.customListService.getLists();
    const listNames = Object.keys(lists);

    if (listNames.length === 0) {
      this.logger.warn('[CustomListTabManager] No custom lists found');
      return false;
    }

    // Create button
    const btn = document.createElement('div');
    btn.className = 'link au-custom-list-btn';
    if (this.options.scopeAttribute) {
      btn.setAttribute(this.options.scopeAttribute, '');
    }
    btn.innerHTML = `
      <span class="au-custom-list-label" ${this.options.scopeAttribute ? `${this.options.scopeAttribute}=""` : ''}>Custom</span>
      <i class="fa fa-caret-down" ${this.options.scopeAttribute ? `${this.options.scopeAttribute}=""` : ''} style="margin-left: 5px; font-size: 0.9em;"></i>
    `;

    // Create menu
    const menuItems = [
      '<div class="au-custom-list-item au-custom-list-clear" data-list=""><i class="fa fa-times-circle"></i> Clear</div>',
      ...listNames.map(
        (name) => `<div class="au-custom-list-item" data-list="${name}">${name}</div>`
      ),
    ].join('');

    const menu = document.createElement('div');
    menu.className = 'au-custom-list-menu';
    menu.style.display = 'none';
    menu.innerHTML = menuItems;

    // Inject into DOM
    feedToggle.appendChild(btn);
    document.body.appendChild(menu);

    this.button = btn;
    this.menu = menu;

    // Attach events
    this.attachEvents(feedToggle as HTMLElement);

    // Setup tab exclusivity observer
    this.setupTabObserver(feedToggle as HTMLElement);

    // BUG-005 fix: Restore initial selection after re-injection
    if (this.options.initialSelection) {
      this.setList(this.options.initialSelection);
      this.logger.info('[CustomListTabManager] Restored initial selection:', this.options.initialSelection);
    }

    this.logger.success('[CustomListTabManager] Dropdown injected successfully');
    return true;
  }

  /**
   * Attach event listeners
   */
  private attachEvents(feedToggle: HTMLElement): void {
    if (!this.button || !this.menu) return;

    // Button click - toggle menu
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = this.button!.getBoundingClientRect();
      this.menu!.style.top = `${rect.bottom + 8}px`;
      this.menu!.style.left = `${rect.left}px`;
      this.menu!.style.display = this.menu!.style.display === 'none' ? 'block' : 'none';
    });

    // Menu item clicks
    this.menu.querySelectorAll('.au-custom-list-item').forEach((item) => {
      item.addEventListener('click', () => {
        const list = item.getAttribute('data-list') || null;
        this.setList(list);
        this.menu!.style.display = 'none';
      });
    });

    // Clear when clicking native tabs (capture phase)
    feedToggle.addEventListener(
      'click',
      (e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.au-custom-list-btn') && this.currentList) {
          this.setList(null);
        }
      },
      true
    );

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!this.button?.contains(e.target as Node) && !this.menu?.contains(e.target as Node)) {
        if (this.menu) {
          this.menu.style.display = 'none';
        }
      }
    });
  }

  /**
   * Setup mutation observer for tab exclusivity
   */
  private setupTabObserver(feedToggle: HTMLElement): void {
    if (this.tabObserver) return;

    this.tabObserver = new MutationObserver(() => {
      this.updateUI();
    });

    this.tabObserver.observe(feedToggle, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  /**
   * Set active custom list
   */
  setList(listName: string | null): void {
    this.currentList = listName;
    this.updateUI();
    this.options.onListChange?.(listName);
  }

  /**
   * Update UI to reflect active list
   */
  private updateUI(): void {
    if (!this.button) return;

    // Temporarily disconnect observer to avoid infinite loop
    this.tabObserver?.disconnect();

    try {
      const isActive = this.currentList !== null;
      
      // Update container state
      const feedToggle = document.querySelector(this.options.toggleSelector!);
      if (feedToggle) {
        feedToggle.classList.toggle('au-custom-active', isActive);
      }

      // Update button state if changed
      const hasActiveClass = this.button.classList.contains('active');
      if (hasActiveClass !== isActive) {
        this.button.classList.toggle('active', isActive);
      }

      // Update label if changed
      const label = this.button.querySelector('.au-custom-list-label');
      if (label && label.textContent !== (this.currentList || 'Custom')) {
        label.textContent = this.currentList || 'Custom';
      }

      // Deactivate native tabs if custom list is active
      if (isActive) {
        const nativeTabs = document.querySelectorAll('.feed-type-toggle .link');
        nativeTabs.forEach((tab) => {
          if (!tab.classList.contains('au-custom-list-btn') && tab.classList.contains('router-link-active')) {
            tab.classList.remove('router-link-active');
          }
        });
      }

      // Update menu items selection state
      if (this.menu) {
        this.menu.querySelectorAll('.au-custom-list-item').forEach((item) => {
          const listName = item.getAttribute('data-list') || null;
          item.classList.toggle('selected', listName === this.currentList);
        });
      }
    } finally {
      // Re-observe
      const feedToggle = document.querySelector(this.options.toggleSelector!);
      if (feedToggle && this.tabObserver) {
        this.tabObserver.observe(feedToggle, {
          attributes: true,
          childList: true,
          subtree: true,
        });
      }
    }
  }

  /**
   * Get current active list name
   */
  getCurrentList(): string | null {
    return this.currentList;
  }

  /**
   * Check if custom list is active
   */
  isActive(): boolean {
    return this.currentList !== null;
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.button?.remove();
    this.menu?.remove();
    this.tabObserver?.disconnect();

    this.button = null;
    this.menu = null;
    this.tabObserver = null;
    this.currentList = null;
  }
}
