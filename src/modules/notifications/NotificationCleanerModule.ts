/**
 * @file NotificationCleanerModule.ts
 * @description Notification grouping and enhancement module with intelligent batching
 *
 * Orchestrates the notification cleaning pipeline:
 *   1. Observes the notification page DOM for new/changed notifications
 *   2. Groups consecutive notifications from the same user
 *   3. Creates virtual summary cards with expand/collapse dropdowns
 *   4. Enriches notifications with activity context (media titles, reply text)
 *   5. Provides search/filter via NotificationFilterService
 *   6. Allows toggle between merged and unmerged views
 *
 * Performance Optimizations:
 *   - Batches API calls for activity details (1 call instead of N per group)
 *   - NotificationFetchService caches activity details (TTL 2min)
 *   - Polling fallback (2s) for "Load More" button detection
 *   - Cache cleared on page navigation to prevent stale data
 *
 * Anti-Stuttering:
 *   Uses BaseModule's suspend/resume pattern to prevent MutationObserver
 *   loops when modifying the DOM (hiding/creating notifications).
 *
 * @see NotificationFetchService for API data fetching with caching
 * @see NotificationGroupService for grouping logic and text generation
 * @see NotificationFilterService for search/filter UI
 * @see docs/MODULES.md#2-notification-cleaner-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { storage } from '@core/storage/StorageManager';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { NotificationFetchService } from './services/NotificationFetchService';
import { NotificationGroupService, NotificationGroup } from './services/NotificationGroupService';
import { NotificationFilterService } from './services/NotificationFilterService';
import '../../styles/notification-cleaner.css';

@injectable()
export class NotificationCleanerModule extends BaseModule {
  private enabled: boolean = false;
  private isProcessing = false;
  private needsReprocess = false;
  private lastNotificationCount = 0;
  private readonly OBSERVER_NAME = 'notifications-continuous';
  private pollingInterval: number | null = null; // Fallback polling for Load More

  private currentPath = '';

  constructor(
    @inject(TOKENS.NotificationFetchService) private fetchService: NotificationFetchService,
    @inject(TOKENS.NotificationGroupService) private groupService: NotificationGroupService,
    @inject(TOKENS.NotificationFilterService) private filterService: NotificationFilterService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
    this.currentPath = window.location.pathname;
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    try {
      log.info('NotificationCleaner: Initializing...');

      this.enabled = (await storage.get<boolean>('clutterfree_group_likes')) ?? false;
      console.log('[NOTIF DEBUG] Init - enabled:', this.enabled);

      // Fix for dead toggle buttons: event delegation using CAPTURE phase
      // This bypasses any stopPropagation() called by Vue.js
      document.body.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.au-compress-button');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          console.log('[NOTIF DEBUG] Delegated toggle button clicked! (Capture Phase)');
          this.toggleGrouping();
        }
      }, true);

      this.onPageChange((event) => {
        const path = event?.path || window.location.pathname;
        // Ignore pushState events that do not actually change the page (e.g. infinite scroll)
        if (path === this.currentPath) return;
        this.currentPath = path;

        this.fullReset();
        this.clearVirtualNotifications();
        
        if (path.includes('/notifications')) {
          this.startObservation();
        }
      });

      if (window.location.pathname.includes('/notifications')) {
        this.startObservation();
      }
    } catch (error) {
      log.error('[NotificationCleaner] Initialization failed', error);
    }
  }

  public getName(): string {
    return 'notificationCleaner';
  }

  private fullReset(): void {
    this.cleanup();
    this.filterService.cleanup();
    this.lastNotificationCount = 0;
    this.isProcessing = false;

    // Clear polling interval
    if (this.pollingInterval) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Clear all processed markers
    document.querySelectorAll<HTMLElement>('.notification[data-au-processed]').forEach(n => {
      n.removeAttribute('data-au-processed');
    });

    // Clear notification activity cache on page change
    this.fetchService.clearCache();
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });

    // PERF: Polling fallback to catch notifications loaded via "Load More"
    // MutationObserver may not always trigger when Anilist dynamically adds notifications
    if (!this.pollingInterval) {
      this.pollingInterval = window.setInterval(() => {
        console.log('[NOTIF DEBUG] Polling check for new notifications');
        this.checkAndProcess();
      }, 2000); // Check every 2 seconds
    }
  }

  private checkAndProcess(): void {
    console.log('[NOTIF DEBUG] checkAndProcess called, isProcessing:', this.isProcessing);

    if (this.isProcessing) {
      console.log('[NOTIF DEBUG] checkAndProcess BLOCKED by isProcessing guard');
      return;
    }

    // Inject settings UI if on notifications page
    const markAllButton = document.querySelector('.reset-btn, .reset-button, .mark-all, .mark-as-read');
    if (markAllButton && !document.querySelector('.au-compress-button')) {
      this.injectSettingsUI(markAllButton as HTMLElement);
    }

    // Inject search bar via filter service
    if (!document.querySelector('.au-notification-search-wrapper')) {
      this.filterService.injectSearchBar((query: string) => {
        this.filterService.applySearchFilter(query);
      });
    }

    const container = document.querySelector('.notifications');
    console.log('[NOTIF DEBUG] Container found:', !!container);

    if (container) {
      this.processNotifications();
    }

    // Apply search filter if query exists
    const currentQuery = this.filterService.getSearchQuery();
    if (currentQuery) {
      this.filterService.applySearchFilter(currentQuery);
    }
  }

  private injectSettingsUI(markAllButton: HTMLElement): void {
    if (document.querySelector('.au-compress-button')) {
      console.log('[NOTIF DEBUG] Button already exists, skipping injection');
      return;
    }

    console.log('[NOTIF DEBUG] Creating merge/unmerge button, enabled:', this.enabled);

    const compressButton = document.createElement('div');
    compressButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
    compressButton.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';

    // Fallback direct listener
    compressButton.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[NOTIF DEBUG] Direct button listener clicked!');
      this.toggleGrouping();
    });

    markAllButton.parentElement?.insertBefore(compressButton, markAllButton);
    console.log('[NOTIF DEBUG] Button injected into DOM');
  }

  private async toggleGrouping(): Promise<void> {
    console.log(`[NOTIF DEBUG] toggleGrouping triggered! isProcessing=${this.isProcessing}`);
    
    // Emergency unlock if stuck for some reason
    if (this.isProcessing) {
      console.warn('[NOTIF DEBUG] isProcessing was true, forcing unlock to process click.');
      this.isProcessing = false;
    }

    this.enabled = !this.enabled;
    await storage.set('clutterfree_group_likes', this.enabled);

    console.log(`[NOTIF DEBUG] Toggle clicked! New state: ${this.enabled ? 'ENABLED (will merge)' : 'DISABLED (will unmerge)'}`);
    log.info(`[NotificationCleaner] Toggle to ${this.enabled ? 'ENABLED (merge)' : 'DISABLED (unmerge)'}`);

    const toggleBtn = document.querySelector('.au-compress-button');
    if (toggleBtn) {
      toggleBtn.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
      toggleBtn.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';
    }

    this.suspendObserver(this.OBSERVER_NAME);

    // Always restore original DOM first
    this.clearVirtualNotifications();
    this.lastNotificationCount = 0;

    if (this.enabled) {
      // Re-merge: clear processed markers and re-process
      document.querySelectorAll<HTMLElement>('.notification[data-au-processed]').forEach(n => {
        n.removeAttribute('data-au-processed');
      });

      // Small delay to let DOM settle, then re-process
      setTimeout(() => {
        this.processNotifications();
        this.resumeObserver(this.OBSERVER_NAME);
      }, 50);
    } else {
      // Unmerge: just resume observer, no re-processing needed
      log.info('[NotificationCleaner] Unmerge complete, resuming observer');
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private async processNotifications(): Promise<void> {
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }

    // Skip grouping entirely when disabled
    if (!this.enabled) {
      console.log('[NOTIF DEBUG] processNotifications called but SKIPPED (enabled=false)');
      log.debug('[NotificationCleaner] Skipping processNotifications - disabled');
      return;
    }

    console.log('[NOTIF DEBUG] processNotifications RUNNING (enabled=true)');

    const currentNotifications = Array.from(document.querySelectorAll<HTMLElement>(
      '.notification:not(.au-virtual-notification):not(.au-sub-notification), ' +
      '.notification-item:not(.au-virtual-notification):not(.au-sub-notification)'
    ));

    console.log('[NOTIF DEBUG] Total notifications found:', currentNotifications.length);
    console.log('[NOTIF DEBUG] Last notification count:', this.lastNotificationCount);

    // Immediate tagging pass
    currentNotifications.forEach(n => this.extractUsernameFromNotif(n));

    const newNotifications = currentNotifications.filter(n => !n.hasAttribute('data-au-processed'));

    console.log('[NOTIF DEBUG] New (unprocessed) notifications:', newNotifications.length);

    // BUG-003 fix: Check total count change instead of just lastCount > 0
    // This allows detection of new notifications loaded via infinite scroll
    if (newNotifications.length === 0 && currentNotifications.length === this.lastNotificationCount) {
      console.log('[NOTIF DEBUG] processNotifications SKIPPED - no new notifications and count unchanged');
      return;
    }

    this.lastNotificationCount = currentNotifications.length;
    this.isProcessing = true;
    this.needsReprocess = false;

    try {
      this.suspendObserver(this.OBSERVER_NAME);

      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];
      const singleGroupsToProcess: NotificationGroup[] = [];
      const pendingEnhancements: HTMLElement[] = []; // PERF: Batch API calls for clones added to existing groups

      // Pre-calculate visible notifications map for faster lookup
      const visibleNotifs = Array.from(document.querySelectorAll<HTMLElement>(
        '.notification:not(.au-hidden-notification):not(.au-sub-notification), ' +
        '.notification-item:not(.au-hidden-notification):not(.au-sub-notification)'
      ));

      for (const notification of newNotifications) {
        const username = this.extractUsernameFromNotif(notification);
        if (!username) {
          notification.setAttribute('data-au-processed', 'true');
          continue;
        }

        const text = notification.textContent || '';
        const notifType = notification.getAttribute('data-au-type') || this.groupService.detectNotificationType(text);
        if (notifType) notification.setAttribute('data-au-type', notifType);

        const time = notification.querySelector('.time')?.textContent?.trim() || '';

        // Find preceding visible notification (could be from previous batch)
        const idx = visibleNotifs.indexOf(notification);
        const prevVisible = idx > 0 ? visibleNotifs[idx - 1] : null;
        const prevUser = prevVisible ? this.extractUsernameFromNotif(prevVisible) : null;

        // Merging logic
        if (prevVisible && prevUser === username) {
          if (prevVisible.classList.contains('au-virtual-notification')) {
            this.addToExistingGroup(prevVisible, notification, username, pendingEnhancements);
            notification.setAttribute('data-au-processed', 'true');
            continue;
          } else if (currentGroup && currentGroup.user === username) {
            currentGroup.count++;
            currentGroup.elements.push(notification);
            currentGroup.latestTime = time;
            currentGroup.types.set(notifType || 'unknown', (currentGroup.types.get(notifType || 'unknown') || 0) + 1);
            continue;
          } else {
            // Check if prevVisible is a single notification (not yet in a group)
            if (currentGroup) {
               if (currentGroup.count > 1) groupsToProcess.push(currentGroup);
               else singleGroupsToProcess.push(currentGroup);
            }
            
            currentGroup = {
              user: username,
              types: new Map([[notifType || 'unknown', 2]]), 
              count: 2,
              elements: [prevVisible, notification],
              firstTime: prevVisible.querySelector('.time')?.textContent?.trim() || time,
              latestTime: time,
            };
            continue;
          }
        }

        // Standard: Not consecutive, close previous group and start new one
        if (currentGroup) {
          if (currentGroup.count > 1) groupsToProcess.push(currentGroup);
          else singleGroupsToProcess.push(currentGroup);
        }

        currentGroup = {
          user: username,
          types: new Map([[notifType || 'unknown', 1]]),
          count: 1,
          elements: [notification],
          firstTime: time,
          latestTime: time,
        };
      }

      if (currentGroup) {
        if (currentGroup.count > 1) groupsToProcess.push(currentGroup);
        else singleGroupsToProcess.push(currentGroup);
      }

      // Process groups
      for (const group of groupsToProcess) {
        await this.performGrouping(group);
      }

      // Enhancement for singles
      if (singleGroupsToProcess.length > 0) {
        const singles = singleGroupsToProcess.map(g => g.elements[0]);
        singles.forEach(s => {
          const id = this.fetchService.extractActivityId(s);
          if (id) s.setAttribute('data-activity-id', id.toString());
          this.groupService.injectUserLink(s, this.extractUsernameFromNotif(s));
          this.setupSingleClick(s);
        });
        await this.groupService.enhanceNotificationsWithActivityDetails(singles);
      }

      // PERF: Batch enhance all clones added to existing groups in a single API call
      if (pendingEnhancements.length > 0) {
        await this.groupService.enhanceNotificationsWithActivityDetails(pendingEnhancements);
      }

      newNotifications.forEach(n => n.setAttribute('data-au-processed', 'true'));
    } finally {
      this.isProcessing = false;
      this.resumeObserver(this.OBSERVER_NAME);
      if (this.needsReprocess) {
        this.needsReprocess = false;
        setTimeout(() => this.processNotifications(), 100);
      }
    }
  }

  private async performGrouping(group: NotificationGroup): Promise<void> {
    const firstNotif = group.elements[0];
    const virtualNotif = this.createVirtualNotification(firstNotif, group);
    const dropdown = this.createDropdown(group);

    firstNotif.parentNode?.insertBefore(virtualNotif, firstNotif);
    firstNotif.parentNode?.insertBefore(dropdown, firstNotif);

    const isSingleType = group.types.size === 1;
    await this.groupService.enhanceNotificationsWithActivityDetails(
      Array.from(dropdown.querySelectorAll('.au-sub-notification')),
      isSingleType
    );

    group.elements.forEach(n => {
      n.style.display = 'none';
      n.classList.add('au-hidden-notification');
    });
  }

  private createVirtualNotification(template: HTMLElement, group: NotificationGroup): HTMLElement {
    const vn = (template.tagName === 'A' ? document.createElement('div') : template.cloneNode(true)) as HTMLElement;
    if (template.tagName === 'A') {
      vn.className = template.className;
      vn.innerHTML = template.innerHTML;
    }
    vn.classList.add('au-virtual-notification');

    // Convert activity links to spans inside virtual notif to prevent corruption
    vn.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href')?.includes('/activity/')) {
        const span = document.createElement('span');
        span.className = link.className;
        span.innerHTML = link.innerHTML;
        link.parentNode?.replaceChild(span, link);
      }
    });

    vn.setAttribute('data-au-user', group.user);
    this.groupService.injectUserLink(vn, group.user);
    const textEl = vn.querySelector('.details, .text, .content') || vn;
    const userLink = textEl.querySelector('a[href*="/user/"]');
    const newActionText = this.groupService.generateGroupText(group);

    if (userLink) {
      textEl.innerHTML = `<span class="au-notification-content">${userLink.outerHTML} ${newActionText}</span>`;
    } else {
      textEl.innerHTML = `<span class="au-notification-content">${newActionText}</span>`;
    }

    vn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      const dropdown = vn.nextElementSibling as HTMLElement;
      if (dropdown && dropdown.classList.contains('au-notification-dropdown')) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Add timestamp range (Recent - Oldest)
    const firstTime = template.querySelector('.time')?.textContent?.trim();
    const lastNotif = group.elements[group.elements.length - 1];
    const lastTime = lastNotif.querySelector('.time')?.textContent?.trim();

    if (firstTime) {
      const timeContainer = document.createElement('div');
      timeContainer.className = 'time';
      timeContainer.style.position = 'absolute';
      timeContainer.style.top = '10px';
      timeContainer.style.right = '12px';
      timeContainer.style.fontSize = '1.1rem';
      timeContainer.style.color = 'var(--color-text-lighter)';
      timeContainer.style.opacity = '0.8';
      timeContainer.textContent = (lastTime && lastTime !== firstTime) 
        ? `${firstTime} - ${lastTime}` 
        : firstTime;
      vn.appendChild(timeContainer);
    }

    return vn;
  }

  private createDropdown(group: NotificationGroup): HTMLElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'au-notification-dropdown';
    dropdown.style.display = 'none';
    const inner = document.createElement('div');
    inner.className = 'au-notification-dropdown-inner';

    group.elements.forEach(notif => {
      const clone = (notif.tagName === 'A' ? document.createElement('div') : notif.cloneNode(true)) as HTMLElement;
      if (notif.tagName === 'A') {
        clone.className = notif.className;
        clone.innerHTML = notif.innerHTML;
      }
      clone.classList.add('au-sub-notification');
      clone.setAttribute('data-au-processed', 'true');
      this.groupService.stripUsername(clone, group.user);
      inner.appendChild(clone);
    });

    dropdown.appendChild(inner);
    return dropdown;
  }

  private addToExistingGroup(
    virtual: HTMLElement,
    notif: HTMLElement,
    user: string,
    pendingEnhancements: HTMLElement[]
  ): void {
    const countEl = virtual.querySelector('.au-activity-count') as HTMLElement;
    if (countEl) {
      countEl.style.textDecoration = 'none';
      countEl.textContent = (parseInt(countEl.textContent || '0') + 1).toString();
    }

    const dropdown = virtual.nextElementSibling?.querySelector('.au-notification-dropdown-inner');
    if (dropdown) {
      const clone = notif.cloneNode(true) as HTMLElement;
      clone.classList.add('au-sub-notification');
      clone.style.whiteSpace = 'nowrap';
      clone.setAttribute('data-au-processed', 'true');
      this.groupService.stripUsername(clone, user);
      dropdown.appendChild(clone);

      // PERF: Defer API call - will be batched later
      pendingEnhancements.push(clone);
    }
    notif.style.display = 'none';
    notif.classList.add('au-hidden-notification');
  }

  private extractUsernameFromNotif(notif: HTMLElement): string {
    const attr = notif.getAttribute('data-au-user');
    if (attr) return attr;
    const link = notif.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
    const user = link?.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';
    if (user) notif.setAttribute('data-au-user', user);
    return user;
  }

  private setupSingleClick(notif: HTMLElement): void {
    const id = notif.getAttribute('data-activity-id');
    if (!id) return;
    notif.style.cursor = 'pointer';
    notif.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      window.location.href = `/activity/${id}`;
    });
  }

  private clearVirtualNotifications(): void {
    const virtuals = document.querySelectorAll('.au-virtual-notification, .au-notification-dropdown');
    const hiddens = document.querySelectorAll<HTMLElement>('.au-hidden-notification');

    console.log(`[NOTIF DEBUG] clearVirtualNotifications - removing ${virtuals.length} virtuals, restoring ${hiddens.length} hiddens`);
    log.debug(`[NotificationCleaner] Clearing ${virtuals.length} virtual notifications, ${hiddens.length} hidden notifications`);

    virtuals.forEach(n => n.remove());
    hiddens.forEach(n => {
      n.style.display = '';
      n.classList.remove('au-hidden-notification');
      n.removeAttribute('data-au-processed');
    });
  }

  public async destroy(): Promise<void> {
    this.fullReset();
    await super.destroy();
  }
}
