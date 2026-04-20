/**
 * Activity Enhancer Module
 * Minimalist version: FULL Filters and Search
 * Positioned below the ".activity-edit" box
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import '../../styles/activity-enhancer.css';

type ActivityType = 'watched' | 'read' | 'completed' | 'plans' | 'dropped' | 'paused' | 'text' | 'all';

export class ActivityEnhancerModule extends BaseModule {
  private activeFilters: Set<ActivityType> = new Set(['all']);
  private searchQuery: string = '';
  private controlsContainer: HTMLElement | null = null;
  private readonly OBSERVER_NAME = 'activity-continuous';

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
    const activities = Array.from(document.querySelectorAll('.activity-entry, .activity-anime, .activity-manga, .activity-text')) as HTMLElement[];
    
    activities.forEach(el => {
      const text = el.textContent?.toLowerCase() || '';
      const type = this.getActivityType(el);
      const typeMatch = this.activeFilters.has('all') || this.activeFilters.has(type);
      const searchMatch = !this.searchQuery || text.includes(this.searchQuery);

      if (typeMatch && searchMatch) {
        el.style.display = '';
        el.classList.remove('au-activity-hidden');
      } else {
        el.style.display = 'none';
        el.classList.add('au-activity-hidden');
      }
    });
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

  public destroy(): void {
    this.fullCleanup();
  }
}
