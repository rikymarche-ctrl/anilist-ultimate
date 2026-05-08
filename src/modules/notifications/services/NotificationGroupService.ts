/**
 * @file NotificationGroupService.ts
 * @description Notification grouping logic, text generation, and DOM manipulation
 *
 * Groups consecutive notifications from the same user into a single
 * summary entry. Extracts activity details, generates human-readable
 * group descriptions, and modifies the notification DOM to collapse
 * grouped items.
 *
 * @see NotificationFetchService.ts for activity detail enrichment
 * @see NotificationCleanerModule.ts for the orchestration layer
 * @see docs/MODULES.md#2-notification-cleaner-module
 */

import { injectable, inject } from 'tsyringe';
import type { ActivityDetails, NotificationFetchService } from './NotificationFetchService';
import { TOKENS } from '@core/di/tokens';
import { html } from '@core/utils/Template';

export interface NotificationGroup {
  user: string;
  types: Map<string, number>; // notification type -> count
  count: number;
  elements: HTMLElement[];
  firstTime: string;
  latestTime: string;
}

@injectable()
export class NotificationGroupService {
  constructor(
    @inject(TOKENS.NotificationFetchService) public fetchService: NotificationFetchService
  ) { }

  /**
   * Detect notification type from text content
   */
  public detectNotificationType(text: string): string | null {
    if (text.includes('liked your activity') || text.includes('liked:')) return 'activity_like';
    if (text.includes('sent you a message')) return 'message';
    if (text.includes('liked your forum thread')) return 'thread_like';
    if (text.includes('liked your activity reply')) return 'reply_like';
    if (text.includes('liked your forum comment')) return 'forum_comment_like';
    if (text.includes('replied to your activity') || text.includes('replied to:')) return 'activity_reply';
    if (text.includes('replied to your forum thread')) return 'thread_reply';
    if (text.includes('replied to your forum comment')) return 'forum_comment_reply';
    if (text.includes('mentioned you')) return 'mention';
    if (text.includes('followed you')) return 'follow';
    return 'other'; 
  }

  /**
   * Generate smart notification text based on types
   */
  public generateGroupText(group: NotificationGroup): HTMLElement {
    const types = Array.from(group.types.keys());
    const isSingleType = types.length === 1;
    const count = group.count;
    const countSpan = html`<span class="au-activity-count" style="cursor: pointer; font-weight: 700;">${count}</span>`;

    const content = html`<span class="au-notification-text"></span>`;

    if (isSingleType) {
      const type = types[0];
      switch (type) {
        case 'activity_like':
          content.append('liked ', countSpan, ' of your activities');
          break;
        case 'message':
          content.append('sent you ', countSpan, ' messages');
          break;
        case 'thread_like':
          content.append('liked ', countSpan, ' of your forum threads');
          break;
        case 'activity_reply':
          content.append('replied ', countSpan, ' times to your activity');
          break;
        case 'follow':
          content.append('and ', countSpan, ' others followed you');
          break;
        case 'watched':
          content.append('watched ', countSpan, ' episodes');
          break;
        case 'read':
          content.append('read ', countSpan, ' chapters');
          break;
        default:
          content.append('interacted ', countSpan, ' times');
          break;
      }
    } else {
      // Mixed types: check if mostly likes
      const likeCount = (group.types.get('activity_like') || 0) + (group.types.get('reply_like') || 0);
      if (likeCount > (count / 2)) {
          content.append('liked and interacted ', countSpan, ' times');
      } else {
          content.append('interacted with you ', countSpan, ' times');
      }
    }
    return content;
  }

  /**
   * Enhance notifications with activity details
   */
  public async enhanceNotificationsWithActivityDetails(clones: HTMLElement[], hidePrefix: boolean = false): Promise<void> {
    const activityIds = clones
      .map(clone => this.fetchService.extractActivityId(clone))
      .filter((id): id is number => id !== null);

    if (activityIds.length === 0) return;

    const activityDetails = await this.fetchService.fetchActivityDetails(activityIds);

    clones.forEach((clone) => {
      const activityId = this.fetchService.extractActivityId(clone);
      if (!activityId) return;

      const activityData = activityDetails.get(activityId);
      if (!activityData) return;

      this.applyDetailsToClone(clone, activityData, hidePrefix);
    });
  }

