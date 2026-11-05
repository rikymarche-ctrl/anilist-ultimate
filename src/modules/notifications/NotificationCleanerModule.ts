import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { NotificationFetchService } from './services/NotificationFetchService';
import {
  NotificationGroupService,
  type NotificationGroup,
} from './services/NotificationGroupService';
import { NotificationFilterService } from './services/NotificationFilterService';
import { planRowMerges, type MergeRow } from './services/NotificationRowMerge';
import '../../styles/notification-cleaner.css';

/** "54 minutes ago – 1 hour ago" reads as "54 minutes – 1 hour ago": the shared suffix is kept once. */
export function notificationTimeRange(first: string, last: string): string {
  if (first === last) return first;
  const suffix = ' ago';
  const head =
    first.endsWith(suffix) && last.endsWith(suffix) ? first.slice(0, -suffix.length) : first;
  return head + ' – ' + last;
}

@injectable()
export class NotificationCleanerModule extends BaseModule {
  private readonly OBSERVER_NAME = 'notifications-continuous';
  private enabled = false;
  private isProcessing = false;
  private needsReprocess = false;
  private pollingInterval: number | null = null;
  private currentPath = '';
  private generation = 0;
  private destroyed = false;
  private toggleWrites: Promise<unknown> = Promise.resolve();
  private reprocessTimer: ReturnType<typeof setTimeout> | null = null;
  private metadataTimer: ReturnType<typeof setTimeout> | null = null;
  private delegatedClickListener: ((event: MouseEvent) => void) | null = null;
  /** Native rows touched by grouping; their parents are never changed. */
  private originals = new Set<HTMLElement>();
  private groupedTexts = new Map<HTMLElement, NotificationGroup>();
  private lastNodes: HTMLElement[] = [];
  private signatures = new WeakMap<HTMLElement, string>();
  private activityIds = new WeakMap<HTMLElement, number | null>();
  private nextEnhancementAt = 0;
  private nextGroupId = 0;
  /** Keyed by the first row of each group so the state survives rebuilds. */
  private expandedGroups = new WeakSet<HTMLElement>();
  private enrichmentInFlight = new WeakMap<HTMLElement, { id: number; generation: number }>();
  private runSafely(operation: Promise<void>): void {
    void operation.catch((error) => logger.error('Notification processing failed', error));
  }

