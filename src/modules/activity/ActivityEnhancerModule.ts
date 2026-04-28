/**
 * @file ActivityEnhancerModule.ts
 * @description Activity feed enhancement with filtering, search, and custom lists
 *
 * Enhances the home page activity feed with:
 *   - Filter bar (All, Watched, Read, Completed, Paused, Dropped, Plans, Text posts)
 *   - Full-text search across activity entries
 *   - Custom friend list tab in the feed type toggle
 *   - Custom list activity loading via GraphQL
 *
 * Uses shared components (ActivityFilterBar, ActivityRenderer, CustomListTabManager)
 * to avoid code duplication with MediaSocialEnhancer.
 *
 * Known Issues:
 *   - Filter state lost on page navigation (BUG-004 in docs/BUGS.md)
 *   - Custom list auto-resets on AniList refresh (BUG-005 in docs/BUGS.md)
 *
 * @see docs/MODULES.md#3-activity-enhancer-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { CustomListService } from '../social/CustomListService';
import type { AniListActivity, ActivityType } from './ActivityUtils';
import {
  ActivityFilterBar,
  ActivityRenderer,
  CustomListTabManager,
} from './shared';
import '../../styles/activity-enhancer.css';

/**
 * Activity Enhancer Module
 * Provides filtering and custom list functionality for activity feeds
 */
