/**
 * Notification Cleaner Module - Anti-spam for notifications
 * Groups duplicate activity likes from the same user
 */

import { log } from '@core/logger';
import { storage } from '@core/storage/StorageManager';
import { BaseModule } from '@core/modules/BaseModule';
import '../../styles/notification-cleaner.css';

interface NotificationGroup {
  user: string;
  type: string;
  count: number;
  elements: HTMLElement[];
  firstTime: string;
  latestTime: string;
}

export class NotificationCleanerModule extends BaseModule {
  private enabled: boolean = false;
  private toggleButton: HTMLElement | null = null;
  private isProcessing = false;
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

    const container = document.querySelector('.notifications');
    if (container && this.enabled) {
      this.processNotifications();
    }
  }

  private injectSettingsUI(markAllButton: HTMLElement): void {
    if (document.querySelector('.au-compress-button')) return;

    const compressButton = document.createElement('div');
    compressButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
    compressButton.textContent = this.enabled ? 'Decompress Activity by User' : 'Compress Activity by User';
    
    compressButton.addEventListener('click', () => this.toggleGrouping());

    markAllButton.parentElement?.insertBefore(compressButton, markAllButton);
    this.toggleButton = compressButton;
  }

  private async toggleGrouping(): Promise<void> {
    this.enabled = !this.enabled;
    await storage.set('clutterfree_group_likes', this.enabled);

    if (this.toggleButton) {
      this.toggleButton.className = `au-compress-button ${this.enabled ? 'compressed' : ''}`;
      this.toggleButton.textContent = this.enabled ? 'Decompress Activity by User' : 'Compress Activity by User';
    }

    if (this.enabled) {
      this.processNotifications();
    } else {
      this.suspendObserver(this.OBSERVER_NAME);
      this.clearVirtualNotifications();
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private processNotifications(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // SUSPEND observer before making domestic changes to prevent loop (stuttering)
      this.suspendObserver(this.OBSERVER_NAME);

      this.clearVirtualNotifications();

      const notifications = Array.from(document.querySelectorAll<HTMLElement>('.notification:not(.au-virtual-notification)'));
      if (notifications.length === 0) return;

      let currentGroup: NotificationGroup | null = null;
      const groupsToProcess: NotificationGroup[] = [];

      notifications.forEach((notification) => {
        const text = notification.textContent || '';
        if (!text.includes('liked your activity')) {
          if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);
          currentGroup = null;
          return;
        }

        const userLink = notification.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
        if (!userLink) return;

        const username = userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';
        const time = notification.querySelector('.time')?.textContent?.trim() || '';

        if (currentGroup && currentGroup.user === username) {
          currentGroup.count++;
          currentGroup.elements.push(notification);
          currentGroup.latestTime = time;
        } else {
          if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);
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

      if (currentGroup && (currentGroup as NotificationGroup).count > 1) groupsToProcess.push(currentGroup);

      groupsToProcess.forEach(group => this.groupNotifications(group));
    } finally {
      this.isProcessing = false;
      // RESUME observer after changes are complete
      this.resumeObserver(this.OBSERVER_NAME);
    }
  }

  private groupNotifications(group: NotificationGroup): void {
    const firstNotif = group.elements[0];
    const virtualNotif = firstNotif.cloneNode(true) as HTMLElement;
    virtualNotif.classList.add('au-virtual-notification');

    const textElement = virtualNotif.querySelector('.text') || virtualNotif;
    if (textElement) {
      textElement.innerHTML = textElement.innerHTML.replace('liked your activity', `liked <b>${group.count}</b> of your activities`);
      const timeEl = virtualNotif.querySelector('.time');
      if (timeEl && group.firstTime !== group.latestTime) {
        timeEl.textContent = `${group.latestTime} - ${group.firstTime}`;
      }
    }

    firstNotif.parentNode?.insertBefore(virtualNotif, firstNotif);
    group.elements.forEach(notif => {
      notif.style.display = 'none';
      notif.classList.add('au-hidden-notification');
    });
  }

  private clearVirtualNotifications(): void {
    document.querySelectorAll('.au-virtual-notification').forEach(n => n.remove());
    document.querySelectorAll<HTMLElement>('.au-hidden-notification').forEach(n => {
      n.style.display = '';
      n.classList.remove('au-hidden-notification');
    });
  }

  public destroy(): void {
    super.destroy();
    this.fullReset();
  }
}
