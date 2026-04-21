/**
 * Media Social Enhancer Module
 * Mirror version of ActivityEnhancer: Tabs, Filters, and Scores
 * Targeted at media social pages (/anime/.../social, /manga/.../social)
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { CustomListService } from './CustomListService';
import { anilistClient } from '../../api/AnilistClient';
import { ActivityType, AniListActivity, getTimeAgo, getActivityType } from '../activity/ActivityUtils';
import '../../styles/activity-enhancer.css';

export class MediaSocialEnhancer extends BaseModule {
  private activeFilters: Set<ActivityType> = new Set(['all']);
  private controlsContainer: HTMLElement | null = null;
  private readonly OBSERVER_NAME = 'media-social-continuous';
  private customListService = CustomListService.getInstance();
  private currentCustomList: string | null = null;
  private customListMenu: HTMLElement | null = null;
  private customListBtn: HTMLElement | null = null;
  private customActivitiesContainer: HTMLElement | null = null;
  private tabExclusivityObserver: MutationObserver | null = null;
  private mediaId: number | null = null;

  public async init(): Promise<void> {
    log.info('MediaSocialEnhancer: Initializing (Mirror Logic)');

    this.watchPageNavigation(() => {
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

  private isOnMediaSocialPage(): boolean {
    return /^\/(anime|manga)\/\d+\/social/.test(window.location.pathname);
  }

  private extractMediaId(): void {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)\//);
    this.mediaId = match ? parseInt(match[2], 10) : null;
    log.info('MediaSocialEnhancer: Media ID extracted:', this.mediaId);
  }

  private fullCleanup(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    
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
    // 1. Inject Filter Bar
    if (!document.querySelector('.au-activity-bar')) {
      this.injectControls();
    }

    // 2. Inject Custom Lists Tab
    if (!this.customListBtn) {
      this.injectCustomListsDropdown();
    }

    // 3. Apply Filters to native activities if they appear
    const feed = document.querySelector('.activity-feed');
    if (feed) {
      this.suspendObserver(this.OBSERVER_NAME);
      this.applyFilters();
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  /**
   * Inject filter bar above Recent Activity
   */
  private injectControls(): void {
    const header = document.querySelector('.section-header');
    if (!header) return;

    const bar = document.createElement('div');
    bar.className = 'au-activity-bar';
    bar.style.marginTop = '15px';
    bar.style.marginBottom = '15px';
    bar.innerHTML = `
      <div class="au-activity-bar__left">
        <button class="au-filter-btn" data-filter="all">All</button>
        <button class="au-filter-btn" data-filter="watched">Watched</button>
        <button class="au-filter-btn" data-filter="completed">Completed</button>
        <button class="au-filter-btn" data-filter="plans">Plans</button>
        <button class="au-filter-btn" data-filter="text">Text posts</button>
      </div>
    `;

    header.insertAdjacentElement('afterend', bar);
    this.controlsContainer = bar;
    
    // Attach events
    bar.querySelectorAll('.au-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as ActivityType;
        this.activeFilters.clear();
        this.activeFilters.add(filter);
        this.updateControlsUI();
        this.checkAndProcess();
      });
    });

    this.updateControlsUI();
  }

  private updateControlsUI(): void {
    if (!this.controlsContainer) return;
    this.controlsContainer.querySelectorAll('.au-filter-btn').forEach(btn => {
      const f = btn.getAttribute('data-filter') as ActivityType;
      btn.classList.toggle('active', this.activeFilters.has(f));
    });
  }

  private applyFilters(): void {
    if (this.currentCustomList) {
      this.hideNativeActivities();
      return;
    }

    const activities = Array.from(document.querySelectorAll('.activity-entry')) as HTMLElement[];
    activities.forEach(el => {
      const text = el.textContent?.toLowerCase() || '';
      const type = getActivityType(text);
      const typeMatch = this.activeFilters.has('all') || this.activeFilters.has(type);
      el.style.display = typeMatch ? '' : 'none';
    });
  }

  private showEmptyMessage(): void {
    if (this.customActivitiesContainer) {
      this.customActivitiesContainer.innerHTML = '<div style="text-align:center; padding: 40px; font-size: 1.4rem; color: var(--color-text-lighter);">No activities found for the users in this list.</div>';
    }
  }

  private async injectCustomListsDropdown(): Promise<void> {
    const feedTypeToggle = document.querySelector('.feed-type-toggle');
    if (!feedTypeToggle || document.querySelector('.au-custom-list-btn')) return;

    await this.customListService.init();
    const lists = this.customListService.getLists();
    const listNames = Object.keys(lists);

    const btn = document.createElement('div');
    btn.className = 'link au-custom-list-btn';
    btn.setAttribute('data-v-4f9e87dc', ''); // Match media social scope
    btn.innerHTML = `
      <span class="au-custom-list-label" data-v-4f9e87dc>Custom</span>
      <i class="fa fa-caret-down" data-v-4f9e87dc style="margin-left: 5px; font-size: 0.9em;"></i>
    `;
    
    // Menu logic
    let menuItems = '<div class="au-custom-list-item" data-list=""><i class="fa fa-times-circle"></i> Clear</div>';
    menuItems += listNames.map(name => `<div class="au-custom-list-item" data-list="${name}">${name}</div>`).join('');

    const menu = document.createElement('div');
    menu.className = 'au-custom-list-menu';
    menu.style.display = 'none';
    menu.innerHTML = menuItems;

    feedTypeToggle.appendChild(btn);
    document.body.appendChild(menu);
    this.customListBtn = btn;
    this.customListMenu = menu;

    // Capture Phase Universal Listener
    feedTypeToggle.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.au-custom-list-btn') && this.currentCustomList) {
        this.setCustomListFilter(null);
      }
    }, true);

    if (this.customListMenu) {
      const menu = this.customListMenu;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      });
    }

    menu.querySelectorAll('.au-custom-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const list = item.getAttribute('data-list');
        this.setCustomListFilter(list || null);
        menu.style.display = 'none';
      });
    });

    // Nuclear Sync
    if (!this.tabExclusivityObserver) {
      this.tabExclusivityObserver = new MutationObserver(() => this.updateCustomListUI(this.currentCustomList));
      this.tabExclusivityObserver.observe(feedTypeToggle, { attributes: true, childList: true, subtree: true });
    }

    if (this.currentCustomList) this.updateCustomListUI(this.currentCustomList);
  }

  private async setCustomListFilter(listName: string | null): Promise<void> {
    this.currentCustomList = listName;
    this.updateCustomListUI(listName);

    if (listName) {
      this.hideNativeActivities();
      this.showCustomLoader();
      const users = this.customListService.getList(listName);
      const userIds = users.map(u => u.id);
      
      if (userIds.length > 0 && this.mediaId) {
        const activities = await this.fetchMediaActivities(userIds, this.mediaId);
        this.renderCustomActivities(activities);
      } else {
        this.showEmptyMessage();
      }
    } else {
      this.showNativeActivities();
    }
  }

  private async fetchMediaActivities(userIds: number[], mediaId: number): Promise<AniListActivity[]> {
    const query = `
      query($userIds: [Int], $mediaId: Int) {
        Page(perPage: 50) {
          activities(userId_in: $userIds, mediaId: $mediaId, sort: ID_DESC) {
            ... on ListActivity {
              id type status progress createdAt replyCount likeCount
              user { id name avatar { medium } }
              mediaList { score(format: POINT_10) }
            }
          }
        }
      }
    `;
    try {
      const data = await anilistClient.query<{ Page: { activities: AniListActivity[] } }>(query, { userIds, mediaId });
      return data.Page?.activities || [];
    } catch (e) { return []; }
  }

  private showCustomLoader(): void {
    if (!this.customActivitiesContainer) {
      this.customActivitiesContainer = document.createElement('div');
      this.customActivitiesContainer.className = 'au-custom-activities-feed';
      document.querySelector('.activity-feed')?.prepend(this.customActivitiesContainer);
    }
    this.customActivitiesContainer.innerHTML = '<div style="text-align:center; padding: 20px; opacity:0.6;">Loading...</div>';
  }

  private renderCustomActivities(activities: AniListActivity[]): void {
    if (!this.customActivitiesContainer) return;
    this.customActivitiesContainer.innerHTML = activities.map(act => {
      const score = act.mediaList?.score ? `<div class="au-score-badge ${act.mediaList.score > 7 ? 'high' : act.mediaList.score > 4 ? 'medium' : 'low'}">${act.mediaList.score}</div>` : '';
      return `
        <div class="activity-entry activity-anime">
          <div class="wrap">
            <div class="list">
              <a href="/user/${act.user.name}/" class="avatar" style="background-image: url(${act.user.avatar.medium});"></a>
              <div class="details">
                <a href="/user/${act.user.name}/" class="name">${act.user.name} ${score}</a>
                <div class="status">${act.status} ${act.progress ? 'episode ' + act.progress : ''}</div>
              </div>
            </div>
            <div class="time"><time>${getTimeAgo(act.createdAt)}</time></div>
          </div>
        </div>
      `;
    }).join('') || '<div style="text-align:center; padding: 20px; opacity:0.6;">No activities found</div>';
  }

  private hideNativeActivities(): void {
    document.querySelectorAll('.activity-entry:not(.au-custom-activities-feed *)').forEach(el => (el as HTMLElement).style.display = 'none');
    const loadMore = document.querySelector('.load-more') as HTMLElement;
    if (loadMore) {
      loadMore.style.setProperty('display', 'none', 'important');
    }
  }

  private showNativeActivities(): void {
    document.querySelectorAll('.activity-entry').forEach(el => (el as HTMLElement).style.display = '');
    const loadMore = document.querySelector('.load-more') as HTMLElement;
    if (loadMore) {
      loadMore.style.display = '';
    }
    this.customActivitiesContainer?.remove();
    this.customActivitiesContainer = null;
  }

  private updateCustomListUI(listName: string | null): void {
    const btn = this.customListBtn;
    const parent = document.querySelector('.feed-type-toggle') as HTMLElement;
    if (!btn || !parent) return;

    this.tabExclusivityObserver?.disconnect();
    if (listName) {
      btn.classList.add('active');
      parent.classList.add('au-custom-active');
      parent.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    } else {
      btn.classList.remove('active');
      parent.classList.remove('au-custom-active');
    }
    
    this.tabExclusivityObserver?.observe(parent, { attributes: true, childList: true, subtree: true });
  }

  public override destroy(): void {
    this.fullCleanup();
    super.destroy();
  }
}
