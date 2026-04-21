/**
 * Notification Cleaner Module - Anti-spam for notifications
 * Groups duplicate activity likes from the same user
 */

import { log } from '@core/logger';
import { storage } from '@core/storage/StorageManager';
import { BaseModule } from '@core/modules/BaseModule';
import { anilistClient } from '@/api/AnilistClient';
import '../../styles/notification-cleaner.css';

interface NotificationGroup {
  user: string;
  types: Map<string, number>; // notification type -> count
  count: number;
  elements: HTMLElement[];
  firstTime: string;
  latestTime: string;
}

interface ActivityData {
  status?: string;
  media?: {
    id: number;
    type: 'ANIME' | 'MANGA';
    title: {
      romaji: string;
      english: string | null;
    };
  };
  text?: string;
  message?: string;
}

export class NotificationCleanerModule extends BaseModule {
  private enabled: boolean = false;
  private toggleButton: HTMLElement | null = null;
  private isProcessing = false;
  private needsReprocess = false;
  private searchBar: HTMLElement | null = null;
  private searchQuery: string = '';
  private lastNotificationCount = 0;
  private readonly OBSERVER_NAME = 'notifications-continuous';

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('NotificationCleaner: Initializing...');

    this.enabled = (await storage.get<boolean>('clutterfree_group_likes')) ?? false;

    this.watchPageNavigation((path) => {
      this.fullReset();
      if (path.includes('/notifications')) {
        this.startObservation();
      }
    });

