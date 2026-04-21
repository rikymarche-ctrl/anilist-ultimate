/**
 * Activity Enhancer Module
 * Minimalist version: FULL Filters and Search
 * Positioned below the ".activity-edit" box
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { CustomListService } from '../social/CustomListService';
import { anilistClient } from '../../api/AnilistClient';
import '../../styles/activity-enhancer.css';

type ActivityType = 'watched' | 'read' | 'completed' | 'plans' | 'dropped' | 'paused' | 'text' | 'all';

interface AniListActivity {
  id: number;
  type: string;
  text?: string;
  status?: string;
  progress?: string;
  createdAt: number;
  user: {
    id: number;
    name: string;
    avatar: { medium: string };
  };
  media?: {
    id: number;
    title: { romaji: string };
    coverImage: { medium: string };
    type: string;
  };
  replyCount: number;
  likeCount: number;
}

export class ActivityEnhancerModule extends BaseModule {
  private activeFilters: Set<ActivityType> = new Set(['all']);
  private searchQuery: string = '';
  private controlsContainer: HTMLElement | null = null;
  private readonly OBSERVER_NAME = 'activity-continuous';
  private customListService = CustomListService.getInstance();
  private currentCustomList: string | null = null;
  private customListMenu: HTMLElement | null = null;
  private customListBtn: HTMLElement | null = null;
  private customActivitiesContainer: HTMLElement | null = null;
  private tabExclusivityObserver: MutationObserver | null = null;

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ActivityEnhancer: Initializing (Full Filters)');

    this.watchPageNavigation(() => {
      this.fullCleanup();
      if (this.isOnActivityPage()) {
        this.startObservation();
      }
    });

    if (this.isOnActivityPage()) {
      this.startObservation();
    }
  }

  private isOnActivityPage(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path.includes('/user/');
  }

  private fullCleanup(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    this.cleanup();
    
    this.controlsContainer?.remove();
    this.controlsContainer = null;
    
    this.customListMenu?.remove();
    this.customListMenu = null;
    
    this.customListBtn?.remove();
    this.customListBtn = null;
    
    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;
    
    this.tabExclusivityObserver?.disconnect();
    this.tabExclusivityObserver = null;
    
    this.currentCustomList = null;

    this.resumeObserver(this.OBSERVER_NAME);
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });
  }

  private checkAndProcess(): void {
    if (!document.querySelector('.au-activity-bar')) {
      this.injectControls();
    }

    // Inject Custom Lists dropdown next to native Following/Global tabs
    if (!this.customListBtn) {
      this.injectCustomListsDropdown();
    }

    const feed = document.querySelector('.activity-feed-wrap, .activity-feed');
    if (feed) {
      this.suspendObserver(this.OBSERVER_NAME);
      this.applyFilters();
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Inject the minimalist toolbar below the .activity-edit box
   */
  private injectControls(): void {
    if (document.querySelector('.au-activity-bar')) return;

    // Target the .activity-edit container as requested
    const editContainer = document.querySelector('.activity-edit');
    const feedWrap = document.querySelector('.activity-feed-wrap');
    
    if (!feedWrap) return;

    const bar = document.createElement('div');
    bar.className = 'au-activity-bar';
    bar.innerHTML = `
      <div class="au-activity-bar__left">
        <button class="au-filter-btn" data-filter="all">All</button>
        <button class="au-filter-btn" data-filter="watched">Watched</button>
        <button class="au-filter-btn" data-filter="read">Read</button>
        <button class="au-filter-btn" data-filter="completed">Completed</button>
        <button class="au-filter-btn" data-filter="plans">Plans</button>
        <button class="au-filter-btn" data-filter="dropped">Dropped</button>
        <button class="au-filter-btn" data-filter="paused">Paused</button>
        <button class="au-filter-btn" data-filter="text">Text posts</button>
      </div>
      <div class="au-search-container">
        <i class="fas fa-search au-search-icon"></i>
        <input type="text" class="au-search-input" id="au-activity-search" placeholder="Search..." />
      </div>
    `;

    if (editContainer) {
      editContainer.insertAdjacentElement('afterend', bar);
    } else if (document.querySelector('.status-post-wrap')) {
        document.querySelector('.status-post-wrap')?.insertAdjacentElement('afterend', bar);
    } else {
      feedWrap.prepend(bar);
    }

    this.controlsContainer = bar;
    this.updateControlsUI();
    this.attachEvents();
  }

  private attachEvents(): void {
    if (!this.controlsContainer) return;

    const filterBtns = this.controlsContainer.querySelectorAll('.au-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as ActivityType;
        this.toggleFilter(filter);
      });
    });

    const searchInput = this.controlsContainer.querySelector('#au-activity-search') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.checkAndProcess();
    });
  }

  /**
   * Single-select filter logic
   */
  private toggleFilter(filter: ActivityType): void {
    this.activeFilters.clear();
    this.activeFilters.add(filter);
    
    this.updateControlsUI();
    this.checkAndProcess();
  }

  private updateControlsUI(): void {
    if (!this.controlsContainer) return;
    this.controlsContainer.querySelectorAll('.au-filter-btn').forEach(btn => {
      const f = btn.getAttribute('data-filter') as ActivityType;
      btn.classList.toggle('active', this.activeFilters.has(f));
    });
  }

  private applyFilters(): void {
    // If using custom list with GraphQL, ensure native activities stay hidden even when AL auto-loads more
    if (this.currentCustomList) {
      this.hideNativeActivities();
      return;
    }

    const activities = Array.from(document.querySelectorAll('.activity-entry, .activity-anime, .activity-manga, .activity-text')) as HTMLElement[];

    log.info('[ActivityEnhancer] Applying filters to', activities.length, 'activities');

    let hiddenCount = 0;
    let shownCount = 0;

    activities.forEach(el => {
      const text = el.textContent?.toLowerCase() || '';
      const type = this.getActivityType(el);
      const typeMatch = this.activeFilters.has('all') || this.activeFilters.has(type);
      const searchMatch = !this.searchQuery || text.includes(this.searchQuery);

      if (typeMatch && searchMatch) {
        el.style.display = '';
        el.classList.remove('au-activity-hidden');
        shownCount++;
      } else {
        el.style.display = 'none';
        el.classList.add('au-activity-hidden');
        hiddenCount++;
      }
    });

    log.info('[ActivityEnhancer] Filtered:', shownCount, 'shown,', hiddenCount, 'hidden');
  }

  private getActivityType(activity: HTMLElement): ActivityType {
    const text = activity.textContent?.toLowerCase() || '';
    if (text.includes('watched episode') || text.includes('watched ep')) return 'watched';
    if (text.includes('read chapter') || text.includes('read ch')) return 'read';
    if (text.includes('completed')) return 'completed';
    if (text.includes('plans to')) return 'plans';
    if (text.includes('dropped')) return 'dropped';
    if (text.includes('paused')) return 'paused';
    return 'text';
  }

  /**
   * Inject Custom Lists dropdown next to native Following/Global tabs
   */
  private async injectCustomListsDropdown(): Promise<void> {
    // Find the native feed type toggle (Following/Global)
    const feedTypeToggle = document.querySelector('.feed-type-toggle');
    if (!feedTypeToggle) {
      log.debug('[ActivityEnhancer] .feed-type-toggle not found');
      return;
    }

    // Check if already injected
    if (document.querySelector('.au-custom-list-btn')) return;

    log.info('[ActivityEnhancer] Injecting Custom Lists dropdown');

    // Initialize service
    log.info('[ActivityEnhancer] Calling customListService.init()...');
    await this.customListService.init();
    log.info('[ActivityEnhancer] init() completed');

    const lists = this.customListService.getLists();
    log.info('[ActivityEnhancer] getLists() returned:', lists);

    const listNames = Object.keys(lists);
    log.info('[ActivityEnhancer] List names:', listNames);
    log.info('[ActivityEnhancer] Number of lists:', listNames.length);

    // Create literal native button
    const btn = document.createElement('a');
    btn.className = 'link au-custom-list-btn';
    btn.setAttribute('data-v-8209bd04', ''); // Force inject attribute on button
    
    // Build menu items
    let menuItems = '<div class="au-custom-list-item" data-list=""><i class="fa fa-times-circle"></i> Clear Filter</div>';
    if (listNames.length > 0) {
      menuItems += listNames.map(name => `
        <div class="au-custom-list-item" data-list="${name}">
          <i class="fa fa-list-ul"></i> ${name}
        </div>
      `).join('');
    } else {
      menuItems += '<div class="au-custom-list-item au-custom-list-empty">No custom lists</div>';
    }

    btn.innerHTML = `
      <span class="au-custom-list-label" data-v-8209bd04>Custom</span>
      <i class="fa fa-caret-down" data-v-8209bd04 style="margin-left: 5px; font-size: 0.9em;"></i>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'au-custom-list-menu';
    menu.style.display = 'none';
    menu.innerHTML = menuItems;

    log.info('[ActivityEnhancer] Created dropdown with', listNames.length, 'lists');

    // Insert directly as sibling to get perfect native CSS
    feedTypeToggle.appendChild(btn);
    // Menu goes to body to prevent stretching feedTypeToggle
    document.body.appendChild(menu);
    
    this.customListMenu = menu;
    this.customListBtn = btn;

    // UNIVERSAL LISTENER: Knowledge of all 3 buttons
    feedTypeToggle.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // Is the click inside our custom button?
      const isCustomClick = target.closest('.au-custom-list-btn');
      
      if (!isCustomClick) {
        // Any click on the container that's NOT our button must trigger clear filters
        log.info('[ActivityEnhancer] Native tab or container clicked. Switching from Custom Context to Native.');
        if (this.currentCustomList) {
          this.setCustomListFilter(null);
        }
      }
      
      // If it IS a custom click, the individual btn listener handles the rest
    }, true); // Use CAPTURE phase to ensure we see it before Vue hijacks it

    log.info('[ActivityEnhancer] Attaching events. Btn:', btn, 'Menu:', menu);

    if (btn && menu) {
      btn.addEventListener('click', (e) => {
        log.info('[ActivityEnhancer] Button clicked!');
        e.stopPropagation();
        e.preventDefault();

        const isHidden = menu.style.display === 'none' || !menu.style.display;

        if (isHidden) {
          // Position menu below button relative to viewport
          const rect = btn.getBoundingClientRect();
          menu.style.top = `${rect.bottom + 8}px`;
          menu.style.left = `${rect.left}px`;
          menu.style.display = 'block';
        } else {
          menu.style.display = 'none';
        }
      });
      log.info('[ActivityEnhancer] Event listener attached successfully');
    } else {
      log.error('[ActivityEnhancer] Failed to attach events! btn:', btn, 'menu:', menu);
    }

    // Close on outside click
    document.addEventListener('click', () => {
      if (menu) menu.style.display = 'none';
    });

    // Handle list selection
    menu.querySelectorAll('.au-custom-list-item:not(.au-custom-list-empty)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const listName = item.getAttribute('data-list');
        this.setCustomListFilter(listName || null);
        menu.style.display = 'none';
      });
    });

    // NUCLEAR OPTION: Constant Force-Sync Observer
    if (!this.tabExclusivityObserver) {
      this.tabExclusivityObserver = new MutationObserver(() => {
        this.updateCustomListUI(this.currentCustomList);
      });
      this.tabExclusivityObserver.observe(feedTypeToggle, { 
        attributes: true, 
        childList: true, 
        subtree: true, 
        attributeFilter: ['class', 'active'] 
      });
    }

    // If we were already filtering, restore the UI state now that we've re-injected
    if (this.currentCustomList) {
      log.info('[ActivityEnhancer] Restoring Custom List UI state after re-injection');
      this.updateCustomListUI(this.currentCustomList);
    }
  }

  /**
   * Set custom list filter and fetch data
   */
  private async setCustomListFilter(listName: string | null): Promise<void> {
    log.info('[ActivityEnhancer] Setting custom list filter to:', listName);
    this.currentCustomList = listName;
    this.updateCustomListUI(listName);

    // If a list is selected, fetch and show custom activities
    if (listName) {
      log.info('[ActivityEnhancer] List selected, clearing feed first...');

      // IMMEDIATELY hide all native activities and show loader
      this.hideNativeActivities();
      this.showCustomLoader();

      const listUsers = this.customListService.getList(listName);
      log.info('[ActivityEnhancer] Users in list:', listUsers);

      const userIds = listUsers.map(u => u.id);
      log.info('[ActivityEnhancer] User IDs:', userIds);

      if (userIds.length > 0) {
        log.info('[ActivityEnhancer] Fetching activities for', userIds.length, 'users...');
        const activities = await this.fetchCustomListActivities(userIds);
        log.info('[ActivityEnhancer] Fetched', activities.length, 'activities:', activities);

        if (activities.length > 0) {
          this.renderCustomActivities(activities);
        } else {
          log.warn('[ActivityEnhancer] No activities found for these users');
          // Show a message to the user
          this.showEmptyMessage();
        }
      } else {
        log.warn('[ActivityEnhancer] No users in list:', listName);
        this.showEmptyMessage();
      }
    } else {
      // Clear filter - show native activities
      log.info('[ActivityEnhancer] Clearing custom list filter');
      this.showNativeActivities();
    }
  }

  // Note: matchesCustomListFilter removed - now using GraphQL query instead

  /**
   * Fetch activities for users in a custom list via GraphQL
   */
  private async fetchCustomListActivities(userIds: number[]): Promise<AniListActivity[]> {
    const query = `
      query($userIds: [Int], $page: Int) {
        Page(page: $page, perPage: 40) {
          activities(userId_in: $userIds, sort: ID_DESC) {
            ... on TextActivity {
              id
              type
              text
              createdAt
              user {
                id
                name
                avatar { medium }
              }
              replyCount
              likeCount
            }
            ... on ListActivity {
              id
              type
              status
              progress
              createdAt
              user {
                id
                name
                avatar { medium }
              }
              media {
                id
                title { romaji }
                coverImage { medium }
                type
              }
              replyCount
              likeCount
            }
          }
        }
      }
    `;

    try {
      log.info('[ActivityEnhancer] Sending authenticated GraphQL query via AnilistClient...');
      const data = await anilistClient.query<{ Page: { activities: AniListActivity[] } }>(query, { userIds, page: 1 });
      const activities = data.Page?.activities || [];
      log.info('[ActivityEnhancer] Fetched', activities.length, 'activities successfully.');
      return activities;
    } catch (error) {
      log.error('[ActivityEnhancer] Failed to fetch custom list activities:', error);
      return [];
    }
  }

  private showCustomLoader(): void {
    const feedWrap = document.querySelector('.activity-feed-wrap, .activity-feed');
    if (!feedWrap) return;
    
    const feed = feedWrap.querySelector('.activity-feed') || feedWrap;
    
    if (!this.customActivitiesContainer) {
      this.customActivitiesContainer = document.createElement('div');
      this.customActivitiesContainer.className = 'au-custom-activities-feed';
      
      const firstActivity = Array.from(feed.children).find(child => child.classList.contains('activity-entry'));
      if (firstActivity) {
        feed.insertBefore(this.customActivitiesContainer, firstActivity);
      } else {
        feed.appendChild(this.customActivitiesContainer);
      }
    }
    this.customActivitiesContainer.innerHTML = '<div style="text-align:center; padding: 40px; font-size: 1.4rem; color: var(--color-text-lighter);"><i class="fa fa-spinner fa-spin"></i> Loading Custom List...</div>';
  }

  private showEmptyMessage(): void {
    if (this.customActivitiesContainer) {
      this.customActivitiesContainer.innerHTML = '<div style="text-align:center; padding: 40px; font-size: 1.4rem; color: var(--color-text-lighter);">No activities found for the users in this list.</div>';
    }
  }

  /**
   * Render custom activities in a container
   */
  private renderCustomActivities(activities: AniListActivity[]): void {
    const feedWrap = document.querySelector('.activity-feed-wrap, .activity-feed');
    if (!feedWrap) return;
    
    const feed = feedWrap.querySelector('.activity-feed') || feedWrap;

    // Create or get custom container
    if (!this.customActivitiesContainer) {
      this.customActivitiesContainer = document.createElement('div');
      this.customActivitiesContainer.className = 'au-custom-activities-feed';

      // Ensure firstActivity is explicitly a direct child of 'feed'
      const firstActivity = Array.from(feed.children).find(child => child.classList.contains('activity-entry'));
      if (firstActivity) {
        feed.insertBefore(this.customActivitiesContainer, firstActivity);
      } else {
        feed.appendChild(this.customActivitiesContainer);
      }
    }

    // Render activities with exact AniList structure
    this.customActivitiesContainer.innerHTML = activities.map(activity => {
      const timeAgo = this.getTimeAgo(activity.createdAt);

      if (activity.type === 'TEXT') {
        // Text activity
        return `
          <div data-v-2bf33918="" class="activity-entry activity-text">
            <div data-v-2bf33918="" class="wrap">
              <a data-v-2bf33918="" href="/user/${activity.user.name}/" class="avatar" style="background-image: url(&quot;${activity.user.avatar.medium}&quot;);"></a>
              <div data-v-2bf33918="" class="details">
                <a data-v-2bf33918="" href="/user/${activity.user.name}/" class="name">${activity.user.name}</a>
                <div data-v-2bf33918="" class="markdown">${activity.text || ''}</div>
              </div>
              <div data-v-2bf33918="" class="time">
                <time data-v-2bf33918="">${timeAgo}</time>
              </div>
              <div data-v-2bf33918="" class="actions">
                <div data-v-2bf33918="" class="action replies">
                  <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="comments" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-comments fa-w-18 fa-sm"><path fill="currentColor" d="M416 192c0-88.4-93.1-160-208-160S0 103.6 0 192c0 34.3 14.1 65.9 38 92-13.4 30.2-35.5 54.2-35.8 54.5-2.2 2.3-2.8 5.7-1.5 8.7S4.8 352 8 352c36.6 0 66.9-12.3 88.7-25 32.2 15.7 70.3 25 111.3 25 114.9 0 208-71.6 208-160zm122 220c23.9-26 38-57.7 38-92 0-66.9-53.5-124.2-129.3-148.1.9 6.6 1.3 13.3 1.3 20.1 0 105.9-107.7 192-240 192-10.8 0-21.3-.8-31.7-1.9C207.8 439.6 281.8 480 368 480c41 0 79.1-9.2 111.3-25 21.8 12.7 52.1 25 88.7 25 3.2 0 6.1-1.9 7.3-4.8 1.3-2.9.7-6.3-1.5-8.7-.3-.3-22.4-24.2-35.8-54.5z"></path></svg>
                  ${activity.replyCount}
                </div>
                <div data-v-2bf33918="" class="action likes">
                  <span class="count">${activity.likeCount}</span>
                  <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="heart" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-heart fa-w-16 fa-sm"><path fill="currentColor" d="M462.3 62.6C407.5 15.9 326 24.3 275.7 76.2L256 96.5l-19.7-20.3C186.1 24.3 104.5 15.9 49.7 62.6c-62.8 53.6-66.1 149.8-9.9 207.9l193.5 199.8c12.5 12.9 32.8 12.9 45.3 0l193.5-199.8c56.3-58.1 53-154.3-9.8-207.9z"></path></svg>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // List activity - exact copy of AniList structure
        const statusText = activity.status?.replace('_', ' ')?.toLowerCase() || 'watched';
        const progressText = activity.progress ? `episode ${activity.progress}` : '';

        return `
          <div data-v-2bf33918="" class="activity-entry activity-${activity.media?.type.toLowerCase() || 'anime'}">
            <div data-v-2bf33918="" class="wrap">
              <div data-v-2bf33918="" class="list">
                ${activity.media ? `<a data-v-2bf33918="" href="/${activity.media.type.toLowerCase()}/${activity.media.id}/" class="cover" style="background-image: url(&quot;${activity.media.coverImage.medium}&quot;);"></a>` : ''}
                <div data-v-2bf33918="" class="details">
                  <a data-v-2bf33918="" href="/user/${activity.user.name}/" class="name">${activity.user.name}</a>
                  <div data-v-2bf33918="" class="status">
                    ${statusText.charAt(0).toUpperCase() + statusText.slice(1)} ${progressText} ${progressText && activity.media ? 'of' : ''}
                    ${activity.media ? `<a data-v-2bf33918="" href="/${activity.media.type.toLowerCase()}/${activity.media.id}/" class="title">${activity.media.title.romaji}</a>` : ''}
                  </div>
                  <a data-v-2bf33918="" href="/user/${activity.user.name}/" class="avatar" style="background-image: url(&quot;${activity.user.avatar.medium}&quot;);"></a>
                </div>
              </div>
              <div data-v-2bf33918="" class="time">
                <time data-v-2bf33918="">${timeAgo}</time>
              </div>
              <div data-v-2bf33918="" class="actions">
                <div data-v-2bf33918="" class="action replies">
                  <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="comments" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-comments fa-w-18 fa-sm"><path fill="currentColor" d="M416 192c0-88.4-93.1-160-208-160S0 103.6 0 192c0 34.3 14.1 65.9 38 92-13.4 30.2-35.5 54.2-35.8 54.5-2.2 2.3-2.8 5.7-1.5 8.7S4.8 352 8 352c36.6 0 66.9-12.3 88.7-25 32.2 15.7 70.3 25 111.3 25 114.9 0 208-71.6 208-160zm122 220c23.9-26 38-57.7 38-92 0-66.9-53.5-124.2-129.3-148.1.9 6.6 1.3 13.3 1.3 20.1 0 105.9-107.7 192-240 192-10.8 0-21.3-.8-31.7-1.9C207.8 439.6 281.8 480 368 480c41 0 79.1-9.2 111.3-25 21.8 12.7 52.1 25 88.7 25 3.2 0 6.1-1.9 7.3-4.8 1.3-2.9.7-6.3-1.5-8.7-.3-.3-22.4-24.2-35.8-54.5z"></path></svg>
                </div>
                <div data-v-2bf33918="" class="action likes">
                  <span class="count">${activity.likeCount}</span>
                  <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="heart" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-heart fa-w-16 fa-sm"><path fill="currentColor" d="M462.3 62.6C407.5 15.9 326 24.3 275.7 76.2L256 96.5l-19.7-20.3C186.1 24.3 104.5 15.9 49.7 62.6c-62.8 53.6-66.1 149.8-9.9 207.9l193.5 199.8c12.5 12.9 32.8 12.9 45.3 0l193.5-199.8c56.3-58.1 53-154.3-9.8-207.9z"></path></svg>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    }).join('');

    // Hide native activities and load more button
    this.hideNativeActivities();
  }

  /**
   * Hide native activities when showing custom list
   */
  private hideNativeActivities(): void {
    const activities = document.querySelectorAll<HTMLElement>('.activity-entry:not(.au-custom-activities-feed .activity-entry)');
    activities.forEach(el => {
      el.style.display = 'none';
    });

    // Hide "Load More" button
    const loadMore = document.querySelector('.load-more') as HTMLElement;
    if (loadMore) {
      loadMore.style.display = 'none';
    }
  }

  /**
   * Show native activities when clearing filter
   */
  private showNativeActivities(): void {
    const activities = document.querySelectorAll<HTMLElement>('.activity-entry:not(.au-custom-activities-feed .activity-entry)');
    activities.forEach(el => {
      el.style.display = '';
    });

    // Show "Load More" button again
    const loadMore = document.querySelector('.load-more') as HTMLElement;
    if (loadMore) {
      loadMore.style.display = '';
    }

    // Remove custom container
    if (this.customActivitiesContainer) {
      this.customActivitiesContainer.remove();
      this.customActivitiesContainer = null;
    }
  }

  /**
   * Get time ago string
   */
  private getTimeAgo(timestamp: number): string {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return `${Math.floor(diff / 604800)} weeks ago`;
  }

  /**
   * Purely UI updates for the Custom List tabs
   */
  private updateCustomListUI(listName: string | null): void {
    const btn = this.customListBtn as HTMLElement;
    const parent = document.querySelector('.feed-type-toggle') as HTMLElement;
    if (!btn || !parent) return;

    // TEMPORARILY DISCONNECT to avoid infinite loop while we modify the DOM
    this.tabExclusivityObserver?.disconnect();

    try {
      if (listName) {
        btn?.classList.add('active', 'router-link-active', 'router-link-exact-active');
        btn?.setAttribute('active', 'active');
        parent?.classList.add('au-custom-active');
        
        // Force de-selection of native tabs
        parent.querySelectorAll('.link:not(.au-custom-list-btn)').forEach(tab => {
          tab.removeAttribute('active');
          tab.classList.remove('active', 'router-link-active', 'router-link-exact-active');
        });
      } else {
        btn?.classList.remove('active', 'router-link-active', 'router-link-exact-active');
        btn?.removeAttribute('active');
        parent?.classList.remove('au-custom-active');

        // Restore native tab states
        const path = window.location.pathname;
        parent.querySelectorAll<HTMLElement>('.link:not(.au-custom-list-btn)').forEach(tab => {
          const href = tab.getAttribute('href');
          if (href === path || (path === '/home' && href === '/')) {
             tab.classList.add('router-link-active', 'router-link-exact-active');
             tab.setAttribute('active', 'active');
          }
        });
      }

      // Update active state in menu
      this.customListMenu?.querySelectorAll('.au-custom-list-item').forEach(item => {
        const itemList = item.getAttribute('data-list');
        item.classList.toggle('active', itemList === (listName || ''));
      });
    } finally {
      // RECONNECT the observer after our changes are done
      if (this.tabExclusivityObserver && parent) {
        this.tabExclusivityObserver.observe(parent, { 
          attributes: true, 
          childList: true, 
          subtree: true, 
          attributeFilter: ['class', 'active'] 
        });
      }
    }
  }

  public destroy(): void {
    this.fullCleanup();
  }
}