  constructor(
    @inject(TOKENS.NotificationFetchService) private fetchService: NotificationFetchService,
    @inject(TOKENS.NotificationGroupService) private groupService: NotificationGroupService,
    @inject(TOKENS.NotificationFilterService) private filterService: NotificationFilterService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.Storage) private storage: IStorageService
  ) {
    super(eventBus);
    this.currentPath = location.pathname;
  }

  public getName(): string {
    return 'notificationCleaner';
  }
  public async init(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    this.enabled = (await this.storage.get<boolean>('clutterfree_group_likes')) ?? false;
    if (this.destroyed || generation !== this.generation) return;
    this.delegatedClickListener = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.au-compress-button')) {
        event.preventDefault();
        event.stopPropagation();
        this.runSafely(this.toggleGrouping());
      }
    };
    document.body.addEventListener('click', this.delegatedClickListener, true);
    this.onPageChange((event) => {
      this.runSafely(this.handlePageChange(event?.path));
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.fullReset(true);
      if (!this.destroyed && location.pathname.startsWith('/notifications'))
        this.runSafely(this.startObservation());
    });
    if (location.pathname.startsWith('/notifications')) await this.startObservation();
  }

  private fullReset(clearActivityCache = false): void {
    this.generation++;
    if (this.reprocessTimer) clearTimeout(this.reprocessTimer);
    this.reprocessTimer = null;
    this.cancelMetadataRefresh();
    if (this.pollingInterval !== null) window.clearInterval(this.pollingInterval);
    this.pollingInterval = null;
    this.cleanup();
    this.clearVirtualNotifications();
    this.groupService.resetReplyCursors();
    this.filterService.cleanup();
    for (const node of this.nativeNotifications()) this.groupService.removeActivityDetails(node);
    if (clearActivityCache && this.fetchService.clearCache)
      this.runSafely(this.fetchService.clearCache());
    else this.fetchService.beginPage?.();
    document.querySelector('.au-compress-button')?.remove();
    this.isProcessing = false;
    this.needsReprocess = false;
    this.lastNodes = [];
    this.signatures = new WeakMap();
    this.activityIds = new WeakMap();
    this.nextEnhancementAt = 0;
    this.expandedGroups = new WeakSet();
    this.enrichmentInFlight = new WeakMap();
  }

  private async handlePageChange(eventPath: string | undefined): Promise<void> {
    const path = eventPath ?? location.pathname;
    if (path === this.currentPath || this.destroyed) return;
    this.currentPath = path;
    this.fullReset(false);
    if (path === '/notifications' || path === '/notifications/') await this.startObservation();
  }

  private async startObservation(): Promise<void> {
    const generation = this.generation;
    this.checkAndProcess();
    const container = await this.waitForElement('.notifications', 5000);
    if (
      this.destroyed ||
      generation !== this.generation ||
      !location.pathname.startsWith('/notifications')
    )
      return;
    this.registerObserver(
      this.OBSERVER_NAME,
      container ?? document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'href'] },
      () => this.checkAndProcess(),
      16
    );
    this.checkAndProcess();
    if (this.pollingInterval === null)
      this.pollingInterval = window.setInterval(() => this.checkAndProcess(), 2000);
  }

  private checkAndProcess(): void {
    if (this.destroyed || !location.pathname.startsWith('/notifications')) return;
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }
    const mark = document.querySelector<HTMLElement>(
      '.reset-btn, .reset-button, .mark-all, .mark-as-read'
    );
    if (mark && !document.querySelector('.au-compress-button')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'au-compress-button';
      mark.before(button);
      this.updateToggle();
    }
    this.filterService.injectSearchBar((query) => this.filterService.applySearchFilter(query));
    this.runSafely(this.processNotifications());
  }

  private updateToggle(): void {
    const button = document.querySelector('.au-compress-button');
    if (!button) return;
    button.classList.toggle('compressed', this.enabled);
    button.textContent = this.enabled ? 'Unmerge Notifications' : 'Merge Notifications';
    button.setAttribute('aria-pressed', String(this.enabled));
  }

  private async toggleGrouping(): Promise<void> {
    const enabled = !this.enabled;
    this.enabled = enabled;
    const generation = ++this.generation;
    this.cancelMetadataRefresh();
    const writing = this.toggleWrites.then(async () => {
      if (!(await this.storage.set('clutterfree_group_likes', enabled)))
        throw new Error('Grouping preference write failed');
    });
    this.toggleWrites = writing.catch(() => undefined);
    try {
      await writing;
    } catch (error) {
      if (generation === this.generation && !this.destroyed) {
        this.enabled = !enabled;
        this.isProcessing = false;
        this.updateToggle();
        this.checkAndProcess();
      }
      throw error;
    }
    if (generation !== this.generation || this.destroyed) return;
    this.isProcessing = false;
    this.clearVirtualNotifications();
    this.lastNodes = [];
    this.updateToggle();
    if (this.enabled) await this.processNotifications();
    else this.filterService.applySearchFilter(this.filterService.getSearchQuery());
  }

  private nativeNotifications(): HTMLElement[] {
    return [
      ...document.querySelectorAll<HTMLElement>(
        '.notifications .notification:not(.au-virtual-notification), .notifications .notification-item:not(.au-virtual-notification)'
      ),
    ].filter((node) => !node.parentElement?.closest('.notification, .notification-item'));
  }

  private signature(notification: HTMLElement): string {
    const grouping = this.groupService.groupingFor(notification);
    const hrefs = [notification, ...notification.querySelectorAll('a[href]')]
      .filter((node) => !node.closest('.au-activity-context'))
      .map((node) => node.getAttribute('href') ?? '');
    return JSON.stringify([
      grouping?.key,
      grouping?.type,
      [...notification.classList].filter((name) => !name.startsWith('au-')).sort(),
      ...hrefs,
    ]);
  }

  private isUnavailable(notification: HTMLElement): boolean {
    const id = this.fetchService.extractActivityId(notification);
    return id !== null && Boolean(this.fetchService.isActivityUnavailable?.(id));
  }

  private cancelMetadataRefresh(): void {
    if (this.metadataTimer !== null) clearTimeout(this.metadataTimer);
    this.metadataTimer = null;
  }

  private refreshMetadata(generation: number): void {
    if (
      this.destroyed ||
      generation !== this.generation ||
      !location.pathname.startsWith('/notifications')
    )
      return;
    for (const [text, group] of this.groupedTexts) {
      const updated = this.groupService.generateGroupText(group);
      if (text.textContent !== updated.textContent) text.replaceChildren(...updated.childNodes);
    }
    const query = this.filterService.getSearchQuery();
    if (query) this.filterService.applySearchFilter(query);
  }

  private scheduleMetadataRefresh(generation: number): void {
    if (this.metadataTimer !== null || this.destroyed || generation !== this.generation) return;
    this.metadataTimer = setTimeout(() => {
      this.metadataTimer = null;
      this.refreshMetadata(generation);
    }, 16);
  }

  private async processNotifications(): Promise<void> {
    const generation = this.generation;
    const isCurrent = () =>
      !this.destroyed &&
      generation === this.generation &&
      location.pathname.startsWith('/notifications');
    if (!isCurrent()) return;
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }
    const nodes = this.nativeNotifications();
    const changed =
      nodes.length !== this.lastNodes.length ||
      nodes.some(
        (node, index) =>
          node !== this.lastNodes[index] || this.signatures.get(node) !== this.signature(node)
      );
    const missingContext = nodes.some(
      (node) =>
        this.fetchService.extractActivityId(node) !== null &&
        !this.isUnavailable(node) &&
        !node.querySelector('.au-activity-context')
    );
    if (!changed && (!missingContext || Date.now() < this.nextEnhancementAt)) return;
    this.isProcessing = true;
    this.needsReprocess = false;
    try {
      if (changed) {
        this.clearVirtualNotifications();
        for (const node of nodes) {
          const id = this.fetchService.extractActivityId(node);
          if (this.activityIds.has(node) && this.activityIds.get(node) !== id)
            this.groupService.removeActivityDetails(node);
          this.activityIds.set(node, id);
          this.signatures.set(node, this.signature(node));
        }
        if (this.enabled) this.rebuildGroups(nodes);
        this.lastNodes = nodes;
      }
      this.filterService.applySearchFilter(this.filterService.getSearchQuery());
    } finally {
      if (isCurrent()) {
        this.isProcessing = false;
        if (this.needsReprocess)
          this.reprocessTimer = setTimeout(() => {
            this.reprocessTimer = null;
            this.runSafely(this.processNotifications());
          }, 100);
      }
    }

    // Keep observing throughout grouping: signatures ignore our own changes,
    // so no suspension window can swallow a newly appended native page.
    // A slow/deleted activity must never delay grouping newly appended pages.
    const requests: Array<{ node: HTMLElement; request: { id: number; generation: number } }> = [];
    for (const node of nodes) {
      const id = this.fetchService.extractActivityId(node);
      const pending = this.enrichmentInFlight.get(node);
      if (
        id === null ||
        this.isUnavailable(node) ||
        node.querySelector('.au-activity-context') ||
        (pending?.id === id && pending.generation === generation)
      )
        continue;
      const request = { id, generation };
      this.enrichmentInFlight.set(node, request);
      requests.push({ node, request });
    }
    if (!requests.length) return;
    this.nextEnhancementAt = Date.now() + 30000;
    try {
      await this.groupService.enhanceNotificationsWithActivityDetails(
        requests.map(({ node }) => node),
        false,
        isCurrent,
        () => this.scheduleMetadataRefresh(generation)
      );
    } finally {
      for (const { node, request } of requests) {
        if (this.enrichmentInFlight.get(node) === request) this.enrichmentInFlight.delete(node);
      }
    }
    if (!isCurrent()) return;
    // Reply-like merges depend on reply text that is only known after enrichment,
    // so the groups are rebuilt once that text is in place.
    if (
      this.enabled &&
      this.lastNodes.some((node) => this.groupService.groupingFor(node)?.type === 'reply_like')
    ) {
      this.clearVirtualNotifications();
      this.rebuildGroups(this.lastNodes);
      this.filterService.applySearchFilter(this.filterService.getSearchQuery());
    }
    // Coalesce progressive updates; finish synchronously for the final result.
    // A 404 leaves group membership, order and expanded state intact.
    this.cancelMetadataRefresh();
    this.refreshMetadata(generation);
  }

  /**
   * Folds rows about the same activity into a host row, as planned by planRowMerges. Merged rows
   * stay in place with a class; the host gains a note, so ungrouping only removes those.
   */
  private mergeSameActivityRows(group: NotificationGroup): void {
    const types = new Map<HTMLElement, string>();
    const rows: MergeRow<HTMLElement>[] = group.elements.map((node) => {
      const type = this.groupService.groupingFor(node)?.type ?? '';
      types.set(node, type);
      return {
        row: node,
        type,
        activityId: this.fetchService.extractActivityId(node),
        time: node.querySelector('.time')?.textContent?.trim() ?? '',
        target: node.querySelector('.au-activity-target')?.textContent?.trim() ?? '',
        resolved: this.groupService.isReplyPaired(node),
      };
    });
    const merges = planRowMerges(rows);
    if (!merges.length) return;
    const merged = new Set<HTMLElement>();
    for (const merge of merges) {
      merged.add(merge.row);
      merge.row.classList.add('au-notification-merged');
      group.count--;
      const type = types.get(merge.row) ?? '';
      const remaining = (group.types.get(type) ?? 1) - 1;
      if (remaining > 0) group.types.set(type, remaining);
      else group.types.delete(type);
      const host = merge.into.querySelector<HTMLElement>('.details') ?? merge.into;
      const badge = document.createElement('span');
      badge.className = 'au-merged-mention';
      badge.textContent = merge.note;
      host.append(badge);
    }
    group.elements = group.elements.filter((node) => !merged.has(node));
  }

  /** Groups consecutive rows from one actor. Native rows keep their parents and only gain classes. */
  private rebuildGroups(nodes: HTMLElement[]): void {
    let group: NotificationGroup | undefined;
    const flush = () => {
      if (!group) return;
      this.mergeSameActivityRows(group);
      if (group.count > 1) this.performGrouping(group);
    };
    for (const node of nodes) {
      // Group by native actor/type/order; resource availability only
      // controls detail fetching, never membership in the group.
      const item = this.groupService.groupingFor(node);
      if (!item) {
        flush();
        group = undefined;
        continue;
      }
      const time = node.querySelector('.time')?.textContent?.trim() ?? '';
      // A lone comment-like is keyed by comment; if the same actor continues
      // the run, re-key it as that actor's group instead of splitting it.
      if (
        group &&
        group.key !== item.key &&
        group.kind === 'forum' &&
        group.count === 1 &&
        item.kind === 'user' &&
        group.actor &&
        group.actor.toLowerCase() === item.user.toLowerCase()
      ) {
        group.kind = 'user';
        group.key = item.key;
        group.user = item.user;
        group.subject = undefined;
      }
      if (group?.key === item.key) {
        group.elements.push(node);
        group.count++;
        group.latestTime = time;
        group.types.set(item.type, (group.types.get(item.type) ?? 0) + 1);
      } else if (
        group?.kind === 'user' &&
        item.kind === 'forum' &&
        item.actor?.toLowerCase() === group.user.toLowerCase()
      ) {
        group.elements.push(node);
        group.count++;
        group.latestTime = time;
        group.types.set(item.type, (group.types.get(item.type) ?? 0) + 1);
      } else {
        flush();
        group = {
          ...item,
          count: 1,
          types: new Map([[item.type, 1]]),
          elements: [node],
          firstTime: time,
          latestTime: time,
        };
      }
    }
    flush();
  }

  /** Inserts a summary before the first native row. Native rows stay in place; they only gain classes. */
  private performGrouping(group: NotificationGroup): void {
    const rows = [...group.elements];
    const first = rows[0];
    const groupId = String(++this.nextGroupId);
    const isExpanded = this.expandedGroups.has(first);
    const summary = document.createElement('div');
    summary.className = first.className;
    summary.classList.add('au-virtual-notification');
    summary.dataset.auGroup = groupId;
    summary.classList.toggle(
      'unread',
      rows.some((notification) => notification.classList.contains('unread'))
    );
    for (const attr of first.attributes)
      if (attr.name.startsWith('data-v-')) summary.setAttribute(attr.name, attr.value);
    const avatar = first.querySelector('.avatar, .image, .cover');
    if (avatar) {
      const image = avatar.cloneNode(true) as HTMLElement;
      image.classList.add('au-notification-summary-image');
      summary.append(image);
      summary.classList.add('au-notification-summary-with-image');
    }
    // AniList styles each child with Vue scope attributes. Own the summary's
    // layout instead of inheriting a grid whose first column is only 60px wide.
    const content = document.createElement('div');
    content.className = 'au-notification-summary-content';
    const time = document.createElement('div');
    time.className = 'au-notification-summary-time';
    time.textContent = notificationTimeRange(group.firstTime, group.latestTime);
    if (time.textContent) content.append(time);
    const text = document.createElement('div');
    text.className = 'au-notification-summary-text';
    if (group.kind === 'user' && group.user) {
      const user = document.createElement('a');
      user.href = '/user/' + encodeURIComponent(group.user) + '/';
      user.className = 'name au-user-link';
      user.textContent = group.user;
      text.append(user, ' ');
    }
    const groupText = this.groupService.generateGroupText(group);
    this.groupedTexts.set(groupText, group);
    text.append(groupText);
    content.append(text);
    summary.append(content);
    summary.setAttribute('role', 'button');
    summary.tabIndex = 0;

    const rowClasses = ['au-sub-notification', 'au-notification-group-' + (group.kind ?? 'user')];
    if (group.kind === 'site' && group.types.size === 1 && group.types.has('site_added'))
      rowClasses.push('au-notification-group-site-added');
    rows.forEach((row, index) => {
      row.classList.add(...rowClasses);
      row.classList.toggle('au-sub-first', index === 0);
      row.classList.toggle('au-sub-last', index === rows.length - 1);
      row.dataset.auGroup = groupId;
      row.classList.toggle('au-notification-collapsed', !isExpanded);
      this.originals.add(row);
    });

    const setExpanded = (open: boolean): void => {
      summary.setAttribute('aria-expanded', String(open));
      for (const row of rows) row.classList.toggle('au-notification-collapsed', !open);
      if (open) this.expandedGroups.add(first);
      else this.expandedGroups.delete(first);
      // A search keeps its own visibility rules; re-apply them over the new state.
      const query = this.filterService.getSearchQuery();
      if (query) this.filterService.applySearchFilter(query);
    };
    summary.setAttribute('aria-expanded', String(isExpanded));
    summary.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('a'))
        setExpanded(summary.getAttribute('aria-expanded') !== 'true');
    });
    summary.addEventListener('keydown', (event) => {
      if (event.target === summary && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setExpanded(summary.getAttribute('aria-expanded') !== 'true');
      }
    });
    first.before(summary);
  }

  /** Removes every summary and class/merge change made by grouping. Native rows keep their parents. */
  private clearVirtualNotifications(): void {
    this.groupedTexts.clear();
    for (const row of this.originals) this.resetRow(row);
    this.originals.clear();
    document.querySelectorAll<HTMLElement>('.au-sub-notification').forEach((row) => this.resetRow(row));
    document.querySelectorAll('.au-virtual-notification').forEach((node) => node.remove());
    document
      .querySelectorAll('.au-notification-merged')
      .forEach((node) => node.classList.remove('au-notification-merged'));
    document.querySelectorAll('.au-merged-mention').forEach((node) => node.remove());
  }

  private resetRow(row: HTMLElement): void {
    row.classList.remove(
      'au-sub-notification',
      'au-sub-first',
      'au-sub-last',
      'au-notification-collapsed',
      'au-notification-group-user',
      'au-notification-group-site',
      'au-notification-group-forum',
      'au-notification-group-site-added'
    );
    delete row.dataset.auGroup;
  }

  public override async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fullReset(true);
    if (this.delegatedClickListener)
      document.body.removeEventListener('click', this.delegatedClickListener, true);
    this.delegatedClickListener = null;
    await super.destroy();
  }
}
