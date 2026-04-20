/**
 * Notification Cleaner Module - Anti-spam for notifications
 * Groups duplicate activity likes from the same user
 * Only active on https://anilist.co/notifications
 */

import { log } from '@core/logger';
import { storage } from '@core/storage/StorageManager';

const NOTIFICATION_CLEANER_CSS = `
/* Compress/Decompress button */
.au-compress-button {
  width: 100%;
  padding: 10px;
  margin-bottom: 10px;
  background: rgb(var(--color-blue));
  color: rgb(var(--color-text-bright));
  border: 2px solid transparent;
  border-radius: 3px;
  font-size: 1.3rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}
.au-compress-button:hover {
  background: rgb(var(--color-blue-dim));
}
.au-compress-button.compressed {
  background: transparent;
  border: 2px solid rgb(var(--color-blue));
  color: rgb(var(--color-blue));
}
.au-compress-button.compressed:hover {
  background: rgba(var(--color-blue), 0.1);
}
/* Virtual grouped notification (clone) */
.au-virtual-notification {
  border-left: 3px solid #3db4f2 !important;
  padding-left: 12px !important;
}
/* Hidden original notifications */
.au-hidden-notification {
  display: none !important;
}
`;

interface NotificationGroup {
  user: string;
  type: string;
  count: number;
  elements: HTMLElement[];
  firstTime: string; // First interaction time
  latestTime: string; // Last interaction time
}

export class NotificationCleanerModule {
  private enabled: boolean = false;
  private toggleButton: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private cssLoaded = false;
  private isProcessing = false; // Prevent concurrent processing

  public async init(): Promise<void> {
    log.info('NotificationCleaner: Initializing...');

    // Inject CSS (always, it's small and harmless)
    this.injectCSS();

    // Load saved preference
    this.enabled = (await storage.get<boolean>('clutterfree_group_likes')) ?? false;

    // Start URL observer immediately (works even if we're not on notifications page yet)
    this.startGlobalURLObserver();

    // If we're already on notifications page, initialize now
    if (window.location.pathname.includes('/notifications')) {
      log.debug('Already on notifications page, initializing immediately');
      this.waitForNotifications();
    } else {
      log.debug('Not on notifications page yet, waiting for navigation');
    }
  }

  private injectCSS(): void {
    if (this.cssLoaded) return;
    if (document.getElementById('au-notification-cleaner-css')) return;

    const style = document.createElement('style');
    style.id = 'au-notification-cleaner-css';
    style.textContent = NOTIFICATION_CLEANER_CSS;
    document.head.appendChild(style);

    this.cssLoaded = true;
    log.debug('Notification Cleaner CSS injected');
  }