  private applyDetailsToClone(clone: HTMLElement, activityData: ActivityDetails, hidePrefix: boolean = false): void {
    const possibleSelectors = ['.details', '.text', '.content'];
    let textElement: HTMLElement | null = null;

    for (const selector of possibleSelectors) {
      const elements = clone.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        if (el.textContent?.trim().length) {
          textElement = el as HTMLElement;
          break;
        }
      }
      if (textElement) break;
    }

    if (!textElement) textElement = clone;

    const originalText = textElement.textContent || '';
    let newContent: HTMLElement | null = null;

    // Handle Media Activity (Airing/Watched/Read)
    if (activityData.mediaId) {
      const mediaUrl = `/anime/${activityData.mediaId}`;
      const action = activityData.status?.replace(/_/g, ' ').toLowerCase() || 'watched';
      const isLike = originalText.toLowerCase().includes('liked');

      newContent = html`
        <span class="au-notification-content">
          ${isLike ? 'liked: ' : ''}${action} 
          <a href="${mediaUrl}" class="title au-title" style="pointer-events: auto; cursor: pointer;">${activityData.mediaTitle || ''}</a>
        </span>
      `;
    }
    // Handle Text/Message/Reply Activity
    else if (activityData.text) {
      const isReply = originalText.toLowerCase().includes('replied');
      const isMessage = originalText.toLowerCase().includes('message');
      const isLike = originalText.toLowerCase().includes('liked');

      // Extract reply text from DOM if possible
      let replyText = '';
      const parts = originalText.split(':');
      if (parts.length > 1) {
        replyText = parts[parts.length - 1].trim().replace(/^["']|["']$/g, '');
      }

      const contentTruncated = activityData.text.substring(0, 30) + (activityData.text.length > 30 ? '...' : '');

      if (isReply && replyText) {
        const replyTruncated = replyText.substring(0, 40) + (replyText.length > 40 ? '...' : '');
        newContent = html`
          <span class="au-notification-content">
            replied to <i>"${contentTruncated}"</i> with <b>"${replyTruncated}"</b>
          </span>
        `;
      } else if (isReply) {
        newContent = html`
          <span class="au-notification-content">
            replied to <i>"${contentTruncated}"</i>
          </span>
        `;
      } else {
        const label = isMessage ? 'sent: ' : (isLike ? 'liked: ' : 'wrote: ');
        newContent = html`
          <span class="au-notification-content">
            ${hidePrefix ? '' : label}<i>"${contentTruncated}"</i>
          </span>
        `;
      }
    }

    // Apply changes if we have a new format
    if (newContent) {
      const timeEl = textElement.querySelector('.time');
      textElement.innerHTML = ''; // Clear but we will restore time if needed
      if (timeEl) textElement.appendChild(timeEl);
      textElement.appendChild(newContent);
    }
  }

  public stripUsername(notification: Element, username: string): void {
    const textContainers = notification.querySelectorAll('.details, .text, .content');
    if (textContainers.length === 0) return;

    const walkDOM = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const idx = text.toLowerCase().indexOf(username.toLowerCase());
        if (idx !== -1) {
          node.textContent = text.substring(0, idx) + text.substring(idx + username.length);
          return true;
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

  public injectUserLink(notification: Element, username: string): void {
    const textContainers = notification.querySelectorAll('.details, .text, .content');
    if (textContainers.length === 0) return;

    const walkDOM = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const idx = text.toLowerCase().indexOf(username.toLowerCase());
        if (idx !== -1) {
          let parent = node.parentNode;
          while (parent) {
            if (parent.nodeName.toLowerCase() === 'a') return false;
            parent = parent.parentNode;
          }
          const a = document.createElement('a');
          a.href = `/user/${username}`;
          a.className = 'name au-user-link';
          a.style.pointerEvents = 'auto';
          a.textContent = text.substring(idx, idx + username.length);
          const before = document.createTextNode(text.substring(0, idx));
          const after = document.createTextNode(text.substring(idx + username.length));
          if (node.parentNode) {
            node.parentNode.insertBefore(before, node);
            node.parentNode.insertBefore(a, node);
            node.parentNode.insertBefore(after, node);
            node.parentNode.removeChild(node);
            return true;
          }
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

  public findVirtualNotificationForUser(username: string): HTMLElement | null {
    const virtualNotifs = document.querySelectorAll<HTMLElement>('.au-virtual-notification');
    for (const vn of Array.from(virtualNotifs)) {
      const userLink = vn.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
      if (userLink) {
        const vnUsername = userLink.getAttribute('href')?.replace('/user/', '').replace(/\/$/, '') || '';
        if (vnUsername === username) return vn;
      }
    }
    return null;
  }
}
