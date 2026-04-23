/**
 * Notification Cleaner Module
 * Lean orchestrator for notification anti-spam and enhancement
 * Delegating responsibilities to specialized services (SRP)
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { storage } from '@core/storage/StorageManager';
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

  constructor(
    @inject(TOKENS.NotificationFetchService) private fetchService: NotificationFetchService,
    @inject(TOKENS.NotificationGroupService) private groupService: NotificationGroupService,
    @inject(TOKENS.NotificationFilterService) private filterService: NotificationFilterService
  ) {
    super();
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    try {
      log.info('NotificationCleaner: Initializing...');

      this.enabled = (await storage.get<boolean>('clutterfree_group_likes')) ?? false;

      this.onPageChange((event) => {
        const path = event?.path || window.location.pathname;
        this.fullReset();
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

    // Clear all processed markers
    document.querySelectorAll<HTMLElement>('.notification[data-au-processed]').forEach(n => {
      n.removeAttribute('data-au-processed');
    });
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });
  }

  private checkAndProcess(): void {
    if (this.isProcessing) return;

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
    if (document.querySelector('.au-compress-button')) return;

    const compressButton = document.createElement('div');
    compressButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
    compressButton.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';

    compressButton.addEventListener('click', () => this.toggleGrouping());

    markAllButton.parentElement?.insertBefore(compressButton, markAllButton);
  }

  private async toggleGrouping(): Promise<void> {
    this.enabled = !this.enabled;
    await storage.set('clutterfree_group_likes', this.enabled);

    const toggleBtn = document.querySelector('.au-compress-button');
    if (toggleBtn) {
      toggleBtn.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
      toggleBtn.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';
    }

    // Clear processed markers to allow re-processing
    document.querySelectorAll<HTMLElement>('.notification[data-au-processed]').forEach(n => {
      n.removeAttribute('data-au-processed');
    });

    this.suspendObserver(this.OBSERVER_NAME);
    this.isProcessing = false; // Force unlock for toggle
    this.fullReset();
    this.clearVirtualNotifications();

    // Small delay to let DOM settle
    setTimeout(() => {
      this.processNotifications();
      this.resumeObserver(this.OBSERVER_NAME);
    }, 50);
  }

  private async processNotifications(): Promise<void> {
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }

    const currentNotifications = Array.from(document.querySelectorAll<HTMLElement>(
      '.notification:not(.au-virtual-notification):not(.au-sub-notification), ' +
      '.notification-item:not(.au-virtual-notification):not(.au-sub-notification)'
    ));
    
    // Immediate tagging pass
    currentNotifications.forEach(n => this.extractUsernameFromNotif(n));

    const newNotifications = currentNotifications.filter(n => !n.hasAttribute('data-au-processed'));
    if (newNotifications.length === 0 && this.lastNotificationCount > 0) return;

    this.lastNotificationCount = currentNotifications.length;
    this.isProcessing = true;
    this.needsReprocess = false;

    try {
      this.suspendObserver(this.OBSERVER_NAME);

      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];
      const singleGroupsToProcess: NotificationGroup[] = [];

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
        let notifType = notification.getAttribute('data-au-type') || this.groupService.detectNotificationType(text);
        if (notifType) notification.setAttribute('data-au-type', notifType);

        const time = notification.querySelector('.time')?.textContent?.trim() || '';

        // Find preceding visible notification (could be from previous batch)
        const idx = visibleNotifs.indexOf(notification);
        const prevVisible = idx > 0 ? visibleNotifs[idx - 1] : null;
        const prevUser = prevVisible ? this.extractUsernameFromNotif(prevVisible) : null;

        // Merging logic
        if (prevVisible && prevUser === username) {
          if (prevVisible.classList.contains('au-virtual-notification')) {
            await this.addToExistingGroup(prevVisible, notification, username);
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
    this.groupService.enhanceNotificationsWithActivityDetails(
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

  private async addToExistingGroup(virtual: HTMLElement, notif: HTMLElement, user: string): Promise<void> {
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
      await this.groupService.enhanceNotificationsWithActivityDetails([clone]);
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
    document.querySelectorAll('.au-virtual-notification, .au-notification-dropdown').forEach(n => n.remove());
    document.querySelectorAll<HTMLElement>('.au-hidden-notification').forEach(n => {
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
