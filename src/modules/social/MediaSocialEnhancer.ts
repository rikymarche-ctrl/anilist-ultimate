/**
 * @file MediaSocialEnhancer.ts
 * @description Activity filter bar and custom list tabs for individual media pages
 *
 * Refactored to reuse shared ActivityFilterBar, ActivityRenderer, and
 * CustomListTabManager components (66% code reduction from v1).
 * Injects filter UI into the media page's social/activity section and
 * fetches custom list activities via GraphQL.
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @see ActivityFilterBar.ts for the filter UI
 * @see ActivityRenderer.ts for visibility management
 * @see docs/MODULES.md#8-media-social-enhancer-module
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { CustomListService } from './CustomListService';
import { ActivityService } from '../activity/ActivityService';
import type { AniListActivity } from '../activity/ActivityUtils';
import {
  ActivityFilterBar,
  ActivityRenderer,
  CustomListTabManager,
} from '../activity/shared';
import '../../styles/activity-enhancer.css';

/**
 * Media Social Enhancer Module
 * Provides filtering and custom list functionality for media social pages
 */
@injectable()
export class MediaSocialEnhancer extends BaseModule {
  private readonly OBSERVER_NAME = 'media-social-continuous';
  private customActivitiesContainer: HTMLElement | null = null;
  private mediaId: number | null = null;

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.ActivityFilterBar) private filterBar: ActivityFilterBar,
    @inject(TOKENS.ActivityRenderer) private renderer: ActivityRenderer,
    @inject(TOKENS.ActivityTabManager) private tabManager: CustomListTabManager,
    @inject(TOKENS.CustomListService) private customListService: CustomListService,
    @inject(TOKENS.ActivityService) private activityService: ActivityService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    this.logger.info('[MediaSocialEnhancer] Initializing with shared components');

    // Use centralized navigation events instead of polling
    this.onPageChange(() => {
      this.fullCleanup();
      if (this.isOnMediaSocialPage()) {
        this.extractMediaId();
        this.startObservation();
      }
    });

    if (this.isOnMediaSocialPage()) {
      this.extractMediaId();
      this.startObservation();
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'mediaSocialEnhancer';
  }

  /**
   * Check if on media social page or overview page
   */
  private isOnMediaSocialPage(): boolean {
    return /^\/(anime|manga)\/\d+/.test(window.location.pathname);
  }

  /**
   * Extract media ID from URL
   */
  private extractMediaId(): void {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    this.mediaId = match ? parseInt(match[2], 10) : null;
    this.logger.info(`[MediaSocialEnhancer] Media ID: ${this.mediaId}`);
  }

  /**
   * Full cleanup on page change
   */
  private fullCleanup(): void {
    // BUG-007 fix: Unregister from SharedGlobalObserver
    this.sharedObserver.unregister(this.OBSERVER_NAME);

    // Cleanup shared components
    this.filterBar.destroy();
    this.tabManager.destroy();

    // Cleanup custom container
    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;
  }

  /**
   * Start observation
   */
  private startObservation(): void {
    this.checkAndProcess();

    // BUG-007 fix: Use SharedGlobalObserver instead of individual observer
    this.sharedObserver.register(this.OBSERVER_NAME, () => {
      this.checkAndProcess();
    });
  }

  /**
   * Check and process page
   */
  private checkAndProcess(): void {
    const isSocialPage = window.location.pathname.endsWith('/social');
    
    // Inject filter bar
    if (!document.querySelector('.au-activity-bar')) {
      this.injectFilterBar(isSocialPage);
    }

    // Inject custom lists tab
    if (!document.querySelector('.au-custom-list-btn')) {
      this.injectCustomListsTab(isSocialPage);
    }

    const header = this.findSocialHeader(isSocialPage);

    // Apply filters
    const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
    const feed = document.querySelector(feedSelector);
    
    if (feed) {
      this.suspendObserver(this.OBSERVER_NAME);
      this.applyFilters();
      this.hijackFollowingTab(header);
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Helper to find the social section header
   */
  private findSocialHeader(isSocialPage: boolean): Element | null {
    if (isSocialPage) {
      return document.querySelector('.section-header');
    } else {
      const headers = Array.from(document.querySelectorAll('.section-header'));
      return headers.find(h => h.textContent?.includes('Recent Activity')) || null;
    }
  }

  /**
   * Hijack the native "Following" tab to provide a reliable Astra feed
   */
  private hijackFollowingTab(header: Element | null): void {
    if (!header) return;
    
    const tabs = header.querySelectorAll('.feed-type-toggle .button');
    tabs.forEach(tab => {
      const text = tab.textContent?.trim();
      if (text === 'Following' && !tab.hasAttribute('data-au-hijacked')) {
        tab.setAttribute('data-au-hijacked', 'true');
        
        // Listener for click
        tab.addEventListener('click', () => {
          this.logger.info('[MediaSocialEnhancer] "Following" tab clicked, monitoring for stall');
          this.monitorFollowingStall();
        }, true);
      }
    });

    // Handle initial state if page loads with Following active
    const activeTab = header.querySelector('.feed-type-toggle .button.active');
    if (activeTab?.textContent?.trim() === 'Following' && !this.isAstraActive()) {
       this.monitorFollowingStall();
    }
  }

  private isAstraActive(): boolean {
    return this.tabManager.isActive() || !!document.querySelector('.au-astra-following-active');
  }

  /**
   * Monitor if the native following feed stalls, then take over
   */
  private monitorFollowingStall(): void {
    const checkDelay = 1500;
    setTimeout(async () => {
      const isSocialPage = window.location.pathname.endsWith('/social');
      const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
      const container = document.querySelector(feedSelector) as HTMLElement;
      
      if (!container) return;

      // Check if Following is still active
      const activeTab = document.querySelector('.feed-type-toggle .button.active');
      if (activeTab?.textContent?.trim() !== 'Following') return;

      // Check for stall/empty
      const isEmpty = container.children.length === 0 || 
                      (container.children.length === 1 && container.querySelector('.loading-spinner'));
      
      if (isEmpty) {
        this.logger.warn('[MediaSocialEnhancer] Native Following feed stalled. Taking over...');
        container.classList.add('au-astra-following-active');
        await this.loadAstraFollowingFeed(container);
      }
    }, checkDelay);
  }

  /**
   * Load the following feed via Astra API
   */
  private async loadAstraFollowingFeed(container: HTMLElement): Promise<void> {
    if (!this.mediaId) return;

    this.renderer.showLoader(container);

    try {
      const { activities } = await this.activityService.getMediaActivity(this.mediaId);
      
      if (activities.length === 0) {
        this.renderer.showEmptyMessage(container);
      } else {
        this.renderer.renderCustomActivities(activities as any, container);
        this.logger.success(`[MediaSocialEnhancer] Rendered ${activities.length} activities via Astra`);
      }
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] Astra takeover failed', error);
      this.renderer.showEmptyMessage(container);
    }
  }

  /**
   * Inject filter bar using shared component
   */
  private injectFilterBar(isSocialPage: boolean): void {
    let header: Element | null = null;
    
    if (isSocialPage) {
      header = document.querySelector('.section-header');
    } else {
      // On Overview, find the header that specifically belongs to the Social/Activity section
      const headers = Array.from(document.querySelectorAll('.section-header'));
      header = headers.find(h => h.textContent?.includes('Recent Activity')) || null;
    }

    if (!header) return;

    const isManga = window.location.pathname.includes('/manga/');

    this.filterBar.configure({
      filters: ActivityFilterBar.getStandardFilters(isManga ? 'manga' : 'anime', false),
      showSearch: true,
      onFilterChange: () => this.applyFilters(),
      onSearchChange: () => this.applyFilters(),
    });

    // Create and inject
    const bar = this.filterBar.create();

    // Force reset to 'ALL' on every page navigation
    this.filterBar.reset();

    bar.classList.add('au-media-social-bar');

    // Media Social page needs special layout handling (header flex container)
    bar.style.setProperty('margin-top', '12px', 'important'); // Space from Self/Following/Global tabs
    bar.style.setProperty('margin-bottom', '8px', 'important'); // Space before first entry
    bar.style.width = '100%';
    bar.style.flexBasis = '100%';
    bar.style.order = '10'; // Ensure it stays at the bottom

    // Fix button spacing - AGGRESSIVE approach with !important
    const applySpacing = () => {
      const buttons = bar.querySelectorAll('.au-filter-btn');
      buttons.forEach((btn, index) => {
        if (index > 0) {
          (btn as HTMLElement).style.setProperty('margin-left', '8px', 'important');
        }
      });
      // Also force the container to have gap
      const container = bar.querySelector('.au-activity-bar__left') as HTMLElement;
      if (container) {
        container.style.setProperty('gap', '8px', 'important');
        container.style.setProperty('display', 'flex', 'important');
      }
    };

    // Apply immediately
    applySpacing();

    // Apply again after a small delay in case of re-render
    setTimeout(applySpacing, 100);

    // Header needs flex layout for proper bar positioning
    (header as HTMLElement).style.display = 'flex';
    (header as HTMLElement).style.flexWrap = 'wrap';
    (header as HTMLElement).style.alignItems = 'center';
    (header as HTMLElement).style.justifyContent = 'space-between';

    const tabs = header.querySelector('.feed-type-toggle');
    if (tabs) {
      // If tabs exist, keep them in place and just append the bar
      header.appendChild(bar);
    } else {
      header.appendChild(bar);
    }

    this.logger.success(`[MediaSocialEnhancer] Filter bar injected on ${isSocialPage ? 'Social' : 'Overview'} page`);
  }

  /**
   * Inject custom lists tab using shared component
   */
  private async injectCustomListsTab(isSocialPage: boolean): Promise<void> {
    // Determine the correct toggle container
    let toggleSelector = '.feed-type-toggle';
    
    if (!isSocialPage) {
      // On Overview, find the toggle that has Self/Following/Global
      const toggles = Array.from(document.querySelectorAll('.feed-type-toggle'));
      const socialToggle = toggles.find(t => t.textContent?.includes('Following'));
      if (socialToggle) {
        // We might need a unique way to identify it if there are multiple
        socialToggle.classList.add('au-social-toggle');
        toggleSelector = '.au-social-toggle';
      }
    }

    // Configure tab manager
    this.tabManager.configure({
      toggleSelector: toggleSelector,
      scopeAttribute: 'data-v-4f9e87dc',
      onListChange: (listName) => this.handleListChange(listName),
    });

    // Inject
    const success = await this.tabManager.inject();
    if (success) {
      this.logger.success(`[MediaSocialEnhancer] Custom lists tab injected on ${isSocialPage ? 'Social' : 'Overview'}`);
    }
  }

  /**
   * Apply filters using shared renderer
   */
  private applyFilters(): void {
    if (this.tabManager.isActive()) {
      this.renderer.hideNativeActivities();
      return;
    }

    const activeFilters = this.filterBar.getActiveFilters();
    const searchQuery = this.filterBar.getSearchQuery();

    // Use a more inclusive selector that works across both Social and Overview pages
    this.renderer.configure({
      activitySelector: '.activity-entry, .activity-anime, .activity-manga, .activity-text',
    });

    this.renderer.applyFilters(activeFilters, searchQuery);
  }

  /**
   * Handle custom list change
   */
  private async handleListChange(listName: string | null): Promise<void> {
    this.logger.info(`[MediaSocialEnhancer] Custom list changed: ${listName || 'none'}`);

    if (listName) {
      // Show custom list activities
      await this.loadCustomListActivities(listName);
    } else {
      // Clear custom list, show native activities
      this.clearCustomActivities();
      this.renderer.showNativeActivities();
      this.checkAndProcess();
    }
  }

  /**
   * Load and display custom list activities for this media
   */
  private async loadCustomListActivities(listName: string): Promise<void> {
    if (!this.mediaId) {
      this.logger.warn('[MediaSocialEnhancer] No media ID available');
      return;
    }

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
      // Fetch activities for this media from custom list users
      const activities = await this.fetchCustomListActivitiesForMedia(listName, this.mediaId);

      // Render activities
      if (this.customActivitiesContainer) {
        this.renderer.renderCustomActivities(activities, this.customActivitiesContainer);
      }
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] Failed to load custom list activities', error);
      if (this.customActivitiesContainer) {
        this.renderer.showEmptyMessage(this.customActivitiesContainer);
      }
    }
  }

  /**
   * Create container for custom activities
   */
  private createCustomActivitiesContainer(): void {
    const isSocialPage = window.location.pathname.endsWith('/social');
    const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
    const feed = document.querySelector(feedSelector);
    
    if (!feed) return;

    const container = document.createElement('div');
    container.className = 'au-custom-activities-container';
    
    // On Overview, we usually want to prepend to the sidebar activities
    if (isSocialPage) {
      feed.appendChild(container);
    } else {
      feed.prepend(container);
    }

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
   * Fetch activities for custom list users filtered by media ID
   */
  private async fetchCustomListActivitiesForMedia(
    listName: string,
    mediaId: number
  ): Promise<AniListActivity[]> {
    const lists = this.customListService.getLists();
    const userIds = lists[listName] || [];

    if (userIds.length === 0) {
      return [];
    }

    this.logger.info(
      `[MediaSocialEnhancer] Fetching activities for media ${mediaId} from ${userIds.length} users`
    );

    // GraphQL query filtered by media ID
    const query = `
      query ($userIds: [Int], $mediaId: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          activities(userId_in: $userIds, mediaId: $mediaId, sort: ID_DESC) {
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
          }
        }
      }
    `;

    try {
      const response = await this.api.query<{
        Page: { activities: AniListActivity[] };
      }>(query, {
        userIds,
        mediaId,
        page: 1,
        perPage: 50,
      });

      return response.Page.activities || [];
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] GraphQL query failed', error);
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