    if (window.location.pathname.includes('/notifications')) {
      this.startObservation();
    }
  }

  private fullReset(): void {
    this.cleanup();
    this.toggleButton?.remove();
    this.toggleButton = null;
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

    const markAllButton = document.querySelector('.reset-btn');
    if (markAllButton && !document.querySelector('.au-compress-button')) {
      this.injectSettingsUI(markAllButton as HTMLElement);
    }

    // Inject search bar if not present
    if (!this.searchBar) {
      this.injectSearchBar();
    }

    const container = document.querySelector('.notifications');
    if (container) {
      this.processNotifications();
    }

    // Apply search filter if query exists
    if (this.searchQuery) {
      this.applySearchFilter();
    }
  }

  private injectSettingsUI(markAllButton: HTMLElement): void {
    if (document.querySelector('.au-compress-button')) return;

    const compressButton = document.createElement('div');
    compressButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
    compressButton.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';

    compressButton.addEventListener('click', () => this.toggleGrouping());

    markAllButton.parentElement?.insertBefore(compressButton, markAllButton);
    this.toggleButton = compressButton;
  }

  private async toggleGrouping(): Promise<void> {
    this.enabled = !this.enabled;
    await storage.set('clutterfree_group_likes', this.enabled);

    if (this.toggleButton) {
      this.toggleButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
      this.toggleButton.textContent = this.enabled ? 'Unmerge User Activity' : 'Merge User Activity';
    }

    // Clear processed markers to allow re-processing
    document.querySelectorAll<HTMLElement>('.notification[data-au-processed]').forEach(n => {
      n.removeAttribute('data-au-processed');
    });

    this.suspendObserver(this.OBSERVER_NAME);
    this.clearVirtualNotifications();
    
    // Process notifications again to apply single enhancements even if grouping is disabled
    this.processNotifications();
    this.resumeObserver(this.OBSERVER_NAME);
  }

  private async processNotifications(): Promise<void> {
    if (this.isProcessing) {
      // If already processing, mark that we need to reprocess after current cycle
      this.needsReprocess = true;
      return;
    }

    // Get all original notifications (not virtual, not sub-notification)
    const currentNotifications = Array.from(document.querySelectorAll<HTMLElement>('.notification:not(.au-virtual-notification):not(.au-sub-notification)'));

    // Check if there are NEW notifications (without data-au-processed attribute)
    const newNotifications = currentNotifications.filter(n => !n.hasAttribute('data-au-processed'));

    if (newNotifications.length === 0 && this.lastNotificationCount > 0) {
      log.info('[NotificationCleaner] ⏭️ Skipping - no new notifications to process');
      return; // No new notifications, avoid stutter
    }

    log.info(`[NotificationCleaner] Processing: ${newNotifications.length} new / ${currentNotifications.length} total`);
    this.lastNotificationCount = currentNotifications.length;

    this.isProcessing = true;
    this.needsReprocess = false;

    try {
      // SUSPEND observer before making domestic changes to prevent loop (stuttering)
      this.suspendObserver(this.OBSERVER_NAME);

      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];
      const singleGroupsToProcess: NotificationGroup[] = [];

      for (const notification of newNotifications) {
        const text = notification.textContent || '';
        let notifType = notification.getAttribute('data-au-type');
        if (!notifType) {
          notifType = this.detectNotificationType(text);
          if (notifType) {
            notification.setAttribute('data-au-type', notifType);
          }
        }

        const userLink = notification.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
        if (!userLink) {
          notification.setAttribute('data-au-processed', 'true');
          continue;
        }

        const username = userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';
        const time = notification.querySelector('.time')?.textContent?.trim() || '';

        if (!notifType || !this.enabled) {
          if (currentGroup && currentGroup.count > 1) groupsToProcess.push(currentGroup);
          currentGroup = null;
          // If unmerged (disabled), or not groupable, treat everything as single
          const typeMap = new Map<string, number>();
          if (notifType) typeMap.set(notifType, 1);
          singleGroupsToProcess.push({
            user: username,
            types: typeMap,
            count: 1,
            elements: [notification],
            firstTime: time,
            latestTime: time
          });
          notification.setAttribute('data-au-processed', 'true');
          continue;
        }

        // 1. Check if an existing virtual group for this user is already in the document
        const existingVirtual = this.findVirtualNotificationForUser(username);

        if (existingVirtual) {
          log.info(`[NotificationCleaner] ➕ Adding to existing group for ${username}`);
          if (currentGroup && currentGroup.count > 1) groupsToProcess.push(currentGroup);
          currentGroup = null;
          
          await this.addToExistingGroup(existingVirtual, notification, notifType);
          notification.setAttribute('data-au-processed', 'true');
          continue;
        }

        // 2. Standard grouping logic for remaining new elements
        if (currentGroup && currentGroup.user === username) {
          currentGroup.count++;
          currentGroup.elements.push(notification);
          currentGroup.latestTime = time;

          const typeCount = currentGroup.types.get(notifType) || 0;
          currentGroup.types.set(notifType, typeCount + 1);
        } else {
          if (currentGroup) {
            if (currentGroup.count > 1) groupsToProcess.push(currentGroup);
            else if (currentGroup.count === 1) singleGroupsToProcess.push(currentGroup);
          }

          const typesMap = new Map<string, number>();
          typesMap.set(notifType, 1);

          currentGroup = {
            user: username,
            types: typesMap,
            count: 1,
            elements: [notification],
            firstTime: time,
            latestTime: time,
          };
        }
      }

      if (currentGroup) {
        if (currentGroup.count > 1) groupsToProcess.push(currentGroup);
        else if (currentGroup.count === 1) singleGroupsToProcess.push(currentGroup);
      }

      // Process new groups sequentially
      for (const group of groupsToProcess) {
        await this.groupNotifications(group).catch(err => {
          log.error('Failed to group notifications', err);
        });
      }

      // Process single notifications for enhancement
      if (singleGroupsToProcess.length > 0) {
        const singlesToProcess: HTMLElement[] = [];
        
        singleGroupsToProcess.forEach(group => {
          const single = group.elements[0];
          singlesToProcess.push(single);

          const activityId = this.extractActivityId(single);
          if (activityId) {
            single.setAttribute('data-activity-id', activityId.toString());
            
            // Un-nest a.link to prevent invalid HTML when injecting title links
            single.querySelectorAll('a').forEach(link => {
              if (link.getAttribute('href')?.includes('/activity/')) {
                const span = document.createElement('span');
                span.className = link.className;
                span.innerHTML = link.innerHTML;
                link.parentNode?.replaceChild(span, link);
              }
            });

            // Only inject user link AFTER the outer activity <a> has been converted to <span>
            this.injectUserLink(single, group.user);

            // Ensure single notification remains clickable!
            single.style.cursor = 'pointer';
            single.addEventListener('click', (e) => {
              const target = e.target as HTMLElement;
              const link = target.closest('a');
              if (link) {
                const href = link.getAttribute('href');
                if (href && !link.classList.contains('title')) {
                  e.preventDefault();
                  e.stopPropagation();
                  window.location.href = href;
                }
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              window.location.href = `/activity/${activityId}`;
            });
          } else {
            // No activity ID (e.g. message), still inject user link
            this.injectUserLink(single, group.user);
          }
        });
        
        await this.enhanceNotificationsWithActivityDetails(singlesToProcess).catch(err => {
          log.error('Failed to enhance single notifications', err);
        });
      }

      // Mark ALL remaining new notifications as processed to prevent infinite loops
      newNotifications.forEach(n => {
        if (!n.hasAttribute('data-au-processed')) {
          n.setAttribute('data-au-processed', 'true');
        }
      });
    } finally {
      this.isProcessing = false;
      // RESUME observer after changes are complete
      this.resumeObserver(this.OBSERVER_NAME);

      // If new notifications arrived during processing, reprocess
      if (this.needsReprocess) {
        this.needsReprocess = false;
        setTimeout(() => this.processNotifications(), 100);
      }
    }
  }

  private async groupNotifications(group: NotificationGroup): Promise<void> {
    log.info(`[NotificationCleaner] 🎯 START groupNotifications for user ${group.user}, ${group.count} activities`);

    const firstNotif = group.elements[0];
    let virtualNotif: HTMLElement;
    if (firstNotif.tagName.toUpperCase() === 'A') {
      virtualNotif = document.createElement('div');
      virtualNotif.className = firstNotif.className;
      virtualNotif.innerHTML = firstNotif.innerHTML;
    } else {
      virtualNotif = firstNotif.cloneNode(true) as HTMLElement;
    }
    virtualNotif.classList.add('au-virtual-notification');

    // Ensure links are interactive and prevent nested <a> tag corruption
    const virtualLinks = virtualNotif.querySelectorAll('a');
    virtualLinks.forEach(link => {
      const href = link.getAttribute('href');
      // AniList wraps the text in an activity link. If we inject a user link into it natively, it corrupts the HTML.
      // We safely convert this wrapper link into a span. The parent div handles dropdown clicks anyway.
      if (href && href.includes('/activity/')) {
        const span = document.createElement('span');
        span.className = link.className;
        span.innerHTML = link.innerHTML;
        link.parentNode?.replaceChild(span, link);
      } else {
        link.style.pointerEvents = 'auto';
      }
    });

    const textElement = virtualNotif.querySelector('.details, .text, .content') || virtualNotif;
    if (textElement) {
      // Inject user link natively before doing textual replacements
      this.injectUserLink(virtualNotif, group.user);

      // Generate smart text based on notification types
      const { find, replace } = this.generateGroupText(group);
      textElement.innerHTML = textElement.innerHTML.replace(find, replace);

      const timeEl = virtualNotif.querySelector('.time');
      if (timeEl && group.firstTime !== group.latestTime) {
        // most recent on the left (firstTime)
        const first = group.firstTime.replace(/\s+ago$/i, '');
        timeEl.textContent = `${first} - ${group.latestTime}`;
      }
    }

    // Create dropdown container with wrapper for proper border positioning
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'au-notification-dropdown';
    dropdownContainer.style.display = 'none';

    // Inner wrapper for border that matches content height - styles moved to notification-cleaner.css
    const dropdownInner = document.createElement('div');
    dropdownInner.className = 'au-notification-dropdown-inner';

    // Add original notifications to dropdown and collect clones
    const clones: HTMLElement[] = [];
    group.elements.forEach((notif) => {
      // Extract activity ID before doing any manipulation wrapper
      const activityId = this.extractActivityId(notif);
      
      let clone: HTMLElement;
      if (notif.tagName.toUpperCase() === 'A') {
        clone = document.createElement('div');
        clone.className = notif.className;
        clone.innerHTML = notif.innerHTML;
      } else {
        clone = notif.cloneNode(true) as HTMLElement;
      }
      
      if (activityId) {
        clone.setAttribute('data-activity-id', activityId.toString());
      }
      
      clone.style.display = '';
      clone.style.opacity = '0.9';
      clone.classList.remove('au-hidden-notification');
      clone.classList.add('au-sub-notification'); // Add class for styling
      clone.setAttribute('data-au-processed', 'true'); // Pre-mark the clone to completely bypass the observer loop

      // Remove username and avatar from clone text (it's redundant since it's in virtual notif)
      const usernameSelectors = ['a[href*="/user/"]', '.name', '.user', '.avatar'];
      usernameSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Strip leftover plain-text username from the clone's text content
      const textContainers = clone.querySelectorAll('.text, .content');
      textContainers.forEach(container => {
        // Strip the username if it appears as plain text at the beginning
        const userPattern = new RegExp(`^\\s*${group.user}\\s+`, 'i');
        container.innerHTML = container.innerHTML.replace(userPattern, '');
      });

      // Disable default links that are not 'title' and unwrap activity links
      clone.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes('/activity/')) {
          const span = document.createElement('span');
          span.className = link.className;
          span.innerHTML = link.innerHTML;
          link.parentNode?.replaceChild(span, link);
        } else if (!link.classList.contains('title')) {
          link.style.pointerEvents = 'none';
          link.style.cursor = 'default';
        }
      });

      // Add general click handler for the whole notification card

      if (activityId) {
        clone.style.cursor = 'pointer';
        clone.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          // Allow clicks on our injected media title link
          if (target.closest('a.title')) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          window.location.href = `/activity/${activityId}`;
        });
      } else {
        clone.style.cursor = 'default';
        clone.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('a.title')) return;
          e.preventDefault();
          e.stopPropagation();
        });
      }

      clones.push(clone);
      dropdownInner.appendChild(clone);
    });

    dropdownContainer.appendChild(dropdownInner);

    // Fetch and display activity details
    log.info(`[NotificationCleaner] 🚀 CALLING enhanceNotificationsWithActivityDetails with ${clones.length} clones`);
    this.enhanceNotificationsWithActivityDetails(clones).catch(err => {
      log.error('[NotificationCleaner] ❌ FAILED to enhance notifications:', err);
    });

    // Insert virtual notification and dropdown
    firstNotif.parentNode?.insertBefore(virtualNotif, firstNotif);
    firstNotif.parentNode?.insertBefore(dropdownContainer, firstNotif);

    // Make the virtual grouped notification fully interactive
    virtualNotif.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // Let standard links work natively (e.g. user avatar, name) via explicit manual routing avoiding Vue DOM detach issues
      const link = target.closest('a');
      if (link) {
        const href = link.getAttribute('href');
        if (href && !link.classList.contains('title')) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = href;
        }
        return;
      }


      // If clicked anywhere else, toggle the dropdown
      e.preventDefault();
      e.stopPropagation();
      const isVisible = dropdownContainer.style.display !== 'none';
      dropdownContainer.style.display = isVisible ? 'none' : 'block';
      log.info(`[NotificationCleaner] 🔄 Dropdown toggled: ${dropdownContainer.style.display === 'block' ? 'OPEN' : 'CLOSED'}`);
    });

    // Hide original notifications
    group.elements.forEach(notif => {
      notif.style.display = 'none';
      notif.classList.add('au-hidden-notification');
    });
  }


  /**
   * Find virtual notification for a specific user
   */
  private findVirtualNotificationForUser(username: string): HTMLElement | null {
    const virtualNotifs = document.querySelectorAll<HTMLElement>('.au-virtual-notification');
    for (const vn of Array.from(virtualNotifs)) {
      const userLink = vn.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
      if (userLink && userLink.textContent?.trim() === username) {
        return vn;
      }
    }
    return null;
  }

  /**
   * Add a notification to an existing group
   */
  private async addToExistingGroup(virtualNotif: HTMLElement, notification: HTMLElement, _notifType: string): Promise<void> {
    // Find the dropdown for this virtual notification
    const dropdown = virtualNotif.nextElementSibling as HTMLElement;
    if (!dropdown || !dropdown.classList.contains('au-notification-dropdown')) {
      log.error('[NotificationCleaner] Cannot find dropdown for virtual notification');
      return;
    }

    // Update counter in virtual notification
    const countElement = virtualNotif.querySelector('.au-activity-count');
    if (countElement) {
      const currentCount = parseInt(countElement.textContent || '0', 10);
      const newCount = currentCount + 1;
      countElement.textContent = `${newCount}`;
      log.info(`[NotificationCleaner] Updated count: ${currentCount} → ${newCount}`);
    }

    // Create clone and add to dropdown
    const dropdownInner = dropdown.querySelector('.au-notification-dropdown-inner');
    if (dropdownInner) {
      const clone = notification.cloneNode(true) as HTMLElement;
      clone.style.display = '';
      clone.style.opacity = '0.9';
      clone.classList.remove('au-hidden-notification');
      clone.classList.add('au-sub-notification');
      clone.setAttribute('data-au-processed', 'true'); // Pre-mark to prevent observer loop
      // Remove username from clone via safe DOM walker
      const userLink = notification.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
      const username = userLink ? userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '' : '';
      if (username) this.stripUsername(clone, username);

      // Disable clicks
      clone.style.cursor = 'default';
      clone.querySelectorAll('a').forEach(link => {
        link.style.pointerEvents = 'none';
        link.style.cursor = 'default';
      });

      clone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      dropdownInner.appendChild(clone);

      // Enhance with activity details
      await this.enhanceNotificationsWithActivityDetails([clone]);
    }

    // Hide original notification
    notification.style.display = 'none';
    notification.classList.add('au-hidden-notification');
  }

  /**
   * Detect notification type from text content
   */
  private detectNotificationType(text: string): string | null {
    if (text.includes('liked your activity')) return 'activity_like';
    if (text.includes('sent you a message')) return 'message';
    if (text.includes('liked your forum thread')) return 'thread_like';
    if (text.includes('liked your activity reply')) return 'reply_like';
    if (text.includes('liked your forum comment')) return 'forum_comment_like';
    if (text.includes('replied to your activity')) return 'activity_reply';
    if (text.includes('mentioned you')) return 'mention';
    return null; // Not groupable
  }

  /**
   * Generate smart notification text based on types
   */
  private generateGroupText(group: NotificationGroup): { find: string; replace: string } {
    const types = Array.from(group.types.keys());
    const isSingleType = types.length === 1;
    const count = group.count;
    const countSpan = `<span class="au-activity-count" data-group-id="${Date.now()}" style="cursor: pointer;">${count}</span>`;

    if (isSingleType) {
      const type = types[0];
      switch (type) {
        case 'activity_like':
          return { find: 'liked your activity', replace: `liked <b>${countSpan}</b> of your activities` };
        case 'message':
          return { find: 'sent you a message', replace: `sent you <b>${countSpan}</b> messages` };
        case 'thread_like':
          return { find: 'liked your forum thread', replace: `liked <b>${countSpan}</b> of your forum threads` };
        case 'reply_like':
          return { find: 'liked your activity reply', replace: `liked <b>${countSpan}</b> of your activity replies` };
        case 'activity_reply':
          return { find: 'replied to your activity', replace: `replied <b>${countSpan}</b> times to your activity` };
        default:
          return { find: '', replace: `interacted <b>${countSpan}</b> times` };
      }
    } else {
      // Mixed types - use generic "interacted"
      // Find the first type to replace its text
      const firstNotifText = group.elements[0].textContent || '';
      let findPattern = 'liked your activity'; // default
      if (firstNotifText.includes('sent you a message')) findPattern = 'sent you a message';
      else if (firstNotifText.includes('liked your forum thread')) findPattern = 'liked your forum thread';

      return { find: findPattern, replace: `interacted with you <b>${countSpan}</b> times` };
    }
  }

  private clearVirtualNotifications(): void {
    document.querySelectorAll('.au-virtual-notification').forEach(n => n.remove());
    document.querySelectorAll('.au-notification-dropdown').forEach(n => n.remove());
    document.querySelectorAll<HTMLElement>('.au-hidden-notification').forEach(n => {
      n.style.display = '';
      n.classList.remove('au-hidden-notification');
      // Remove processed marker so notifications can be re-grouped
      n.removeAttribute('data-au-processed');
    });
  }

  /**
   * Safely removes the plain-text username from clones
   */
  private stripUsername(notification: Element, username: string): void {
    const textContainers = notification.querySelectorAll('.details, .text, .content');
    if (textContainers.length === 0) return;
    
    const walkDOM = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const idx = text.toLowerCase().indexOf(username.toLowerCase());
        
        if (idx !== -1) {
          node.textContent = text.substring(0, idx) + text.substring(idx + username.length);
          return true; // Stop walking
        }
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walkDOM(child)) return true;
        }
      }
      return false;
    };
    
    walkDOM(textContainers[0]);
  }

  /**
   * Safely injects a clickable link over a plain-text username
   */
  private injectUserLink(notification: Element, username: string): void {
    const textContainers = notification.querySelectorAll('.details, .text, .content');
    if (textContainers.length === 0) return;
    
    const walkDOM = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const idx = text.toLowerCase().indexOf(username.toLowerCase());
        
        if (idx !== -1) {
          // Verify we aren't already inside an anchor tag
          let parent = node.parentNode;
          while (parent) {
            if (parent.nodeName.toLowerCase() === 'a') return false;
            if ((parent as Element).classList) {
               const classes = (parent as Element).classList;
               if (classes.contains('text') || classes.contains('details') || classes.contains('content')) break;
            }
            parent = parent.parentNode;
          }

          const a = document.createElement('a');
          a.href = `/user/${username}`;
          a.className = 'name au-user-link';
          a.style.pointerEvents = 'auto';
          a.textContent = text.substring(idx, idx + username.length);
          
          const beforeText = document.createTextNode(text.substring(0, idx));
          const afterText = document.createTextNode(text.substring(idx + username.length));
          
          if (node.parentNode) {
            node.parentNode.insertBefore(beforeText, node);
            node.parentNode.insertBefore(a, node);
            node.parentNode.insertBefore(afterText, node);
            node.parentNode.removeChild(node);
            return true; // Stop walking
          }
        }
      } else {
        // Continue walking children
        for (const child of Array.from(node.childNodes)) {
          if (walkDOM(child)) return true;
        }
      }
      return false;
    };
    
    walkDOM(textContainers[0]);
  }

  /**
   * Extract activity ID from notification href
   */
  private extractActivityId(notification: HTMLElement): number | null {
    // Check if we cached it first
    const dataId = notification.getAttribute('data-activity-id');
    if (dataId) return parseInt(dataId, 10);

    // Collect all links that might point to an activity
    const links = Array.from(notification.querySelectorAll<HTMLAnchorElement>('a[href*="/activity/"]'));
    
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        log.info(`[NotificationCleaner] ✅ Extracted activity ID: ${id}`);
        return id;
      }
    }

    log.warn('[NotificationCleaner] ❌ No activity ID found in links');
    return null;
  }

  /**
   * Fetch activity details in batch using GraphQL alias
   */
  private async fetchActivityDetails(activityIds: number[]): Promise<Map<number, { text: string; mediaId?: number; mediaTitle?: string; status?: string }>> {
    if (activityIds.length === 0) return new Map();

    const fields = `
      ... on ListActivity {
        status
        media {
          id
          type
          title {
            romaji
            english
          }
        }
      }
      ... on TextActivity {
        text(asHtml: false)
      }
      ... on MessageActivity {
        message(asHtml: false)
      }
    `;

    const aliases = activityIds.map(id => `a${id}: Activity(id: ${id}) { ${fields} }`);
    const query = `query { ${aliases.join('\n')} }`;

    try {
      const response = await anilistClient.query<Record<string, ActivityData>>(query);
      const results = new Map<number, { text: string; type: string; mediaId?: number; mediaTitle?: string; status?: string }>();

      Object.entries(response).forEach(([alias, activity]) => {
        if (!activity) return;

        const id = parseInt(alias.replace('a', ''), 10);
        let text = 'your activity';
        let actType = 'unknown';
        let mediaId: number | undefined;
        let mediaTitle: string | undefined;
        let status: string | undefined;

        if (activity.media && activity.status) {
          actType = 'media';
          const title = activity.media.title.english || activity.media.title.romaji;
          status = activity.status.replace(/_/g, ' ').toLowerCase();
          text = `${status} <a href="/${activity.media.type.toLowerCase()}/${activity.media.id}" class="title au-title">${title}</a>`;
          mediaId = activity.media.id;
          mediaTitle = title;
        } else if (activity.message) {
          actType = 'message';
          text = `<i>"${activity.message.substring(0, 50)}${activity.message.length > 50 ? '...' : ''}"</i>`;
        } else if (activity.text) {
          actType = 'text';
          text = `<i>"${activity.text.substring(0, 50)}${activity.text.length > 50 ? '...' : ''}"</i>`;
        }

        results.set(id, { text, type: actType, mediaId, mediaTitle, status });
      });

      return results;
    } catch (error) {
      log.error('Failed to fetch activity details', error);
      return new Map();
    }
  }

  /**
   * Enhance notifications with activity details
   */
  private async enhanceNotificationsWithActivityDetails(clones: HTMLElement[]): Promise<void> {
    log.info(`[NotificationCleaner] 🔍 Starting enhancement for ${clones.length} clones`);

    const activityIds = clones
      .map(clone => {
        const id = this.extractActivityId(clone);
        log.info(`[NotificationCleaner] Clone extraction result: ${id || 'NULL'}`);
        return id;
      })
      .filter((id): id is number => id !== null);

    log.info(`[NotificationCleaner] ✅ Extracted ${activityIds.length} activity IDs: [${activityIds.join(', ')}]`);

    if (activityIds.length === 0) {
      log.error('[NotificationCleaner] ❌ NO activity IDs found! Cannot fetch details');
      // Log the HTML of first clone to debug
      if (clones.length > 0) {
        log.info('[NotificationCleaner] First clone HTML:', clones[0].outerHTML.substring(0, 500));
      }
      return;
    }

    const activityDetails = await this.fetchActivityDetails(activityIds);
    log.info(`[NotificationCleaner] Fetched ${activityDetails.size} activity details`);

    clones.forEach((clone) => {
      const activityId = this.extractActivityId(clone);
      if (!activityId) {
        log.warn('[NotificationCleaner] Clone has no activity ID');
        return;
      }

      const activityData = activityDetails.get(activityId);
      if (!activityData) {
        log.warn(`[NotificationCleaner] ⚠️ No details found for activity ${activityId}`);
        return;
      }

      log.info(`[NotificationCleaner] 📝 Processing activity ${activityId} with details: "${activityData.text}"`);

      // Try multiple selectors to find the element containing the content
      const possibleSelectors = ['.details', '.text', '.content'];
      let textElement: Element | null = null;

      for (const selector of possibleSelectors) {
        const elements = clone.querySelectorAll(selector);
        // Find the one that actually contains text to replace
        for (const el of Array.from(elements)) {
          if (el.textContent?.trim().length) {
            textElement = el;
            break;
          }
        }
        if (textElement) break;
      }

      if (!textElement) {
        // Fallback to clone itself if .text or .content isn't found
        textElement = clone;
      }

      const originalHTML = textElement.innerHTML;
      // Robust replacement - target the phrase and variations
      let newHTML = originalHTML;

      if (activityData.mediaId) {
        // We pre-formatted the text to include the HTML link in fetchActivityDetails
        const patterns = [
          new RegExp(`liked your activity\\.?`, 'i'),
          new RegExp(`liked your activity\\s*`, 'i'),
          new RegExp(`liked your\\s+`, 'i')
        ];

        for (const pattern of patterns) {
          if (pattern.test(originalHTML)) {
            // "Carlos liked: watched episode NIPPON SANGOKU"
            const replacementText = `liked: ${activityData.text}`;
            newHTML = originalHTML.replace(pattern, replacementText);
            break;
          }
        }
      } else if (activityData.text) {
        // Smart replacement based on notification text
        const isLike = originalHTML.toLowerCase().includes('liked');
        const isReply = originalHTML.toLowerCase().includes('replied');
        const isMessage = originalHTML.toLowerCase().includes('message');

        let replacementPrefix = '';
        if (isLike) replacementPrefix = 'liked: ';
        else if (isReply) replacementPrefix = 'replied: ';
        else if (isMessage) replacementPrefix = 'sent: ';
        else replacementPrefix = 'wrote: ';

        const patterns = [
          new RegExp(`sent you a message\\.?`, 'i'),
          new RegExp(`replied to your activity\\.?`, 'i'),
          new RegExp(`liked your activity\\.?`, 'i'),
          new RegExp(`liked your activity reply\\.?`, 'i')
        ];

        for (const pattern of patterns) {
          if (pattern.test(originalHTML)) {
            newHTML = originalHTML.replace(pattern, `${replacementPrefix}${activityData.text}`);
            break;
          }
        }
      }

      if (newHTML !== originalHTML) {
        textElement.innerHTML = newHTML;

        // Re-enable the media link we just added (since all links in clone are disabled)
        if (activityData.mediaId) {
          const addedLink = textElement.querySelector<HTMLAnchorElement>('a.title');
          if (addedLink) {
            addedLink.style.pointerEvents = 'auto';
            // cursor pointer already handled globally, but we can enforce it
            addedLink.style.cursor = 'pointer';
            log.info(`[NotificationCleaner] ✅ Re-enabled media link: ${activityData.mediaTitle}`);
          }
        }

        log.info(`[NotificationCleaner] ✅ REPLACED text for activity ${activityId}`);
      } else {
        log.error(`[NotificationCleaner] ❌ FAILED to replace - no pattern matched in: "${originalHTML}"`);
      }
    });
  }

  /**
   * Inject search bar above notifications container
   */
  private injectSearchBar(): void {
    // Find the page-content container
    const pageContent = document.querySelector('.page-content > .container');
    if (!pageContent) {
      log.warn('[NotificationCleaner] Page content not found');
      return;
    }

    const searchBar = document.createElement('div');
    searchBar.className = 'au-notifications-search';
    searchBar.innerHTML = `
      <input type="text" class="au-search-input" placeholder="Search notifications..." />
    `;

    // Insert inside the notifications container
    const notificationsWrap = pageContent.querySelector('.notifications');
    if (notificationsWrap) {
      notificationsWrap.prepend(searchBar);
      this.searchBar = searchBar;

      const input = searchBar.querySelector<HTMLInputElement>('.au-search-input');
      if (input) {
        input.addEventListener('input', (e) => {
          this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
          this.applySearchFilter();
        });
      }

      log.info('[NotificationCleaner] ✅ Search bar injected');
    } else {
      log.warn('[NotificationCleaner] Notifications container not found');
    }
  }

  /**
   * Apply search filter to notifications
   */
  private applySearchFilter(): void {
    const notifications = document.querySelectorAll<HTMLElement>('.notification');

    notifications.forEach(notification => {
      // Skip virtual, hidden, and sub-notifications
      if (notification.classList.contains('au-virtual-notification') ||
          notification.classList.contains('au-hidden-notification') ||
          notification.classList.contains('au-sub-notification')) {
        return;
      }

      const text = notification.textContent?.toLowerCase() || '';
      const matches = !this.searchQuery || text.includes(this.searchQuery);

      notification.style.display = matches ? '' : 'none';
    });
  }

  public destroy(): void {
    super.destroy();
    this.fullReset();
    this.searchBar?.remove();
    this.searchBar = null;
  }
}
