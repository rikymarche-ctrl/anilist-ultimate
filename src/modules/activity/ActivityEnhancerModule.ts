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
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CustomListService } from '../social/CustomListService';
import type { ActivityFilterType } from './ActivityUtils';
import { activityUserIds } from './ActivityResponse';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { ActivityFilterBar, ActivityRenderer, CustomListTabManager } from './shared';
import {
  ensurePersistentLoadMore,
  removePersistentLoadMore,
  setLoadMoreOverride,
  setLoadMoreState,
} from './shared/PersistentLoadMore';
import {
  FilteredFeedCursor,
  isNarrowing,
  type FeedBatch,
  type FeedFilter,
  type FeedSource,
} from './FilteredFeed';
import { NATIVE_ACTIVITY_SELECTOR } from './shared/ActivityRenderer';
import { NATIVE_TEMPLATE_ROW_SELECTOR } from './shared/ActivityTemplates';
import '../../styles/activity-enhancer.css';

/** A custom feed never spins forever: past this it shows the retry state. */
const CUSTOM_FEED_TIMEOUT_MS = 20_000;
/** How long a load waits for AniList to draw a native row to clone (an empty feed never does). */
const NATIVE_ROW_WAIT_MS = 4_000;
/** Typing pauses this long before a search refetches the extension feed. */
const SEARCH_DEBOUNCE_MS = 400;
/** At most this many automatic feed reloads per window. */
const MAX_HEAL_RELOADS = 3;
const HEAL_WINDOW_MS = 60_000;
/** Classes AniList may use to mark the selected Following/Global tab. */
const FEED_TAB_ACTIVE_CLASSES = ['active', 'router-link-active', 'router-link-exact-active', 'selected'];