@injectable()
export class ActivityEnhancerModule extends BaseModule {
  private readonly OBSERVER_NAME = 'activity-continuous';
  private customActivitiesContainer: HTMLElement | null = null;
  private isProcessing = false;
  private savedFilterState: { activeFilters: ActivityType[]; searchQuery: string } | null = null; // BUG-004 fix
  private activeListName: string | null = null; // BUG-005 fix

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.ActivityFilterBar) private filterBar: ActivityFilterBar,
    @inject(TOKENS.ActivityRenderer) private renderer: ActivityRenderer,
    @inject(TOKENS.ActivityTabManager) private tabManager: CustomListTabManager,
    @inject(TOKENS.CustomListService) private customListService: CustomListService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    this.logger.info('[ActivityEnhancer] Initializing with shared components');

    // Use centralized navigation events instead of polling
    this.onPageChange(async () => {
      this.fullCleanup();
      if (this.isOnActivityPage()) {
        await this.startObservation();
      }
    });

    if (this.isOnActivityPage()) {
      await this.startObservation();
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'activityEnhancer';
  }

  /**
   * Check if on activity page
   */
  private isOnActivityPage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home';
  }

  /**
   * Full cleanup on page change
   */
  private fullCleanup(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    this.cleanup();

    // BUG-004 fix: Save filter state before cleanup
    this.savedFilterState = this.filterBar.getState();

    // Cleanup shared components
    this.filterBar.destroy();
    this.tabManager.destroy();

    // Cleanup custom container
    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;

    this.resumeObserver(this.OBSERVER_NAME);
  }

  /**
   * Start observation
   */
  private async startObservation(): Promise<void> {
    this.checkAndProcess();

    // BUG-007 fix: Observe specific activity feed container instead of document.body
    const container = await this.waitForElement('.activity-feed-wrap, .activity-feed, .feed-container', 5000);
    if (!container) {
      this.logger.warn('[ActivityEnhancer] Activity feed container not found, falling back to document.body');
      this.registerObserver(
        this.OBSERVER_NAME,
        document.body,
        { childList: true, subtree: true },
        () => {
          this.checkAndProcess();
        }
      );
    } else {
      // Observe only the activity feed container for better performance
      this.registerObserver(
        this.OBSERVER_NAME,
        container,
        { childList: true, subtree: true },
        () => {
          this.checkAndProcess();
        }
      );
      this.logger.debug('[ActivityEnhancer] Observing activity feed container (BUG-007 optimization)');
    }

    // Call checkAndProcess AGAIN to catch anything rendered while we were waiting
    this.checkAndProcess();
  }

  /**
   * Check and process page
   */
  private async checkAndProcess(): Promise<void> {
    if (this.isProcessing) return;

    const feed = document.querySelector('.activity-feed-wrap, .activity-feed, .feed-container');
    const bar = document.querySelector('.au-activity-bar');
    const customTab = document.querySelector('.au-custom-list-btn');

    // If we are not on activity page, or everything is already there, skip
    if (!this.isOnActivityPage()) return;
    if (bar && customTab) return;

    this.isProcessing = true;
    this.suspendObserver(this.OBSERVER_NAME);

    try {
      // Inject filter bar if not present
      if (!document.querySelector('.au-activity-bar')) {
        this.injectFilterBar();
      }

      // Inject custom lists dropdown if not present
      if (!document.querySelector('.au-custom-list-btn')) {
        await this.injectCustomListsTab();
      }

      // Apply filters to feed
      if (feed) {
        this.applyFilters();
      }
    } catch (error) {
      this.logger.error('[ActivityEnhancer] Processing failed', error);
    } finally {
      this.isProcessing = false;
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Inject filter bar using shared component
   */
  private injectFilterBar(): void {
    const editContainer = document.querySelector('.activity-edit');
    const feedWrap = document.querySelector('.activity-feed-wrap, .activity-feed, .feed-container');

    if (!feedWrap) return;

    // Configure filter bar
    this.filterBar.configure({
      filters: ActivityFilterBar.getStandardFilters('all'),
      showSearch: true,
      onFilterChange: () => this.applyFilters(),
      onSearchChange: () => this.applyFilters(),
    });

    // Create and inject
    const bar = this.filterBar.create();

    // BUG-004 fix: Restore saved filter state after re-injection
    if (this.savedFilterState) {
      this.filterBar.setState(this.savedFilterState);
      this.logger.info('[ActivityEnhancer] Restored filter state:', this.savedFilterState);
    }

    if (editContainer) {
      editContainer.insertAdjacentElement('afterend', bar);
    } else if (document.querySelector('.status-post-wrap')) {
      document.querySelector('.status-post-wrap')?.insertAdjacentElement('afterend', bar);
    } else {
      feedWrap.prepend(bar);
    }

    bar.style.setProperty('margin-top', '-2px', 'important');
    bar.style.setProperty('margin-bottom', '18px', 'important');

    this.logger.success('[ActivityEnhancer] Filter bar injected');
  }

  /**
   * Inject custom lists tab using shared component
   */
  private async injectCustomListsTab(): Promise<void> {
    // Configure tab manager
    this.tabManager.configure({
      toggleSelector: '.feed-type-toggle',
      onListChange: (listName) => {
        this.activeListName = listName; // BUG-005 fix: Track active list
        this.handleListChange(listName);
      },
      initialSelection: this.activeListName, // BUG-005 fix: Restore previous selection
    });

    // Inject
    const success = await this.tabManager.inject();
    if (success) {
      this.logger.success('[ActivityEnhancer] Custom lists tab injected');
    }
  }

  /**
   * Apply filters using shared renderer
   */
  private applyFilters(): void {
    // If custom list is active, hide native activities
    if (this.tabManager.isActive()) {
      this.renderer.hideNativeActivities();
      return;
    }

    // Apply filters to native activities
    const activeFilters = this.filterBar.getActiveFilters();
    const searchQuery = this.filterBar.getSearchQuery();

    this.renderer.configure({
      activitySelector: '.activity-entry, .activity-anime, .activity-manga, .activity-text',
    });

    this.renderer.applyFilters(activeFilters, searchQuery);
  }

  /**
   * Handle custom list change
   */
  private async handleListChange(listName: string | null): Promise<void> {
    if (this.isProcessing) return;
    
    this.logger.info(`[ActivityEnhancer] Custom list changed: ${listName || 'none'}`);

    this.isProcessing = true;
    this.suspendObserver(this.OBSERVER_NAME);

    try {
      if (listName) {
        // Show custom list activities
        await this.loadCustomListActivities(listName);
      } else {
        // Clear custom list, show native activities
        this.clearCustomActivities();
        this.renderer.showNativeActivities();
        this.applyFilters(); // Re-apply filters
      }
    } catch (error) {
      this.logger.error('[ActivityEnhancer] Failed to handle list change', error);
    } finally {
      this.isProcessing = false;
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Load and display custom list activities
   */
  private async loadCustomListActivities(listName: string): Promise<void> {
    // Hide native activities
    this.renderer.hideNativeActivities();

    // Create container if needed
    if (!this.customActivitiesContainer) {
      this.createCustomActivitiesContainer();
    }

    // Show loader
    if (this.customActivitiesContainer) {
      this.renderer.showLoader(this.customActivitiesContainer);
    }

    try {
      // Fetch activities from custom list
      const activities = await this.fetchCustomListActivities(listName);

      // Render activities
      if (this.customActivitiesContainer) {
        this.renderer.renderCustomActivities(activities, this.customActivitiesContainer);
      }
    } catch (error) {
      this.logger.error('[ActivityEnhancer] Failed to load custom list activities', error);
      if (this.customActivitiesContainer) {
        this.renderer.showEmptyMessage(this.customActivitiesContainer);
      }
    }
  }

  /**
   * Create container for custom activities
   */
  private createCustomActivitiesContainer(): void {
    const feedWrap = document.querySelector('.activity-feed-wrap, .activity-feed, .feed-container');
    if (!feedWrap) return;

    const container = document.createElement('div');
    container.className = 'au-custom-activities-container';
    feedWrap.appendChild(container);

    this.customActivitiesContainer = container;
  }

  /**
   * Clear custom activities
   */
  private clearCustomActivities(): void {
    if (this.customActivitiesContainer) {
      this.renderer.clear(this.customActivitiesContainer);
    }
  }

  /**
   * Fetch activities for custom list
   */
  private async fetchCustomListActivities(listName: string): Promise<AniListActivity[]> {
    const lists = this.customListService.getLists();
    const users = lists[listName] || [];
    const userIds = users.map(u => u.id);

    if (userIds.length === 0) {
      return [];
    }

    this.logger.info(`[ActivityEnhancer] Fetching activities for ${userIds.length} users`);

    // GraphQL query
    const query = `
      query ($userIds: [Int], $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          activities(userId_in: $userIds, sort: ID_DESC) {
            ... on ListActivity {
              id
              type
              status
              progress
              createdAt
              user { id name avatar { medium } }
              media { id title { romaji } coverImage { medium } type }
              replyCount
              likeCount
            }
            ... on TextActivity {
              id
              type
              text
              createdAt
              user { id name avatar { medium } }
              replyCount
              likeCount
            }
          }
        }
      }
    `;

    try {
      const response = await this.api.query<{
        Page: { activities: AniListActivity[] };
      }>(query, {
        userIds,
        page: 1,
        perPage: 50,
      });

      return response.Page.activities || [];
    } catch (error) {
      this.logger.error('[ActivityEnhancer] GraphQL query failed', error);
      throw error;
    }
  }

  /**
   * Destroy module
   */
  public override async destroy(): Promise<void> {
    this.filterBar.destroy();
    this.tabManager.destroy();
    this.customActivitiesContainer?.remove();
    await super.destroy();
  }
}
