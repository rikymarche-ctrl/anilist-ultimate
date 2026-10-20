import { injectable, inject } from 'tsyringe';
import type { ActivityDetails, NotificationFetchService } from './NotificationFetchService';
import { TOKENS } from '@core/di/tokens';
import { html } from '@core/utils/Template';

function formatMediaActivityLabel(status: string): { label: string; titleSeparator: string } {
  if (!status.trim()) return { label: 'Activity', titleSeparator: ' ' };
  const match = status.trim().match(/^(watched|rewatched|read|reread)\s+(episode|chapter)(?:\s+(.+))?$/i);
  if (!match) return { label: status || 'Activity', titleSeparator: ' ' };

  const [, verb, item, rawProgress = ''] = match;
  const progress = rawProgress.trim().replace(/\s*[-–]\s*/g, '–');
  const isRange = /\d\s*[–-]\s*\d/.test(rawProgress);
  const noun = item.toLowerCase() === 'episode' ? 'episode' : 'chapter';
  const article = noun === 'episode' ? 'an' : 'a';
  const label = progress
    ? `${verb.toLowerCase()} ${noun}${isRange ? 's' : ''} ${progress}`
    : `${verb.toLowerCase()} ${article} ${noun}`;
  return { label, titleSeparator: ' of ' };
}

export interface NotificationGroup {
  user: string; types: Map<string, number>; count: number; elements: HTMLElement[];
  firstTime: string; latestTime: string;
  kind?: 'user' | 'site' | 'forum'; key?: string; subject?: string;
}
export interface NotificationGrouping { key: string; user: string; type: string; kind: 'user' | 'site' | 'forum'; subject?: string; }

@injectable()
export class NotificationGroupService {
  private originalWording = new WeakMap<HTMLElement, { original: string; enhanced: string }>();
  constructor(@inject(TOKENS.NotificationFetchService) public fetchService: NotificationFetchService) {}

  public removeActivityDetails(notification: HTMLElement): void {
    const wording = notification.querySelector<HTMLElement>('.details > div .link .context');
    const saved = wording && this.originalWording.get(wording);
    if (wording && saved) {
      if (wording.textContent === saved.enhanced) wording.textContent = saved.original;
      this.originalWording.delete(wording);
    }
    notification.querySelectorAll('.au-activity-context').forEach(context => context.remove());
  }

