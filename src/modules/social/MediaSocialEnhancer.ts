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
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { AniListActivity } from '../activity/ActivityUtils';
import { activityUserIds, parseActivityPage } from '../activity/ActivityResponse';
import {
  ActivityFilterBar,
  ActivityRenderer,
  CustomListTabManager,
} from '../activity/shared';
import { ensurePersistentLoadMore, removePersistentLoadMore } from '../activity/shared/PersistentLoadMore';
import { NATIVE_ACTIVITY_SELECTOR } from '../activity/shared/ActivityRenderer';
import '../../styles/activity-enhancer.css';

/**
 * Media Social Enhancer Module
 * Provides filtering and custom list functionality for media social pages
 */
@injectable()
export class MediaSocialEnhancer extends BaseModule {
  /** Observer name for targeted mutation tracking */
  private readonly OBSERVER_NAME = 'media-social-continuous';
  
  /** Container for custom activities rendered via Astra */
  private customActivitiesContainer: HTMLElement | null = null;
  
  /** The current media ID extracted from the URL */
  private mediaId: number | null = null;
  
  /** Timeout for the "Following" tab stall detection */
  private stallTimeout: number | null = null;
  private spacingTimeout: number | null = null;
  private generation = 0;
  private listRequest = 0;
  private followingRequest = 0;
  private destroyed = false;
  private injectingTab = false;
  private followingListeners = new Map<Element, EventListener>();
  private followingContainer: HTMLElement | null = null;
  private followingNodes: Element[] = [];

  private isCurrent(generation: number, path: string): boolean {
    return !this.destroyed && generation === this.generation && path === window.location.pathname;
  }

  private restart(): void {
    this.fullCleanup();
    if (!this.destroyed && this.isOnMediaSocialPage()) {
      this.extractMediaId();
      this.startObservation();
    }
  }