function emptyFeedMessage(source: FeedSource, filter: FeedFilter, hasMore: boolean): string {
  if (source.kind === 'users' && !isNarrowing(filter))
    return 'No activities found for the users in this list.';
  return hasMore
    ? 'Nothing matches this filter in the recent activity. Load More looks further back.'
    : 'No activity matches this filter.';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`Custom feed request timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

/**
 * Activity Enhancer Module
 * Provides filtering and custom list functionality for activity feeds
 */
@injectable()
export class ActivityEnhancerModule extends BaseModule {
  private readonly OBSERVER_NAME = 'activity-continuous';
  private customActivitiesContainer: HTMLElement | null = null;
  private isProcessing = false;
  private generation = 0;
  private listVersion = 0;
  /** 'query' while the extension feed (custom list or server-side filter) replaces AniList's rows. */
  private feedMode: 'native' | 'query' = 'native';
  private feedCursor: FilteredFeedCursor | null = null;
  private loadingMore = false;
  /** True while the first batch of the extension feed is loading. */
  private feedLoading = false;
  /** Times of recent self-heal reloads; capped so a feed that renders empty cannot spam the API. */
  private healReloads: number[] = [];
  private searchTimer: number | null = null;
  private destroyed = false;
  private activeListName: string | null = null; // BUG-005 fix
  /** Reinstates the stable Load More control after AniList replaces the feed. */
  private loadMoreReconcileInterval: number | null = null;
  /** Element the targeted feed observer watches; replaced when Vue redraws the feed. */
  private observedFeed: HTMLElement | null = null;

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
    this.destroyed = false;
    this.logger.info('[ActivityEnhancer] Initializing with shared components');

    // Use centralized navigation events instead of polling
    this.onPageChange(() => {
      void this.handlePageChange().catch((error: unknown) =>
        this.logger.error('[ActivityEnhancer] Page change handling failed', error)
      );
    });

    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      void this.handleAuthStateChanged().catch((error: unknown) =>
        this.logger.error('[ActivityEnhancer] Auth state handling failed', error)
      );
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
    this.generation++;
    this.listVersion++;
    this.isProcessing = false;
    this.suspendObserver(this.OBSERVER_NAME);
    this.cleanup();

    // Cleanup shared components
    this.filterBar.destroy();
    this.tabManager.destroy();

    // Cleanup custom container
    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;
    this.feedMode = 'native';
    this.feedLoading = false;
    this.feedCursor = null;
    this.loadingMore = false;
    this.observedFeed = null;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    setLoadMoreOverride(null);
    removePersistentLoadMore();
    if (this.loadMoreReconcileInterval !== null) {
      window.clearInterval(this.loadMoreReconcileInterval);
      this.loadMoreReconcileInterval = null;
    }
  }

  /**
   * Start observation
   */
  private async handlePageChange(): Promise<void> {
    this.fullCleanup();
    if (this.isOnActivityPage()) {
      await this.startObservation();
    }
  }

  private async handleAuthStateChanged(): Promise<void> {
    this.activeListName = null;
    this.fullCleanup();
    if (this.isOnActivityPage() && !this.destroyed) await this.startObservation();
  }

  private async startObservation(): Promise<void> {
    const generation = this.generation;
    void this.checkAndProcess();

    // BUG-007 fix: Observe specific activity feed container instead of document.body.
    // PAGE_CHANGED fires before Vue swaps the view: the previous page (a profile) may still show its
    // own .activity-feed. The Following/Global toggle exists only on the home feed, so wait for it.
    await this.waitForElement('.feed-type-toggle', 5000);
    if (this.destroyed || generation !== this.generation || !this.isOnActivityPage()) return;
    const container = document.querySelector<HTMLElement>(
      '.activity-feed-wrap, .activity-feed, .feed-container'
    );
    this.observedFeed = container;
    if (!container) {
      this.logger.warn(
        '[ActivityEnhancer] Activity feed container not found, falling back to document.body'
      );
      this.registerObserver(
        this.OBSERVER_NAME,
        document.body,
        { childList: true, subtree: true },
        () => {
          void this.checkAndProcess().catch((error: unknown) =>
            this.logger.error('[ActivityEnhancer] Observer processing failed', error)
          );
        }
      );
    } else {
      this.observeFeed(container);
    }

    // Call checkAndProcess AGAIN to catch anything rendered while we were waiting
    void this.checkAndProcess().catch((error: unknown) =>
      this.logger.error('[ActivityEnhancer] Initial processing failed', error)
    );

    // AniList occasionally replaces the complete feed during a soft refresh,
    // disconnecting a targeted observer from the new node. Reconcile only the
    // stable Load More control until the next navigation cleanup.
    if (this.loadMoreReconcileInterval === null) {
      this.loadMoreReconcileInterval = window.setInterval(() => {
        const currentFeed = document.querySelector(
          '.activity-feed-wrap, .activity-feed, .feed-container'
        );
        if (currentFeed && this.isOnActivityPage()) {
          // The observed feed was replaced by Vue: a targeted observer on a detached node never fires again.
          if (this.observedFeed && !this.observedFeed.isConnected) {
            this.observeFeed(currentFeed as HTMLElement);
            void this.checkAndProcess().catch((error: unknown) =>
              this.logger.error('[ActivityEnhancer] Re-observe processing failed', error)
            );
          }
          ensurePersistentLoadMore(currentFeed);
          this.ensureQueryFeedShown();
        }
      }, 2000);
    }
  }

  /** Observes only the activity feed container for better performance (BUG-007). */
  private observeFeed(container: HTMLElement): void {
    this.observedFeed = container;
    this.registerObserver(
      this.OBSERVER_NAME,
      container,
      { childList: true, subtree: true },
      () => {
        void this.checkAndProcess().catch((error: unknown) =>
          this.logger.error('[ActivityEnhancer] Observer processing failed', error)
        );
      }
    );
    this.logger.debug('[ActivityEnhancer] Observing activity feed container (BUG-007 optimization)');
  }

  /**
   * Check and process page
   */
  private async checkAndProcess(): Promise<void> {
    if (this.destroyed || this.isProcessing) return;
    const generation = this.generation;

    const feed = document.querySelector('.activity-feed-wrap, .activity-feed, .feed-container');
    const bar = document.querySelector('.au-activity-bar');
    const customTab = document.querySelector('.au-custom-list-btn');

    // If we are not on activity page, skip
    if (!this.isOnActivityPage()) return;
    // Right after SPA navigation the path is already /home while the DOM is still the previous
    // page; building into that stale feed starts a custom-feed load Vue then throws away.
    if (!document.querySelector('.feed-type-toggle')) return;

    // Bar + custom tab already injected: nothing to build, BUT the observer also
    // fires when AniList lazy-loads more entries (Load More / infinite scroll).
    // Re-apply the active filter so the freshly loaded entries are filtered
    // automatically — previously this returned early, leaving new entries
    // unfiltered until the user re-clicked the filter. applyFilters() only
    // toggles style.display/classes (attribute mutations), which the childList
    // observer ignores, so this cannot loop.
    if (bar && customTab) {
      if (feed) {
        ensurePersistentLoadMore(feed);
        this.applyFilters();
      }
      return;
    }

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

      if (this.destroyed || generation !== this.generation || !this.isOnActivityPage()) return;
      // Apply filters to feed
      if (feed) {
        ensurePersistentLoadMore(feed);
        this.applyFilters();
      }
    } catch (error) {
      this.logger.error('[ActivityEnhancer] Processing failed', error);
    } finally {
      if (generation === this.generation && !this.destroyed) {
        this.isProcessing = false;
        this.resumeObserver(this.OBSERVER_NAME);
      }
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
      onFilterChange: () => void this.reloadFeed(),
      onSearchChange: () => this.onSearchInput(),
    });

    // Create and inject
    const bar = this.filterBar.create();

    // Force reset to 'ALL' on every page navigation
    this.filterBar.reset();

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
        void this.handleListChange(listName).catch((error: unknown) =>
          this.logger.error('[ActivityEnhancer] List change failed', error)
        );
      },
      initialSelection: this.activeListName, // BUG-005 fix: Restore previous selection
      persistKey: 'au-home-custom-feed', // Survives reloads in this tab
    });

    // Inject
    const success = await this.tabManager.inject();
    if (success) {
      this.logger.success('[ActivityEnhancer] Custom lists tab injected');
    }
  }

  /**
   * Re-applies the current feed state without fetching; runs on every feed mutation.
   * The extension feed (custom list or server-side filter) replaces AniList's rows,
   * otherwise the filter bar filters AniList's rows in place.
   */
  private applyFilters(): void {
    this.useNativeRowSelector();
    // AniList switched Following/Global, or auth changed: the right feed differs from the shown one.
    if ((this.feedSource() !== null) !== (this.feedMode === 'query')) {
      void this.reloadFeed();
      return;
    }
    if (this.feedMode === 'query') {
      this.renderer.hideNativeActivities();
      this.ensureQueryFeedShown();
      return;
    }
    this.renderer.applyFilters(this.filterBar.getActiveFilters(), this.filterBar.getSearchQuery());
  }

  /**
   * The renderer is a singleton shared with the profile and media modules, which configure their
   * own selector. Re-assert ours before every hide/show/filter, or a selector left by another page
   * would match custom-list rows and hide the whole extension feed after SPA navigation.
   */
  private useNativeRowSelector(): void {
    this.renderer.configure({ activitySelector: NATIVE_ACTIVITY_SELECTOR });
  }

  /** Search typing: instant on AniList's rows, debounced when it refetches the extension feed. */
  private onSearchInput(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    if (this.feedMode === 'native' && this.feedSource() === null) {
      this.applyFilters();
      return;
    }
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.reloadFeed();
    }, SEARCH_DEBOUNCE_MS);
  }

  private currentFeedFilter(): FeedFilter {
    const filters = this.filterBar.getActiveFilters();
    return {
      filters: filters?.size ? filters : new Set<ActivityFilterType>(['ALL']),
      search: (this.filterBar.getSearchQuery() || '').trim().toLowerCase(),
    };
  }

  /**
   * Which activities the extension must fetch, or null when AniList's own feed is right:
   * a custom list always; a narrowing filter on Following when the extension can query as the viewer.
   * Global has no API equivalent, so it keeps on-page filtering.
   */
  private feedSource(): FeedSource | null {
    if (this.activeListName) {
      const users = this.customListService.getLists()[this.activeListName] || [];
      return { kind: 'users', userIds: activityUserIds(users) };
    }
    if (isNarrowing(this.currentFeedFilter()) && this.isFollowingFeed() && this.api.isAuthenticated())
      return { kind: 'following' };
    return null;
  }

  private isFollowingFeed(): boolean {
    const tab = Array.from(
      document.querySelectorAll<HTMLElement>('.feed-type-toggle > :not(.au-custom-list-btn)')
    ).find((el) => el.textContent?.trim().toLowerCase() === 'following');
    return Boolean(tab && FEED_TAB_ACTIVE_CLASSES.some((name) => tab.classList.contains(name)));
  }

  /**
   * Handle custom list change
   */
  private handleListChange(listName: string | null): Promise<void> {
    this.activeListName = listName;
    return this.reloadFeed();
  }

  /** Shows the right feed for the current list, filter and search; the latest call wins. */
  private async reloadFeed(): Promise<void> {
    if (this.destroyed || !this.isOnActivityPage()) return;
    const version = ++this.listVersion;
    const generation = this.generation;
    const isCurrent = (): boolean =>
      !this.destroyed &&
      generation === this.generation &&
      version === this.listVersion &&
      this.isOnActivityPage();
    this.suspendObserver(this.OBSERVER_NAME);
    this.useNativeRowSelector();
    try {
      const source = this.feedSource();
      if (source) await this.loadQueryFeed(source, isCurrent);
      else this.showNativeFeed();
    } catch (error) {
      if (isCurrent()) this.logger.error('[ActivityEnhancer] Failed to reload the feed', error);
    } finally {
      if (isCurrent()) this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private showNativeFeed(): void {
    this.feedMode = 'native';
    this.feedLoading = false;
    this.feedCursor = null;
    setLoadMoreOverride(null);
    this.clearCustomActivities();
    this.renderer.showNativeActivities();
    this.applyFilters();
  }

  private async loadQueryFeed(source: FeedSource, isCurrent: () => boolean): Promise<void> {
    this.feedMode = 'query';
    this.feedLoading = true;
    this.renderer.hideNativeActivities();
    if (!this.customActivitiesContainer) this.createCustomActivitiesContainer();
    const container = this.customActivitiesContainer;
    if (!container) return;
    container.style.display = 'block';
    this.renderer.showLoader(container);
    const filter = this.currentFeedFilter();
    const cursor =
      source.kind === 'users' && source.userIds.length === 0
        ? null
        : new FilteredFeedCursor(this.api, source, filter);
    this.feedCursor = cursor;
    setLoadMoreOverride(() => void this.loadMoreFeed());
    setLoadMoreState({ busy: true, exhausted: false });
    const owns = (): boolean =>
      isCurrent() && container === this.customActivitiesContainer && this.feedCursor === cursor;
    try {
      // Rows are cloned from AniList's own rows: after a reload the feed may not be drawn yet.
      const [batch] = await Promise.all([
        withTimeout(this.firstBatch(cursor, isCurrent), CUSTOM_FEED_TIMEOUT_MS),
        this.waitForElement(NATIVE_TEMPLATE_ROW_SELECTOR, NATIVE_ROW_WAIT_MS),
      ]);
      if (!owns()) return;
      this.feedLoading = false;
      this.placeCustomActivitiesContainer(true);
      this.renderer.renderCustomActivities(
        batch.activities,
        container,
        emptyFeedMessage(source, filter, batch.hasMore)
      );
      setLoadMoreState({ busy: false, exhausted: !batch.hasMore });
    } catch (error) {
      if (!owns()) return;
      this.feedLoading = false;
      this.placeCustomActivitiesContainer(true);
      this.logger.error('[ActivityEnhancer] Failed to load the activity feed', error);
      setLoadMoreState({ busy: false, exhausted: true });
      this.renderer.showErrorMessage(container, () => {
        if (owns() && container.isConnected) void this.reloadFeed();
      });
    }
  }

  private async firstBatch(
    cursor: FilteredFeedCursor | null,
    isCurrent: () => boolean
  ): Promise<FeedBatch> {
    if (!cursor) return { activities: [], hasMore: false };
    const context = await captureApiContext(this.api);
    if (!isCurrent()) throw new Error('Activity request is no longer active');
    assertApiContext(this.api, context);
    const batch = await cursor.next();
    assertApiContext(this.api, context);
    return batch;
  }

  /** Load More while the extension feed is shown: continues the same cursor and appends. */
  private async loadMoreFeed(): Promise<void> {
    const cursor = this.feedCursor;
    const container = this.customActivitiesContainer;
    if (!cursor || !container || this.loadingMore) return;
    this.loadingMore = true;
    setLoadMoreState({ busy: true, exhausted: false });
    try {
      const batch = await withTimeout(cursor.next(), CUSTOM_FEED_TIMEOUT_MS);
      if (cursor !== this.feedCursor) return;
      this.renderer.appendCustomActivities(batch.activities, container);
      setLoadMoreState({ busy: false, exhausted: !batch.hasMore });
    } catch (error) {
      if (cursor !== this.feedCursor) return;
      this.logger.error('[ActivityEnhancer] Failed to load more activities', error);
      setLoadMoreState({ busy: false, exhausted: false });
    } finally {
      this.loadingMore = false;
    }
  }

  /**
   * Invariant while the extension feed is on: AniList's rows are hidden, so our container must be
   * in the current feed, visible and holding rows or a status. Navigation and AniList redraws can
   * break that in orders no single handler sees; any break with no load in flight reloads the feed.
   */
  private ensureQueryFeedShown(): void {
    if (this.feedMode !== 'query' || this.feedLoading || this.destroyed) return;
    const container = this.customActivitiesContainer;
    if (container) this.placeCustomActivitiesContainer();
    if (container?.isConnected && container.style.display !== 'none' && container.childElementCount > 0)
      return;
    const now = Date.now();
    this.healReloads = this.healReloads.filter((time) => now - time < HEAL_WINDOW_MS);
    if (this.healReloads.length >= MAX_HEAL_RELOADS) return;
    this.healReloads.push(now);
    this.logger.warn('[ActivityEnhancer] Custom feed was lost; reloading it', {
      hasContainer: Boolean(container),
      connected: Boolean(container?.isConnected),
      rows: container?.childElementCount ?? 0,
    });
    void this.reloadFeed();
  }

  /**
   * AniList redraws its feed element after SPA navigation and Load More, dropping our container
   * with it. While the extension feed is shown, keep the container (and its rows) at the top of the
   * current feed. Already in place → no DOM write, so observer callbacks cannot loop.
   */
  private placeCustomActivitiesContainer(whileLoading = false): void {
    const container = this.customActivitiesContainer;
    if (!container || (!whileLoading && this.feedMode !== 'query')) return;
    const feed = document.querySelector('.activity-feed, .activities');
    if (feed) {
      if (container.parentElement !== feed || feed.firstElementChild !== container) {
        feed.prepend(container);
      }
      return;
    }
    if (!container.isConnected) {
      (document.querySelector('.activity-feed-wrap, .feed-container') ?? document.body).appendChild(
        container
      );
    }
  }

  /**
   * Create container for custom activities
   */
  private createCustomActivitiesContainer(): void {
    const feed = document.querySelector('.activity-feed, .activities');
    const feedWrap = document.querySelector('.activity-feed-wrap, .feed-container');

    const container = document.createElement('div');
    container.className = 'au-custom-activities-container';
    container.style.display = 'none'; // Hidden by default

    if (feed) {
      // Inject inside the actual feed for best CSS inheritance
      feed.prepend(container);
    } else if (feedWrap) {
      feedWrap.appendChild(container);
    } else {
      // Last resort
      document.body.appendChild(container);
    }

    this.customActivitiesContainer = container;
  }

  /**
   * Clear custom activities
   */
  private clearCustomActivities(): void {
    if (this.customActivitiesContainer) {
      this.renderer.clear(this.customActivitiesContainer);
      this.customActivitiesContainer.style.display = 'none';
    }
  }

  /**
   * Destroy module
   */
  public override async destroy(): Promise<void> {
    this.destroyed = true;
    this.fullCleanup();
    await super.destroy();
  }
}