  private waitForNotifications(): void {
    const checkInterval = setInterval(() => {
      const notifications = document.querySelector('.notifications');
      // Look for the "Mark all as read" element (it's a div, not a button!)
      const markAllButton = document.querySelector('.reset-btn');

      if (notifications && markAllButton) {
        clearInterval(checkInterval);
        log.info('✓ Page ready, injecting UI');
        this.injectSettingsUI();
        this.attachFilterListeners();
        this.startObserving();
        this.startURLObserver();

        // Process existing notifications if enabled
        if (this.enabled) {
          this.processNotifications();
        }
      }
    }, 500);

    // Give up after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      log.warn('Timed out waiting for notifications page elements');
    }, 10000);
  }

  /**
   * Attach click listeners to filter links
   */
  private attachFilterListeners(): void {
    // Find all filter links in the sidebar navigation
    const nav = document.querySelector('.nav');
    if (!nav) {
      log.warn('Nav not found for filter listeners');
      return;
    }

    // Find all links that could be filters (All, Airing, Activity, Forum, etc.)
    const filterLinks = nav.querySelectorAll('a[href*="/notifications"]');

    filterLinks.forEach((link) => {
      link.addEventListener('click', () => {
        log.debug(`Filter clicked: ${link.textContent?.trim()}`);

        // Wait for new notifications to load
        setTimeout(() => {
          // Only process if enabled
          if (this.enabled) {
            log.info(`Filter changed, re-processing notifications`);
            this.processNotifications();
          } else {
            log.debug('Filter changed but grouping is disabled, skipping processing');
          }
        }, 600);
      });
    });

    log.info(`Attached listeners to ${filterLinks.length} filter links`);
  }

  /**
   * Global URL observer - watches for navigation to/from notifications page
   * This runs even if we didn't start on the notifications page
   */
  private startGlobalURLObserver(): void {
    let lastPath = window.location.pathname;
    let hasInitialized = false;

    setInterval(() => {
      const currentPath = window.location.pathname;
      const isOnNotificationsPage = currentPath.includes('/notifications');

      // Path changed
      if (currentPath !== lastPath) {
        // Just arrived on notifications page
        if (isOnNotificationsPage && !lastPath.includes('/notifications')) {
          log.info('📍 Navigated to notifications page');

          // First time arriving - need to initialize
          if (!hasInitialized) {
            hasInitialized = true;
            this.waitForNotifications();
          } else {
            // Returning after being on another page - check if button needs re-injection
            setTimeout(() => {
              const buttonExists = document.querySelector('.au-compress-button');
              const resetBtn = document.querySelector('.reset-btn');

              if (!buttonExists && resetBtn) {
                log.info('Button missing after navigation, re-injecting');
                this.injectSettingsUI();

                if (this.enabled) {
                  this.processNotifications();
                }
              }
            }, 500);
          }
        }

        lastPath = currentPath;
      }
    }, 500);

    log.debug('Global URL observer started');
  }

  /**
   * Local URL observer - re-injects button if missing (for settings page navigation)
   */
  private startURLObserver(): void {
    // This is now handled by startGlobalURLObserver
    log.debug('Local URL observer (handled by global observer)');
  }

  private injectSettingsUI(): void {
    // Find "Mark all as read" element (it's a div with class reset-btn)
    const markAllButton = document.querySelector('.reset-btn');

    if (!markAllButton || !markAllButton.parentElement) {
      log.warn('.reset-btn element not found or has no parent');
      return;
    }

    // Check if already injected
    if (document.querySelector('.au-compress-button')) {
      log.debug('Compress button already exists');
      return;
    }

    // Create compress/decompress button (as a div to match AniList's style)
    const compressButton = document.createElement('div');
    compressButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
    compressButton.textContent = this.enabled ? 'Decompress Activity by User' : 'Compress Activity by User';

    log.info(`Creating compress button with enabled=${this.enabled}`);

    // Insert before "Mark all as read" in the same parent
    markAllButton.parentElement.insertBefore(compressButton, markAllButton);

    // Add click handler
    this.toggleButton = compressButton;
    this.toggleButton.addEventListener('click', () => this.toggleGrouping());

    log.info('✓ Compress button injected successfully in filter-group');
  }

  private async toggleGrouping(): Promise<void> {
    this.enabled = !this.enabled;

    // Save preference
    await storage.set('clutterfree_group_likes', this.enabled);

    // Update button
    if (this.toggleButton) {
      this.toggleButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
      this.toggleButton.textContent = this.enabled ? 'Decompress Activity by User' : 'Compress Activity by User';
    }

    log.info(`Grouping ${this.enabled ? 'enabled' : 'disabled'}`);

    // CRITICAL: Disconnect observer during manual toggle to prevent infinite loops
    this.observer?.disconnect();

    try {
      // Apply or remove grouping without reloading
      if (this.enabled) {
        this.processNotifications();
      } else {
        this.ungroupNotifications();
      }
    } finally {
      // CRITICAL: Reconnect observer after manual operation is complete
      // Add a small delay to ensure DOM is stable
      setTimeout(() => {
        this.startObserving();
        log.debug('Observer reconnected after toggle');
      }, 100);
    }
  }

  /**
   * Clear all virtual notifications and show original ones
   * This resets the page to its original state
   */
  private clearVirtualNotifications(): void {
    const virtualNotifications = document.querySelectorAll('.au-virtual-notification');
    const hiddenNotifications = document.querySelectorAll<HTMLElement>('.au-hidden-notification');

    log.debug(`Clearing ${virtualNotifications.length} virtual notifications, showing ${hiddenNotifications.length} hidden originals`);

    // Remove all virtual (cloned) notifications
    virtualNotifications.forEach((vn) => vn.remove());

    // Show all hidden original notifications
    hiddenNotifications.forEach((notif) => {
      notif.style.display = '';
      notif.classList.remove('au-hidden-notification');
    });
  }

  /**
   * Remove all grouping and restore original state (user-triggered)
   */
  private ungroupNotifications(): void {
    log.info('Ungrouping notifications - removing all virtual notifications');

    const virtualCount = document.querySelectorAll('.au-virtual-notification').length;
    const hiddenCount = document.querySelectorAll('.au-hidden-notification').length;

    this.clearVirtualNotifications();

    log.info(`Cleanup complete - removed ${virtualCount} virtual notifications, showed ${hiddenCount} originals`);
  }

  private startObserving(): void {
    const notificationsContainer = document.querySelector('.notifications');
    if (!notificationsContainer) return;

    // Disconnect existing observer if any
    this.observer?.disconnect();

    // Use a simple polling approach - check every 2 seconds if we need to group
    setInterval(() => {
      // Only check if enabled and not currently processing
      if (this.enabled && !this.isProcessing) {
        // Check if there are ungrouped activity likes
        const originalNotifications = document.querySelectorAll('.notification:not(.au-virtual-notification)');
        const activityLikes = Array.from(originalNotifications).filter(n =>
          n.textContent?.includes('liked your activity')
        );

        // Check if we have virtual notifications already
        const virtualNotifications = document.querySelectorAll('.au-virtual-notification');

        // If we have activity likes but no virtual notifications, we need to group
        if (activityLikes.length > 1 && virtualNotifications.length === 0) {
          log.info(`Auto-check: Found ${activityLikes.length} ungrouped activity likes, processing`);
          this.processNotifications();
        }
      }
    }, 2000);

    // Also keep a basic MutationObserver for immediate detection
    this.observer = new MutationObserver(() => {
      if (!this.isProcessing && this.enabled) {
        const originalNotifications = document.querySelectorAll('.notification:not(.au-virtual-notification)');
        const activityLikes = Array.from(originalNotifications).filter(n =>
          n.textContent?.includes('liked your activity')
        );
        const virtualNotifications = document.querySelectorAll('.au-virtual-notification');

        if (activityLikes.length > 1 && virtualNotifications.length === 0) {
          log.debug('MutationObserver: Ungrouped activity likes detected');
          // Delay slightly to let DOM stabilize
          setTimeout(() => {
            if (!this.isProcessing) {
              this.processNotifications();
            }
          }, 300);
        }
      }
    });

    this.observer.observe(notificationsContainer, {
      childList: true,
      subtree: true,
    });

    log.info('Auto-grouping enabled: polling every 2s + MutationObserver');
  }

  private processNotifications(): void {
    // Prevent concurrent processing
    if (this.isProcessing) {
      log.warn('Already processing notifications, skipping');
      return;
    }

    this.isProcessing = true;
    log.info('🔄 Processing notifications - resetting state');

    try {
      // ALWAYS clear virtual notifications first to start fresh
      this.clearVirtualNotifications();

      // Get all original notifications (excluding any remaining virtual ones)
      const notifications = Array.from(
        document.querySelectorAll<HTMLElement>('.notification:not(.au-virtual-notification)')
      );

      if (notifications.length === 0) {
        log.debug('No notifications found');
        return;
      }

      log.info(`Found ${notifications.length} original notifications to process`);

      // Group consecutive notifications only
      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];

    notifications.forEach((notification) => {
      const text = notification.textContent || '';
      log.debug('Processing notification:', text.substring(0, 50));

      // Only group "liked your activity" notifications (singular)
      if (!text.includes('liked your activity')) {
        log.debug('Not a groupable notification, ending current group if exists');
        // End current group if it exists
        if (currentGroup && currentGroup.count > 1) {
          groupsToProcess.push(currentGroup);
          log.debug(`Saved group for ${currentGroup.user} with ${currentGroup.count} items`);
        }
        currentGroup = null;
        return;
      }

      // Extract username
      const userLink = notification.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
      if (!userLink) {
        log.debug('No user link found');
        if (currentGroup && currentGroup.count > 1) {
          groupsToProcess.push(currentGroup);
        }
        currentGroup = null;
        return;
      }

      // Extract username from href instead of textContent (more reliable)
      const href = userLink.getAttribute('href');
      const username = href ? href.replace('/user/', '').replace(/\/$/, '') : '';

      // Time is in a separate element, try multiple selectors
      let time = '';
      const timeEl = notification.querySelector('.time');
      if (timeEl) {
        time = timeEl.textContent?.trim() || '';
      } else {
        // Fallback: try to extract from the end of the notification text
        const matches = text.match(/(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)$/);
        if (matches) {
          time = matches[1];
        }
      }

      log.debug(`User: ${username}, Time: ${time}, Href: ${href}`);

      // Check if this notification belongs to the current group
      // Only group if same user and same type (NO timestamp check - group ALL consecutive)
      if (currentGroup && currentGroup.user === username && currentGroup.type === 'activity_like') {
        // Add to current group (consecutive notifications from same user)
        log.debug(`Adding to existing group for ${username}, count now ${currentGroup.count + 1}`);
        currentGroup.count++;
        currentGroup.elements.push(notification);
        currentGroup.latestTime = time; // Keep updating to get the range
      } else {
        // Save previous group if it has multiple items
        if (currentGroup && currentGroup.count > 1) {
          log.debug(`Saving group for ${currentGroup.user} with ${currentGroup.count} items`);
          groupsToProcess.push(currentGroup);
        }

        // Start a new group
        log.debug(`Starting new group for ${username}`);
        currentGroup = {
          user: username,
          type: 'activity_like',
          count: 1,
          elements: [notification],
          firstTime: time,
          latestTime: time,
        };
      }
    });

    // Don't forget the last group
    if (currentGroup) {
      const lastGroup: NotificationGroup = currentGroup;
      if (lastGroup.count > 1) {
        groupsToProcess.push(lastGroup);
      }
    }

      // Apply grouping
      log.info(`Applying grouping to ${groupsToProcess.length} groups`);
      groupsToProcess.forEach((group) => {
        this.groupNotifications(group);
      });

      log.info(`✅ Processing complete - created ${groupsToProcess.length} grouped notifications`);
    } finally {
      // Always reset processing flag after a small delay to avoid rapid re-triggers
      setTimeout(() => {
        this.isProcessing = false;
        log.debug('isProcessing flag reset');
      }, 100);
    }
  }

  private groupNotifications(group: NotificationGroup): void {
    const firstNotif = group.elements[0];

    // Clone the first notification to create a virtual grouped notification
    const virtualNotif = firstNotif.cloneNode(true) as HTMLElement;
    virtualNotif.classList.add('au-virtual-notification');
    virtualNotif.classList.add('notification'); // Keep original class

    // Find the text element in the clone
    const textElement = this.findTextElement(virtualNotif);

    if (!textElement || !textElement.textContent) {
      log.warn(`Could not find text element for ${group.user}`);
      return;
    }

    // Replace "liked your activity" with "liked X of your activities"
    let newText = textElement.textContent.replace(
      'liked your activity',
      `liked ${group.count} of your activities`
    );

    // If we have a time range, append it
    if (group.count > 1 && group.firstTime && group.latestTime && group.firstTime !== group.latestTime) {
      // Remove old timestamp from text if present
      newText = newText.replace(/\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago$/i, '').trim();
      // Add range: most recent to oldest
      newText += ` (${group.latestTime} - ${group.firstTime})`;
      log.debug(`Added time range: ${group.latestTime} - ${group.firstTime}`);
    }

    textElement.textContent = newText;
    log.debug(`Virtual notification text: "${newText.substring(0, 60)}..."`);

    // Insert the virtual notification BEFORE the first original notification
    firstNotif.parentNode?.insertBefore(virtualNotif, firstNotif);

    // Hide ALL original notifications in the group (including the first one)
    group.elements.forEach((notif) => {
      notif.style.display = 'none';
      notif.classList.add('au-hidden-notification');
    });

    log.info(`✓ Grouped ${group.count} notifications from ${group.user}`);
  }

  /**
   * Find the text element in a notification
   * Works for both original ("liked your activity") and grouped ("liked X of your activities") text
   */
  private findTextElement(notification: HTMLElement): Element | null {
    // Try the .text selector first
    let textElement = notification.querySelector('.text');
    if (textElement) return textElement;

    // Try finding any element that contains "liked your activity" (singular) OR "of your activities" (plural)
    const allElements = notification.querySelectorAll('*');
    for (const el of Array.from(allElements)) {
      const text = el.textContent || '';
      if (text.includes('liked your activity') || text.includes('of your activities')) {
        return el;
      }
    }

    return null;
  }

  public destroy(): void {
    this.observer?.disconnect();
    this.clearVirtualNotifications();
  }
}