  private clearFollowingFeed(): void {
    if (!this.followingContainer) return;
    for (const node of this.followingNodes) node.remove();
    this.followingNodes = [];
    this.followingContainer.classList.remove('au-astra-following-active');
    this.followingContainer = null;
  }

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
   * Initialize the module.
   * Sets up page change listeners and initial page detection.
   */
  public async init(): Promise<void> {
    this.logger.info('[MediaSocialEnhancer] Initializing with shared components');

    this.destroyed = false;
    this.onPageChange(() => this.restart());
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => this.restart());
    this.restart();
  }

  public getName(): string {
    return 'mediaSocialEnhancer';
  }

  private isOnMediaSocialPage(): boolean {
    return /^\/(anime|manga)\/[1-9]\d*(?:\/|$)/.test(window.location.pathname);
  }

  private extractMediaId(): void {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    this.mediaId = match ? parseInt(match[2], 10) : null;
    this.logger.info(`[MediaSocialEnhancer] Media ID: ${this.mediaId}`);
  }

  private fullCleanup(): void {
    this.generation++;
    this.listRequest++;
    this.followingRequest++;
    this.injectingTab = false;
    this.mediaId = null;
    this.cleanup();
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    if (this.spacingTimeout !== null) window.clearTimeout(this.spacingTimeout);
    this.spacingTimeout = null;
    for (const [tab, listener] of this.followingListeners) {
      tab.removeEventListener('click', listener, true);
      tab.removeAttribute('data-au-hijacked');
    }
    this.followingListeners.clear();
    this.clearFollowingFeed();
    this.renderer.showNativeActivities();

    if (this.stallTimeout !== null) {
      window.clearTimeout(this.stallTimeout);
      this.stallTimeout = null;
    }

    this.filterBar.destroy();
    this.tabManager.destroy();

    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;
    removePersistentLoadMore();
  }

  /**
   * Registers the module with the SharedGlobalObserver.
   */
  private startObservation(): void {
    this.checkAndProcess();

    this.sharedObserver.register(this.OBSERVER_NAME, () => {
      this.checkAndProcess();
    });
  }

  private checkAndProcess(): void {
    if (this.destroyed || !this.isOnMediaSocialPage()) return;
    const isSocialPage = window.location.pathname.endsWith('/social');
    
    if (!document.querySelector('.au-activity-bar')) {
      this.injectFilterBar(isSocialPage);
    }

    if (!document.querySelector('.au-custom-list-btn') && !this.injectingTab) {
      const generation = this.generation;
      this.injectingTab = true;
      void this.injectCustomListsTab(isSocialPage)
        .catch(error => this.logger.error('[MediaSocialEnhancer] Tab injection failed', error))
        .finally(() => { if (generation === this.generation) this.injectingTab = false; });
    }

    const header = this.findSocialHeader(isSocialPage);

    const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
    const feed = document.querySelector(feedSelector);
    
    if (feed) {
      ensurePersistentLoadMore(feed);
      this.suspendObserver(this.OBSERVER_NAME);
      this.applyFilters();
      this.hijackFollowingTab(header);
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private findSocialHeader(isSocialPage: boolean): Element | null {
    if (isSocialPage) {
      return document.querySelector('.section-header');
    } else {
      const headers = Array.from(document.querySelectorAll('.section-header'));
      return headers.find(h => h.textContent?.includes('Recent Activity')) || null;
    }
  }

  private hijackFollowingTab(header: Element | null): void {
    if (!header) return;
    
    const tabs = header.querySelectorAll('.feed-type-toggle .button');
    tabs.forEach(tab => {
      const text = tab.textContent?.trim();
      if (!this.followingListeners.has(tab)) {
        tab.setAttribute('data-au-hijacked', 'true');
        
        const listener: EventListener = () => {
          this.followingRequest++;
          this.clearFollowingFeed();
          if (this.stallTimeout !== null) window.clearTimeout(this.stallTimeout);
          this.stallTimeout = null;
          if (text === 'Following') this.monitorFollowingStall();
        };
        tab.addEventListener('click', listener, true);
        this.followingListeners.set(tab, listener);
      }
    });

    const activeTab = header.querySelector('.feed-type-toggle .button.active');
    if (activeTab?.textContent?.trim() === 'Following' && !this.isAstraActive()) {
       this.monitorFollowingStall();
    }
  }

  private isAstraActive(): boolean {
    return this.tabManager.isActive() || !!document.querySelector('.au-astra-following-active');
  }

  /**
   * Monitors the "Following" feed for stalls.
   * If the native feed fails to load, Astra takes over and renders its own feed.
   */
  private monitorFollowingStall(): void {
    const checkDelay = 1500;
    if (this.destroyed || this.stallTimeout !== null || this.isAstraActive()) return;
    const generation = this.generation;
    const path = window.location.pathname;
    
    this.stallTimeout = window.setTimeout(() => {
      this.stallTimeout = null;
      if (!this.isCurrent(generation, path)) return;
      const isSocialPage = window.location.pathname.endsWith('/social');
      const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
      const container = document.querySelector(feedSelector) as HTMLElement;
      
      if (!container) return;

      const activeTab = document.querySelector('.feed-type-toggle .button.active');
      if (activeTab?.textContent?.trim() !== 'Following') return;

      const children = [...container.children].filter(child => !child.classList.contains('au-persistent-load-more'));
      const isEmpty = children.length === 0 ||
                      (children.length === 1 && children[0].matches('.loading-spinner'));
      
      if (isEmpty) {
        this.logger.warn('[MediaSocialEnhancer] Native Following feed stalled. Taking over...');
        container.classList.add('au-astra-following-active');
        void this.loadAstraFollowingFeed(container);
      }
    }, checkDelay);
  }

  private async loadAstraFollowingFeed(container: HTMLElement): Promise<void> {
    const mediaId = this.mediaId;
    if (!mediaId || this.destroyed) return;
    const generation = this.generation;
    const path = window.location.pathname;
    const request = ++this.followingRequest;
    const listRequest = this.listRequest;
    this.followingContainer = container;
    const current = () => this.isCurrent(generation, path) && container.isConnected
      && request === this.followingRequest && listRequest === this.listRequest
      && !this.tabManager.isActive()
      && this.followingNodes.every(node => node.parentElement === container)
      && [...container.children].every(node => this.followingNodes.includes(node) || node.classList.contains('au-persistent-load-more'))
      && document.querySelector('.feed-type-toggle .button.active')?.textContent?.trim() === 'Following';

    try {
      this.renderer.showLoader(container);
      this.followingNodes = [...container.children].filter(node => !node.classList.contains('au-persistent-load-more'));
      const { activities } = await this.activityService.getMediaActivity(mediaId);
      if (!current()) return;
      if (activities.length === 0) this.renderer.showEmptyMessage(container);
      else this.renderer.renderCustomActivities(activities, container);
      this.followingNodes = [...container.children].filter(node => !node.classList.contains('au-persistent-load-more'));
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] Astra takeover failed', error);
      if (current()) {
        this.clearFollowingFeed();
      }
    }
  }

  private injectFilterBar(isSocialPage: boolean): void {
    let header: Element | null;
    
    if (isSocialPage) {
      header = document.querySelector('.section-header');
    } else {
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

    const bar = this.filterBar.create();
    this.filterBar.reset();

    bar.classList.add('au-media-social-bar');
    if (isSocialPage) {
      bar.classList.add('au-media-social-page-bar');
    }
    bar.style.setProperty('margin-top', '12px', 'important');
    bar.style.setProperty('margin-bottom', '8px', 'important');
    bar.style.width = '100%';
    bar.style.flexBasis = '100%';
    bar.style.order = '10';

    const applySpacing = () => {
      const buttons = bar.querySelectorAll('.au-filter-btn');
      buttons.forEach((btn, index) => {
        if (index > 0) {
          (btn as HTMLElement).style.setProperty('margin-left', '8px', 'important');
        }
      });
      const container = bar.querySelector('.au-activity-bar__left') as HTMLElement;
      if (container) {
        container.style.setProperty('gap', '8px', 'important');
        container.style.setProperty('display', 'flex', 'important');
      }
    };

    applySpacing();
    if (this.spacingTimeout !== null) window.clearTimeout(this.spacingTimeout);
    const generation = this.generation;
    this.spacingTimeout = window.setTimeout(() => {
      this.spacingTimeout = null;
      if (generation === this.generation && bar.isConnected) applySpacing();
    }, 100);

    (header as HTMLElement).style.display = 'flex';
    (header as HTMLElement).style.flexWrap = 'wrap';
    (header as HTMLElement).style.alignItems = 'center';
    (header as HTMLElement).style.justifyContent = 'space-between';

    header.appendChild(bar);
    this.logger.success(`[MediaSocialEnhancer] Filter bar injected on ${isSocialPage ? 'Social' : 'Overview'} page`);
  }

  private async injectCustomListsTab(isSocialPage: boolean): Promise<void> {
    let toggleSelector = '.feed-type-toggle';
    
    if (!isSocialPage) {
      const toggles = Array.from(document.querySelectorAll('.feed-type-toggle'));
      const socialToggle = toggles.find(t => t.textContent?.includes('Following'));
      if (socialToggle) {
        socialToggle.classList.add('au-social-toggle');
        toggleSelector = '.au-social-toggle';
      }
    }

    this.tabManager.configure({
      toggleSelector: toggleSelector,
      scopeAttribute: 'data-v-4f9e87dc',
      onListChange: (listName) => {
        void this.handleListChange(listName).catch((error: unknown) => this.logger.error('[MediaSocialEnhancer] List change failed', error));
      },
    });

    const success = await this.tabManager.inject();
    if (success) {
      this.logger.success(`[MediaSocialEnhancer] Custom lists tab injected on ${isSocialPage ? 'Social' : 'Overview'}`);
    }
  }

  private applyFilters(): void {
    if (this.tabManager.isActive()) {
      this.renderer.hideNativeActivities();
      return;
    }

    const activeFilters = this.filterBar.getActiveFilters();
    const searchQuery = this.filterBar.getSearchQuery();

    this.renderer.configure({
      // Custom-list results share native classes; keep them out of native filter passes.
      activitySelector: NATIVE_ACTIVITY_SELECTOR,
    });

    this.renderer.applyFilters(activeFilters, searchQuery);
  }

  private async handleListChange(listName: string | null): Promise<void> {
    this.listRequest++;
    this.followingRequest++;
    if (this.destroyed) return;
    this.clearFollowingFeed();
    this.logger.info(`[MediaSocialEnhancer] Custom list changed: ${listName || 'none'}`);

    if (listName) {
      await this.loadCustomListActivities(listName);
    } else {
      this.clearCustomActivities();
      this.renderer.showNativeActivities();
      this.checkAndProcess();
    }
  }

  private async loadCustomListActivities(listName: string): Promise<void> {
    if (!this.mediaId) {
      this.logger.warn('[MediaSocialEnhancer] No media ID available');
      return;
    }

    this.renderer.hideNativeActivities();

    if (!this.customActivitiesContainer) {
      this.createCustomActivitiesContainer();
    }

    if (this.customActivitiesContainer) {
      this.renderer.showLoader(this.customActivitiesContainer);
    }

    const mediaId = this.mediaId;
    const generation = this.generation;
    const path = window.location.pathname;
    const request = this.listRequest;
    const container = this.customActivitiesContainer;
    const current = () => this.isCurrent(generation, path) && request === this.listRequest
      && !!container?.isConnected && container === this.customActivitiesContainer;

    try {
      const activities = await this.fetchCustomListActivitiesForMedia(listName, mediaId, current);
      if (current() && container) {
        this.renderer.renderCustomActivities(activities, container);
      }
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] Failed to load custom list activities', error);
      if (current() && container) {
        this.renderer.showErrorMessage(container, () => { if (current()) void this.handleListChange(listName); });
      }
    }
  }

  private createCustomActivitiesContainer(): void {
    const isSocialPage = window.location.pathname.endsWith('/social');
    const feedSelector = isSocialPage ? '.activity-feed' : '.activities';
    const feed = document.querySelector(feedSelector);
    
    if (!feed) return;

    const container = document.createElement('div');
    container.className = 'au-custom-activities-container';
    
    if (isSocialPage) {
      feed.appendChild(container);
    } else {
      feed.prepend(container);
    }

    this.customActivitiesContainer = container;
  }

  private clearCustomActivities(): void {
    if (this.customActivitiesContainer) {
      this.renderer.clear(this.customActivitiesContainer);
    }
  }

  private async fetchCustomListActivitiesForMedia(
    listName: string,
    mediaId: number,
    current: () => boolean
  ): Promise<AniListActivity[]> {
    const lists = this.customListService.getLists();
    const userIds = activityUserIds(lists[listName] || []);

    if (userIds.length === 0) {
      return [];
    }

    this.logger.info(
      `[MediaSocialEnhancer] Fetching activities for media ${mediaId} from ${userIds.length} users`
    );

    const query = `
      query ($userIds: [Int], $mediaId: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          activities(userId_in: $userIds, mediaId: $mediaId, type: MEDIA_LIST, sort: ID_DESC) {
            ... on ListActivity {
              id
              type
              userId
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

    const context = await captureApiContext(this.api);
    if (!current()) throw new Error('Activity request is no longer active');
    assertApiContext(this.api, context);
    try {
      const response = await this.api.query<unknown>(query, {
        userIds,
        mediaId,
        page: 1,
        perPage: 50,
      });

      assertApiContext(this.api, context);
      return parseActivityPage(response, { mediaId, userIds }).activities;
    } catch (error) {
      this.logger.error('[MediaSocialEnhancer] GraphQL query failed', error);
      throw error;
    }
  }

  /**
   * Teardown logic to clear intervals, observers, and UI containers.
   */
  public override async destroy(): Promise<void> {
    this.destroyed = true;
    this.fullCleanup();
    await super.destroy();
  }
}
