import { injectable, inject } from 'tsyringe';
import type { ActivityDetails, NotificationFetchService } from './NotificationFetchService';
import { TOKENS } from '@core/di/tokens';

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
    @inject(TOKENS.NotificationFetchService) private fetchService: NotificationFetchService
  ) {}

  /**
   * Detect notification type from text content
   */
  public detectNotificationType(text: string): string | null {
    if (text.includes('liked your activity')) return 'activity_like';
    if (text.includes('sent you a message')) return 'message';
    if (text.includes('liked your forum thread')) return 'thread_like';
    if (text.includes('liked your activity reply')) return 'reply_like';
    if (text.includes('liked your forum comment')) return 'forum_comment_like';
    if (text.includes('replied to your activity')) return 'activity_reply';
    if (text.includes('replied to your forum thread')) return 'thread_reply';
    if (text.includes('replied to your forum comment')) return 'forum_comment_reply';
    if (text.includes('mentioned you')) return 'mention';
    if (text.includes('followed you')) return 'follow';
    return null; // Not groupable
  }

  /**
   * Generate smart notification text based on types
   */
  public generateGroupText(group: NotificationGroup): { find: string; replace: string } {
    const types = Array.from(group.types.keys());
    const isSingleType = types.length === 1;
    const count = group.count;
    const countSpan = `<span class="au-activity-count" style="cursor: pointer;">${count}</span>`;

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
      const firstNotifText = group.elements[0].textContent || '';
      let findPattern = 'liked your activity';
      if (firstNotifText.includes('sent you a message')) findPattern = 'sent you a message';
      else if (firstNotifText.includes('liked your forum thread')) findPattern = 'liked your forum thread';

      return { find: findPattern, replace: `interacted with you <b>${countSpan}</b> times` };
    }
  }

  /**
   * Enhance notifications with activity details
   */
  public async enhanceNotificationsWithActivityDetails(clones: HTMLElement[]): Promise<void> {
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

      this.applyDetailsToClone(clone, activityData);
    });
  }

  private applyDetailsToClone(clone: HTMLElement, activityData: ActivityDetails): void {
    const possibleSelectors = ['.details', '.text', '.content'];
    let textElement: Element | null = null;

    for (const selector of possibleSelectors) {
      const elements = clone.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        if (el.textContent?.trim().length) {
          textElement = el;
          break;
        }
      }
      if (textElement) break;
    }

    if (!textElement) textElement = clone;

    const originalHTML = textElement.innerHTML;
    let newHTML = originalHTML;

    if (activityData.mediaId) {
      const patterns = [
        new RegExp(`liked your activity\\.?`, 'i'),
        new RegExp(`liked your activity\\s*`, 'i'),
        new RegExp(`liked your\\s+`, 'i')
      ];

      for (const pattern of patterns) {
        if (pattern.test(originalHTML)) {
          // Format as link
          const mediaLink = `<a href="/anime/${activityData.mediaId}" class="title au-title">${activityData.mediaTitle}</a>`;
          newHTML = originalHTML.replace(pattern, `liked: ${activityData.status?.replace(/_/g, ' ').toLowerCase()} ${mediaLink}`);
          break;
        }
      }
    } else if (activityData.text) {
      const isLike = originalHTML.toLowerCase().includes('liked');
      const isReply = originalHTML.toLowerCase().includes('replied');
      const isMessage = originalHTML.toLowerCase().includes('message');

      // Extract existing reply text if present (AniList often puts it after a colon)
      let replyText = '';
      const parts = textElement.textContent?.split(':');
      if (parts && parts.length > 1) {
        replyText = parts[parts.length - 1].trim().replace(/^["']|["']$/g, '');
      }

      const originalTruncated = activityData.text.substring(0, 30) + (activityData.text.length > 30 ? '...' : '');
      
      if (isReply && replyText) {
        const replyTruncated = replyText.substring(0, 40) + (replyText.length > 40 ? '...' : '');
        newHTML = `replied to <i>"${originalTruncated}"</i> with <b>"${replyTruncated}"</b>`;
      } else if (isLike) {
        newHTML = `liked: <i>"${originalTruncated}"</i>`;
      } else if (isMessage) {
        newHTML = `sent: <i>"${originalTruncated}"</i>`;
      } else {
        newHTML = `wrote: <i>"${originalTruncated}"</i>`;
      }
    }

    if (newHTML !== originalHTML) {
      textElement.innerHTML = newHTML;
      // Re-enable added links
      textElement.querySelectorAll('a').forEach(link => {
        link.style.pointerEvents = 'auto';
        link.style.cursor = 'pointer';
      });
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
      if (userLink && userLink.textContent?.trim() === username) return vn;
    }
    return null;
  }
}
