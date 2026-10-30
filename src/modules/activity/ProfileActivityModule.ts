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
import { NATIVE_ACTIVITY_SELECTOR } from './shared/ActivityRenderer';
import '../../styles/activity-enhancer.css';

@injectable()
export class ProfileActivityModule extends BaseModule {
  private readonly OBSERVER_NAME = 'profile-activity-observer';
  private isProcessing = false;
  private generation = 0;
  private destroyed = false;

  private fullCleanup(): void {
    this.generation++;
    this.cleanup();
    this.filterBar.destroy();
    document.querySelector('.au-profile-activity-bar')?.remove();
  }

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
    this.destroyed = false;

    this.onPageChange(() => {
      void this.handlePageChange().catch((error: unknown) => this.logger.error('[ProfileActivity] Page change handling failed', error));
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
  private async handlePageChange(): Promise<void> {
    this.fullCleanup();
    if (this.isOnProfilePage()) {
      await this.startObservation();
    }
  }

  private async startObservation(): Promise<void> {
    const generation = this.generation;
    const path = window.location.pathname;
    await this.checkAndProcess();

    // Observe the content area where activity feed usually appears
    const container = await this.waitForElement('.content.container', 5000);
    if (container?.isConnected && !this.destroyed && generation === this.generation && path === window.location.pathname) {
      this.registerObserver(
        this.OBSERVER_NAME,
        container,
        { childList: true, subtree: true },
        () => {
          void this.checkAndProcess().catch((error: unknown) => this.logger.error('[ProfileActivity] Feed observer processing failed', error));
        }
      );
    }
  }

  /**
   * Check and process the page
   */
  private async checkAndProcess(): Promise<void> {
    if (this.isProcessing || this.destroyed || !this.isOnProfilePage()) return;

    // Look for activity feed and verify we don't have our bar yet
    const feed = document.querySelector('.activity-feed');
    const existingBar = document.querySelector('.au-profile-activity-bar');

    if (!feed) return;

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

    // Shared singleton renderer: never use a selector that would also match custom-list rows.
    this.renderer.configure({ activitySelector: NATIVE_ACTIVITY_SELECTOR });

    this.renderer.applyFilters(activeFilters, searchQuery);
  }

  /**
   * Cleanup
   */
  public override async destroy(): Promise<void> {
    this.destroyed = true;
    this.fullCleanup();
    await super.destroy();
  }
}
