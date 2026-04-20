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
    if (container && this.enabled) {
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

    if (this.enabled) {
      this.processNotifications();
    } else {
      this.suspendObserver(this.OBSERVER_NAME);
      this.clearVirtualNotifications();
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private async processNotifications(): Promise<void> {
    if (this.isProcessing) {
      // If already processing, mark that we need to reprocess after current cycle
      this.needsReprocess = true;
      return;
    }

    // Get all original notifications (not virtual)
    const currentNotifications = Array.from(document.querySelectorAll<HTMLElement>('.notification:not(.au-virtual-notification)'));

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

      // Incremental merge: only process NEW notifications without clearing existing groups
      const hasExistingGroups = document.querySelectorAll('.au-virtual-notification').length > 0;
      let useIncrementalMerge = false;

      if (hasExistingGroups && newNotifications.length <= 5) {
        // INCREMENTAL: Try to add new notifications to existing groups
        log.info('[NotificationCleaner] ⚡ INCREMENTAL merge - keeping existing groups');
        await this.processNewNotificationsIncremental(newNotifications);
        useIncrementalMerge = true;
      } else {
        // FULL REPROCESS: Too many new or first time
        log.info('[NotificationCleaner] 🔄 FULL reprocess - clearing all groups');
        this.clearVirtualNotifications();
      }

      // Skip full reprocess if we did incremental
      if (useIncrementalMerge) {
        return;
      }

      const notifications = currentNotifications;
      if (notifications.length === 0) return;

      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];

      notifications.forEach((notification) => {
        const text = notification.textContent || '';
        const notifType = this.detectNotificationType(text);

        // Skip non-groupable notifications
        if (!notifType) {
          if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);
          currentGroup = null;
          return;
        }

        const userLink = notification.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
        if (!userLink) return;

        const username = userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';
        const time = notification.querySelector('.time')?.textContent?.trim() || '';

        if (currentGroup && currentGroup.user === username) {
          // Same user - add to group
          currentGroup.count++;
          currentGroup.elements.push(notification);
          currentGroup.latestTime = time;

          // Track type count
          const typeCount = currentGroup.types.get(notifType) || 0;
          currentGroup.types.set(notifType, typeCount + 1);
        } else {
          // Different user - close current group and start new
          if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);

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
      });

      if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);

      // Process groups asynchronously
      groupsToProcess.forEach(group => {
        this.groupNotifications(group).catch(err => {
          log.error('Failed to group notifications', err);
        });
      });

      // Mark ALL original notifications as processed to avoid re-scanning
      notifications.forEach(n => {
        n.setAttribute('data-au-processed', 'true');
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
    const virtualNotif = firstNotif.cloneNode(true) as HTMLElement;
    virtualNotif.classList.add('au-virtual-notification');

    // Prevent navigation on the virtual notification link by removing href
    const virtualLinks = virtualNotif.querySelectorAll('a');
    virtualLinks.forEach(link => {
      link.removeAttribute('href');
      link.style.cursor = 'pointer';
      link.style.textDecoration = 'none';
    });

    const textElement = virtualNotif.querySelector('.text') || virtualNotif;
    if (textElement) {
      // Generate smart text based on notification types
      const { find, replace } = this.generateGroupText(group);
      textElement.innerHTML = textElement.innerHTML.replace(find, replace);

      const timeEl = virtualNotif.querySelector('.time');
      if (timeEl && group.firstTime !== group.latestTime) {
        timeEl.textContent = `${group.latestTime} - ${group.firstTime}`;
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
      const clone = notif.cloneNode(true) as HTMLElement;
      clone.style.display = '';
      clone.style.opacity = '0.9';
      clone.classList.remove('au-hidden-notification');

      // Remove username from clone text (it's redundant since username is in virtual notif)
      const userLink = clone.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
      if (userLink) {
        userLink.remove();
      }

      // Prevent navigation on click - make notifications view-only
      clone.style.cursor = 'default';
      clone.querySelectorAll('a').forEach(link => {
        link.style.pointerEvents = 'none';
        link.style.cursor = 'default';
      });

      // Prevent any click events from propagating
      clone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      clones.push(clone);
      dropdownInner.appendChild(clone);
    });

    dropdownContainer.appendChild(dropdownInner);

    // Fetch and display activity details
    log.info(`[NotificationCleaner] 🚀 CALLING enhanceNotificationsWithActivityDetails with ${clones.length} clones`);
    this.enhanceNotificationsWithActivityDetails(clones, group.elements).catch(err => {
      log.error('[NotificationCleaner] ❌ FAILED to enhance notifications:', err);
    });

    // Insert virtual notification and dropdown
    firstNotif.parentNode?.insertBefore(virtualNotif, firstNotif);
    firstNotif.parentNode?.insertBefore(dropdownContainer, firstNotif);

    // Add click handler to toggle dropdown
    const countElement = virtualNotif.querySelector('.au-activity-count');
    if (countElement) {
      log.info(`[NotificationCleaner] ✅ Adding click listener to count element for ${group.count} activities`);
      countElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = dropdownContainer.style.display !== 'none';
        dropdownContainer.style.display = isVisible ? 'none' : 'block';
        log.info(`[NotificationCleaner] 🔄 Dropdown toggled: ${dropdownContainer.style.display === 'block' ? 'OPEN' : 'CLOSED'}`);
      }, true); // Use capture to catch event before it bubbles
    } else {
      log.error('[NotificationCleaner] ❌ Count element NOT FOUND! Cannot add click listener');
    }

    // Hide original notifications
    group.elements.forEach(notif => {
      notif.style.display = 'none';
      notif.classList.add('au-hidden-notification');
    });
  }

  /**
   * Process new notifications incrementally (without clearing existing groups)
   */
  private async processNewNotificationsIncremental(newNotifications: HTMLElement[]): Promise<void> {
    for (const notification of newNotifications) {
      const text = notification.textContent || '';
      const notifType = this.detectNotificationType(text);

      if (!notifType) {
        // Not groupable - just mark as processed
        notification.setAttribute('data-au-processed', 'true');
        continue;
      }

      const userLink = notification.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
      if (!userLink) continue;

      const username = userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';

      // Find existing virtual notification for this user
      const existingVirtual = this.findVirtualNotificationForUser(username);

      if (existingVirtual) {
        // Add to existing group
        log.info(`[NotificationCleaner] ➕ Adding to existing group for ${username}`);
        await this.addToExistingGroup(existingVirtual, notification, notifType);
      } else {
        // No existing group - just leave as single notification
        log.info(`[NotificationCleaner] ℹ️ No existing group for ${username} - leaving as single`);
      }

      notification.setAttribute('data-au-processed', 'true');
    }

    // Don't set isProcessing or resume observer here - handled by caller
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

      // Remove username from clone
      const userLink = clone.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
      if (userLink) userLink.remove();

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
      await this.enhanceNotificationsWithActivityDetails([clone], [notification]);
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
    const countSpan = `<span class="au-activity-count" data-group-id="${Date.now()}" style="cursor: pointer; text-decoration: underline;">${count}</span>`;

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
   * Extract activity ID from notification href
   */
  private extractActivityId(notification: HTMLElement): number | null {
    // Look for link with class "link" (AniList notification structure)
    const activityLink = notification.querySelector<HTMLAnchorElement>('a.link[href*="/activity/"]');
    if (activityLink) {
      const href = activityLink.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        log.info(`[NotificationCleaner] ✅ Extracted activity ID: ${id} from href: ${href}`);
        return id;
      }
    }

    // Fallback: try any activity link
    const anyLink = notification.querySelector<HTMLAnchorElement>('a[href*="/activity/"]');
    if (anyLink) {
      const href = anyLink.getAttribute('href') || '';
      const match = href.match(/\/activity\/(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        log.info(`[NotificationCleaner] ✅ Extracted activity ID (fallback): ${id}`);
        return id;
      }
    }

    log.warn('[NotificationCleaner] ❌ No activity link found in notification');
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
    `;

    const aliases = activityIds.map(id => `a${id}: Activity(id: ${id}) { ${fields} }`);
    const query = `query { ${aliases.join('\n')} }`;

    try {
      const response = await anilistClient.query<Record<string, ActivityData>>(query);
      const results = new Map<number, { text: string; mediaId?: number; mediaTitle?: string; status?: string }>();

      Object.entries(response).forEach(([alias, activity]) => {
        if (!activity) return;

        const id = parseInt(alias.replace('a', ''), 10);
        let text = 'your activity';
        let mediaId: number | undefined;
        let mediaTitle: string | undefined;
        let status: string | undefined;

        if (activity.media && activity.status) {
          const title = activity.media.title.english || activity.media.title.romaji;
          status = activity.status.replace(/_/g, ' ').toLowerCase();
          text = `${status} ${title}`;
          mediaId = activity.media.id;
          mediaTitle = title;
        } else if (activity.text) {
          text = activity.text.substring(0, 50) + (activity.text.length > 50 ? '...' : '');
        }

        results.set(id, { text, mediaId, mediaTitle, status });
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
  private async enhanceNotificationsWithActivityDetails(clones: HTMLElement[], originals: HTMLElement[]): Promise<void> {
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

    clones.forEach((clone, index) => {
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

      // Try multiple selectors to find the element containing "liked your activity"
      const possibleSelectors = ['.text', '.content', 'div', 'span'];
      let textElement: Element | null = null;

      for (const selector of possibleSelectors) {
        const elements = clone.querySelectorAll(selector);
        for (const el of Array.from(elements)) {
          if (el.innerHTML.includes('liked your activity')) {
            textElement = el;
            log.info(`[NotificationCleaner] ✅ Found text element using selector: ${selector}`);
            break;
          }
        }
        if (textElement) break;
      }

      if (!textElement) {
        log.error('[NotificationCleaner] ❌ No element containing "liked your activity" found!');
        log.error('[NotificationCleaner] 🔍 Clone HTML:', clone.innerHTML.substring(0, 500));
        return;
      }

      const originalHTML = textElement.innerHTML;
      log.info(`[NotificationCleaner] Original HTML: "${originalHTML.substring(0, 100)}"`);

      // Build the replacement HTML with proper links
      let detailsHTML: string;

      if (activityData.mediaId && activityData.mediaTitle && activityData.status) {
        // Has media - create link to media for title only
        const mediaType = originals[index].querySelector('[href*="/anime/"]') ? 'anime' : 'manga';
        const mediaUrl = `/${mediaType}/${activityData.mediaId}`;
        detailsHTML = `${activityData.status} <a href="${mediaUrl}" class="title">${activityData.mediaTitle}</a>`;
        log.info(`[NotificationCleaner] 🔗 Added media link: ${mediaUrl}`);
      } else {
        // Text activity or no media
        detailsHTML = activityData.text;
        log.info(`[NotificationCleaner] ℹ️ No media, using plain text`);
      }

      // More robust replacement - match "liked your activity" with or without punctuation
      const newHTML = originalHTML.replace(/liked your activity\.?/i, `liked your ${detailsHTML}`);

      if (newHTML !== originalHTML) {
        textElement.innerHTML = newHTML;

        // Re-enable the media link we just added (since all links in clone are disabled)
        if (activityData.mediaId) {
          const addedLink = textElement.querySelector<HTMLAnchorElement>('a.title');
          if (addedLink) {
            addedLink.style.pointerEvents = 'auto';
            addedLink.style.cursor = 'pointer';
            log.info(`[NotificationCleaner] ✅ Re-enabled media link`);
          }
        }

        // Make the entire clone clickable to open activity
        const originalNotif = originals[index];
        const activityLink = originalNotif.querySelector<HTMLAnchorElement>('a.link[href*="/activity/"]');
        if (activityLink) {
          const activityHref = activityLink.getAttribute('href');
          if (activityHref) {
            clone.style.cursor = 'pointer';
            clone.onclick = (e) => {
              // Don't navigate if clicking on the media link
              if ((e.target as HTMLElement).closest('a.title')) {
                return;
              }
              window.location.href = activityHref;
            };
            log.info(`[NotificationCleaner] 🔗 Added activity link to clone: ${activityHref}`);
          }
        }

        log.info(`[NotificationCleaner] ✅ REPLACED text for activity ${activityId}: "${activityData.text}"`);
      } else {
        log.error(`[NotificationCleaner] ❌ FAILED to replace - pattern not found in: "${originalHTML}"`);
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
      // Skip virtual and hidden notifications
      if (notification.classList.contains('au-virtual-notification') ||
          notification.classList.contains('au-hidden-notification')) {
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