  public detectNotificationType(text: string): string {
    const value = text.toLowerCase();
    if (value.includes('was recently added to the site')) return 'site_added';
    if (value.includes('received site data changes')) return 'site_data';
    if (value.includes('was merged into')) return 'site_merged';
    if (value.includes('was removed from the site') || value.includes('was deleted from the site')) return 'site_removed';
    if (/\bepisode\s+\d+\s+of\b/.test(value) && /\baired\b/.test(value)) return 'site_airing';
    if (value.includes('submission') && /\b(?:accepted|rejected|updated)\b/.test(value)) {
      if (/\bstaff\b/.test(value)) return 'staff_submission_update';
      if (/\bcharacter\b/.test(value)) return 'character_submission_update';
      return 'media_submission_update';
    }
    if (value.includes('liked your activity reply')) return 'reply_like';
    if (value.includes('liked your forum comment') || value.includes('liked your comment, in the forum thread')) return 'forum_comment_like';
    if (value.includes('replied to your forum comment') || value.includes('replied to your comment, in the forum thread')) return 'forum_comment_reply';
    if (value.includes('mentioned you, in the forum thread') || value.includes('mentioned you in the forum thread')) return 'forum_comment_mention';
    if (value.includes('commented in your subscribed forum thread')
      || /commented in (?:a|the) forum thread (?:you(?:'re| are) subscribed to)/.test(value)) return 'thread_subscribed';
    if (value.includes('liked your activity') || value.includes('liked:')) return 'activity_like';
    if (value.includes('sent you a message')) return 'message';
    if (value.includes('liked your forum thread')) return 'thread_like';
    if (value.includes("replied to activity you're subscribed to") || value.includes('replied to an activity you are subscribed to')) return 'activity_subscribed_reply';
    if (value.includes('replied to your activity') || value.includes('replied to:')) return 'activity_reply';
    if (value.includes('replied to your forum thread')) return 'thread_reply';
    if (value.includes('mentioned you')) return 'mention';
    if (value.includes('followed you') || value.includes('started following you') || value.includes('follows you')) return 'follow';
    return 'other';
  }

  public groupingFor(notification: HTMLElement): NotificationGrouping | null {
    // Enriched text is content, not a notification type or a grouping instruction.
    const walker = document.createTreeWalker(notification, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest('.au-activity-context') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const text: string[] = []; let node: Node | null;
    while ((node = walker.nextNode())) text.push(node.textContent ?? '');
    const type = this.detectNotificationType(text.join(' ').replace(/\s+/g, ' '));
    if (type === 'other') return null;
    if (type.startsWith('site_') || type.endsWith('_submission_update')) return { key: type, type, user: '', kind: 'site' };
    if (type === 'forum_comment_like') {
      for (const link of notification.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        try {
          const url = new URL(link.getAttribute('href')!, 'https://anilist.co');
          if (url.origin !== 'https://anilist.co' || !/^\/forum\/thread\/\d+(?:\/comment\/\d+)?\/?$/.test(url.pathname)) continue;
          // A comment identity is required before combining likes from different users.
          if (!url.pathname.includes('/comment/') && !url.hash && !url.searchParams.has('comment')) continue;
          const subject = link.querySelector('.context')?.nextElementSibling?.textContent?.trim() || link.textContent?.trim();
          return { key: type + ':' + url.pathname + url.search + url.hash, type, user: '', kind: 'forum', subject };
        } catch { /* Ignore unrelated links. */ }
      }
    }
    const userLink = notification.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
    if (!userLink) return null;
    try {
      const url = new URL(userLink.getAttribute('href')!, 'https://anilist.co');
      const match = url.pathname.match(/^\/user\/([^/]+)\/?$/);
      if (url.origin !== 'https://anilist.co' || !match) return null;
      const user = decodeURIComponent(match[1]);
      return { key: 'user:' + user.toLowerCase(), type, user, kind: 'user' };
    } catch { return null; }
  }

  public generateGroupText(group: NotificationGroup): HTMLElement {
    const content = html`<span class="au-notification-text"></span>`;
    const count = html`<span class="au-activity-count">${group.count}</span>`;
    const types = [...group.types.keys()];
    const labels: Record<string, [string, string]> = {
      activity_like: ['liked ', ' of your activities'], reply_like: ['liked ', ' of your activity replies'],
      message: ['sent you ', ' messages'], thread_like: ['liked ', ' of your forum threads'],
      forum_comment_like: ['received ', ' likes on your forum comment'],
      forum_comment_reply: ['replied ', ' times to your forum comments'], thread_reply: ['replied ', ' times to your forum threads'],
      thread_subscribed: ['commented ', ' times in subscribed forum threads'],
      activity_reply: ['replied ', ' times to your activity'], activity_subscribed_reply: ['', ' replies to subscribed activities'],
      mention: ['mentioned you ', ' times'], forum_comment_mention: ['mentioned you ', ' times in forum comments'], follow: ['', ' follow notifications'],
      site_added: ['', ' titles were recently added to the site'], site_data: ['', ' site data updates'],
      site_merged: ['', ' media merge notices'], site_removed: ['', ' media removal notices'],
      site_airing: ['', ' episode releases'],
    };
    if (types.length === 1) {
      const type = types[0]; const label = labels[type] ?? ['', ' notifications'];
      // User summaries retain the actor before this fragment.
      if (type === 'forum_comment_like' && group.kind === 'forum') content.append('Your forum comment received ', count, ' likes');
      else if (type === 'forum_comment_like') content.append('liked ', count, ' of your forum comments');
      else if (type === 'forum_comment_mention') content.append('mentioned you in ', count, group.count === 1 ? ' forum comment' : ' forum comments');
      else if (type === 'thread_subscribed') content.append('commented in ', count, group.count === 1 ? ' subscribed forum thread' : ' subscribed forum threads');
      else if (type === 'media_submission_update' || type === 'staff_submission_update' || type === 'character_submission_update') {
        const subject = type === 'media_submission_update' ? 'media' : type === 'staff_submission_update' ? 'staff' : 'character';
        content.append(count, ` ${subject} submission update${group.count === 1 ? '' : 's'}`);
      }
      else if (type === 'message') {
        const total = group.types.get(type) ?? group.count;
        const privacy = this.messagePrivacyCounts(group, total);
        if (total > 0 && privacy.privateCount === total) content.append('sent you ', count, total === 1 ? ' private message' : ' private messages');
        else {
          content.append('sent you ', count, ' messages');
          if (privacy.privateCount) content.append(this.messagePrivacySuffix(privacy));
        }
      }
      else content.append(label[0], count, label[1]);
      if (group.kind === 'forum' && group.subject) content.append(' in “' + group.subject + '”');
    } else {
      const actions: Record<string, string> = { activity_like: 'activity like', reply_like: 'reply like',
        activity_reply: 'reply', activity_subscribed_reply: 'subscribed reply', message: 'message',
        thread_like: 'thread like', forum_comment_like: 'comment like', thread_reply: 'forum reply',
        forum_comment_reply: 'comment reply', forum_comment_mention: 'forum mention', thread_subscribed: 'subscribed forum comment',
        media_submission_update: 'media submission update', staff_submission_update: 'staff submission update',
        character_submission_update: 'character submission update', mention: 'mention', follow: 'follow' };
      const breakdown = [...group.types].map(([type, total]) => {
        const action = actions[type] ?? 'notification';
        if (type === 'message') {
          const privacy = this.messagePrivacyCounts(group, total);
          if (total > 0 && privacy.privateCount === total) return `${total} private message${total === 1 ? '' : 's'}`;
          return `${total} ${total === 1 ? 'message' : 'messages'}${privacy.privateCount ? this.messagePrivacySuffix(privacy) : ''}`;
        }
        return total + ' ' + (total === 1 ? action : action.endsWith('reply') ? action.slice(0, -1) + 'ies' : action + 's');
      });
      content.append(' · ', count, ' notifications: ', breakdown.join(', '));
    }
    return content;
  }

  private messagePrivacyCounts(group: NotificationGroup, total: number): { privateCount: number; knownCount: number; unknownCount: number } {
    let privateCount = 0; let knownCount = 0;
    for (const notification of group.elements) {
      if (this.groupingFor(notification)?.type !== 'message') continue;
      const context = notification.querySelector<HTMLElement>('.au-activity-context[data-message-private]');
      const id = this.fetchService.extractActivityId(notification);
      if (id === null || context?.dataset.activityId !== String(id)) continue;
      if (context.dataset.messagePrivate === 'true') privateCount++;
      if (context.dataset.messagePrivate === 'true' || context.dataset.messagePrivate === 'false') knownCount++;
    }
    return { privateCount, knownCount, unknownCount: Math.max(0, total - knownCount) };
  }

  private messagePrivacySuffix(privacy: { privateCount: number }): string {
    return ` (${privacy.privateCount} private)`;
  }

  public async enhanceNotificationsWithActivityDetails(notifications: HTMLElement[], _hidePrefix = false, isCurrent: () => boolean = () => true, onUpdated?: () => void): Promise<void> {
    const pending = notifications.filter(notification => !notification.querySelector('.au-activity-context'));
    const byActivity = new Map<number, HTMLElement[]>();
    for (const notification of pending) {
      const id = this.fetchService.extractActivityId(notification);
      if (id !== null) {
        const rows = byActivity.get(id) ?? []; rows.push(notification); byActivity.set(id, rows);
      }
    }
    if (!byActivity.size) return;
    const apply = (id: number, data: ActivityDetails) => {
      if (!isCurrent()) return;
      let changed = false;
      for (const notification of byActivity.get(id) ?? []) {
        // Vue may recycle a row while a previous ID is still being fetched.
        if (this.fetchService.extractActivityId(notification) === id && this.appendContext(notification, id, data)) changed = true;
      }
      if (changed) onUpdated?.();
    };
    const details = await this.fetchService.fetchActivityDetails([...byActivity.keys()], apply);
    // Final-map consumers remain supported; progressive values are idempotent.
    for (const [id, data] of details) apply(id, data);
  }

  private appendContext(notification: HTMLElement, id: number, data: ActivityDetails): boolean {
    if (notification.querySelector('.au-activity-context') || (!data.text && !data.mediaId && data.isPrivate === undefined)) return false;
    const context = document.createElement('span'); context.className = 'au-activity-context';
    if (data.isPrivate !== undefined) {
      context.dataset.activityId = String(id);
      context.dataset.messagePrivate = data.isPrivate === null ? 'unknown' : String(data.isPrivate);
      if (data.isPrivate) context.append('(private)');
      context.hidden = !data.text && data.isPrivate !== true;
    }
    const nativeWording = notification.querySelector<HTMLElement>('.details > div .link .context');
    if (nativeWording && data.text) {
      const wording = nativeWording.textContent?.trimEnd() ?? '';
      if (wording) {
        const enhanced = wording.replace(/[.!?:…]+$/u, '') + ':';
        this.originalWording.set(nativeWording, { original: nativeWording.textContent ?? '', enhanced });
        nativeWording.textContent = enhanced;
      }
    }
    const activity = document.createElement(notification.tagName === 'A' ? 'span' : 'a');
    if (activity instanceof HTMLAnchorElement) activity.href = '/activity/' + id;
    activity.className = 'au-activity-target';
    if (data.mediaId) {
      const formatted = formatMediaActivityLabel(data.status ?? '');
      activity.textContent = formatted.label;
      const media = document.createElement(notification.tagName === 'A' ? 'span' : 'a'); media.className = 'au-title';
      if (media instanceof HTMLAnchorElement) media.href = '/' + (data.mediaType === 'MANGA' ? 'manga' : 'anime') + '/' + data.mediaId;
      media.textContent = data.mediaTitle ?? '';
      context.append(activity, formatted.titleSeparator, media);
    } else if (data.text) {
      activity.textContent = '“' + data.text.slice(0, 120) + (data.text.length > 120 ? '…' : '') + '”';
      if (data.isPrivate) context.append(' ');
      context.append(activity);
    }
    // Preserve every native link, timestamp and Vue event handler.
    (notification.querySelector('.details') ?? notification.querySelector('.text, .content') ?? notification).append(context);
    return true;
  }
}
