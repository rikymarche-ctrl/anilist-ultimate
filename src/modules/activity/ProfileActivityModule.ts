/**
 * @file ProfileActivityModule.ts
 * @description Activity filtering for user profile pages
 *
 * Injects a filter bar into the user's activity section to allow
 * filtering by type (Watched, Read, etc.) and full-text search.
 *
 * @see ActivityFilterBar.ts for the filter UI component
 * @see ActivityRenderer.ts for the filtering logic
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { ActivityFilterBar, ActivityRenderer } from './shared';
import '../../styles/activity-enhancer.css';

@injectable()
export class ProfileActivityModule extends BaseModule {
  private readonly OBSERVER_NAME = 'profile-activity-observer';
  private isProcessing = false;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.ActivityFilterBar) private filterBar: ActivityFilterBar,
    @inject(TOKENS.ActivityRenderer) private renderer: ActivityRenderer,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    this.logger.info('[ProfileActivity] Initializing');

    this.onPageChange(async () => {
      this.cleanup();
      if (this.isOnProfilePage()) {
        await this.startObservation();
      }
    });

    if (this.isOnProfilePage()) {
      await this.startObservation();
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'profileActivity';
  }

  /**
   * Check if on a user profile page
   */
  private isOnProfilePage(): boolean {
    const path = window.location.pathname;
    // Matches /user/Username/ or /user/Username/social etc.
    return path.startsWith('/user/') && !path.includes('/animelist') && !path.includes('/mangalist');
  }

  /**
   * Start observation for dynamic content
   */
  private async startObservation(): Promise<void> {
    this.checkAndProcess();

    // Observe the content area where activity feed usually appears
    const container = await this.waitForElement('.content.container', 5000);
    if (container) {
      this.registerObserver(
        this.OBSERVER_NAME,
        container,
        { childList: true, subtree: true },
        () => this.checkAndProcess()
      );
    }
  }

  /**
   * Check and process the page
   */
  private async checkAndProcess(): Promise<void> {
    if (this.isProcessing) return;

    // Look for activity feed and verify we don't have our bar yet
    const feed = document.querySelector('.activity-feed');
    const existingBar = document.querySelector('.au-profile-activity-bar');

    if (!feed || existingBar) return;

    this.isProcessing = true;
    this.suspendObserver(this.OBSERVER_NAME);

    try {
      // Inject bar if missing
      if (!existingBar) {
        this.injectFilterBar(feed as HTMLElement);
      } else {
        // Bar exists, but we might have new activities from infinite scroll
        this.applyFilters();
      }
    } catch (error) {
      this.logger.error('[ProfileActivity] Processing failed', error);
    } finally {
      this.isProcessing = false;
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Inject the filter bar above the activity feed
   */
  private injectFilterBar(feed: HTMLElement): void {
    this.logger.debug('[ProfileActivity] Injecting filter bar');

    // Configure filter bar
    this.filterBar.configure({
      filters: ActivityFilterBar.getStandardFilters('all'),
      showSearch: true,
      onFilterChange: () => this.applyFilters(),
      onSearchChange: () => this.applyFilters(),
    });

    const bar = this.filterBar.create();

    // Force reset to 'ALL' on every page navigation
    this.filterBar.reset();

    bar.classList.add('au-profile-activity-bar');

    // Use consistent styling with Home page (reference standard)
    bar.style.setProperty('margin-top', '-2px', 'important');
    bar.style.setProperty('margin-bottom', '18px', 'important');

    // On profile pages, the activity feed is the target
    if (feed) {
      feed.parentElement?.insertBefore(bar, feed);
    }

    this.applyFilters();
    this.logger.success('[ProfileActivity] Filter bar injected and filters applied');
  }

  /**
   * Apply filters using shared renderer
   */
  private applyFilters(): void {
    const activeFilters = this.filterBar.getActiveFilters();
    const searchQuery = this.filterBar.getSearchQuery();

    this.renderer.configure({
      activitySelector: '.activity-entry, .activity-anime, .activity-manga, .activity-text',
    });

    this.renderer.applyFilters(activeFilters, searchQuery);
  }

  /**
   * Cleanup
   */
  public override async destroy(): Promise<void> {
    this.filterBar.destroy();
    document.querySelector('.au-profile-activity-bar')?.remove();
    await super.destroy();
  }
}
