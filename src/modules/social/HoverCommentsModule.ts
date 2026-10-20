/**
 * @file HoverCommentsModule.ts
 * @description Hover-to-reveal user notes on anime/manga pages
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { CommentTooltip } from './CommentTooltip';
import { CommentReader } from './CommentReader';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { StorageManager } from '@core/storage/StorageManager';
import { CommentService, COMMENT_CACHE_MAX_AGE, type UserComment } from './CommentService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { html } from '@core/utils/Template';
import '../../styles/hover-comments.css';

@injectable()
export class HoverCommentsModule extends BaseModule {
  private pollingInterval: number | null = null;
  private isProcessing = false;
  private pageVersion = 0;
  private initialized = false;
  private ready = false;
  private readonly OBSERVER_NAME = 'hover-comments-following';
  private followingSection: HTMLElement | null = null;
  private injections = new Map<
    HTMLAnchorElement,
    {
      username: string;
      mediaId: number;
      icon: HTMLElement;
      iconContainer: HTMLElement;
      controller: AbortController;
      anchor: HTMLElement;
      position: string;
      suppressed: Set<HTMLElement>;
      timestamp: number;
      context?: ApiContext;
    }
  >();

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(CommentService) private comments: CommentService,
    @inject(CommentTooltip) private tooltip: CommentTooltip,
    @inject(CommentReader) private reader: CommentReader
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.onPageChange(() => {
      this.fullReset();
      void this.prepareSession().catch((error: unknown) =>
        this.logger.error('[HoverComments] Session preparation failed', error)
      );
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.fullReset();
      this.comments.clear();
      void this.prepareSession().catch((error: unknown) =>
        this.logger.error('[HoverComments] Session preparation failed', error)
      );
    });
    await this.prepareSession();
  }

  private async prepareSession(): Promise<void> {
    const version = this.pageVersion;
    if (!this.initialized || !this.apiClient.isAuthenticated()) return;
    try {
      await this.comments.init();
    } catch (error) {
      if (this.initialized && version === this.pageVersion)
        this.logger.debug('[HoverComments] Initialization failed', error);
      return;
    }
    if (version !== this.pageVersion || !this.initialized || !this.apiClient.isAuthenticated())
      return;
    this.ready = true;
    if (this.isMediaPage()) this.startPolling();
  }

  public getName(): string {
    return 'hoverComments';
  }

  private fullReset(): void {
    this.pageVersion++;
    // A page change is a fresh chance for lookups that failed on the previous page.
    this.comments.resetFailures();
    this.ready = false;
    this.stopPolling();
    this.disconnectObserver(this.OBSERVER_NAME);
    this.followingSection = null;
    this.injections.forEach((_, link) => this.removeInjection(link));
    this.reader.close(false);
    this.tooltip.hide();
    this.tooltip.unmount();
    this.isProcessing = false;
  }

  private isMediaPage(): boolean {
    const media = getMediaRoute(window.location.pathname);
    return media !== null && media.id <= 2147483647;
  }

  private startPolling(): void {
    if (!this.initialized || !this.ready || !this.apiClient.isAuthenticated()) return;
    this.stopPolling();
    this.tooltip.mount(document.body);
    void this.processPage();
    this.pollingInterval = window.setInterval(() => {
      void this.processPage();
    }, 3000);
  }

  private stopPolling(): void {
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async processPage(): Promise<void> {
    if (!this.initialized || !this.ready || !this.apiClient.isAuthenticated() || this.isProcessing)
      return;

    if (StorageManager.isContextDead()) {
      this.stopPolling();
      return;
    }

    const media = this.extractMediaFromUrl();
    if (!media || media.id > 2147483647) return;

    const version = this.pageVersion;
    const path = window.location.pathname;
    const context = this.apiClient.getContext?.();
    const capturedContext = context ? { ...context } : undefined;
    const isCurrent = () =>
      this.initialized &&
      this.ready &&
      this.apiClient.isAuthenticated() &&
      version === this.pageVersion &&
      window.location.pathname === path &&
      this.isCurrentContext(capturedContext);
    this.isProcessing = true;
    try {
      await this.runInjectionFlow(media.id, isCurrent);
    } catch (error) {
      this.logger.debug('[HoverComments] Page process failed', error);
    } finally {
      if (version === this.pageVersion) this.isProcessing = false;
    }
  }

  private async runInjectionFlow(mediaId: number, isCurrent: () => boolean): Promise<void> {
    const followingSection = this.findFollowingSection();
    this.injections.forEach((record, link) => {
      if (
        !link.isConnected ||
        !followingSection?.contains(link) ||
        record.mediaId !== mediaId ||
        record.username !== this.extractUsername(link) ||
        !record.iconContainer.isConnected ||
        !this.isCurrentContext(record.context) ||
        Date.now() < record.timestamp ||
        Date.now() - record.timestamp >= COMMENT_CACHE_MAX_AGE
      )
        this.removeInjection(link);
    });
    if (!followingSection) return;
    if (followingSection !== this.followingSection) {
      this.followingSection = followingSection;
      const observerVersion = this.pageVersion;
      this.registerObserver(
        this.OBSERVER_NAME,
        followingSection,
        { childList: true, subtree: true },
        () => {
          if (observerVersion === this.pageVersion) void this.processPage();
        }
      );
    }

    const userLinks = Array.from(
      followingSection.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]')
    );
    if (userLinks.length === 0) return;

    const usernamesToFetch: string[] = [];

    userLinks.forEach((link) => {
      if (this.injections.has(link)) {
        this.suppressNativeIcon(link);
        return;
      }
      const username = this.extractUsername(link);
      if (username) usernamesToFetch.push(username);
    });
    if (!usernamesToFetch.length) return;
    const notes = await this.fetchBatchNotes([...new Set(usernamesToFetch)], mediaId, isCurrent);
    if (!isCurrent()) return;
    userLinks.forEach((link) => {
      if (!link.isConnected || !followingSection.contains(link)) return;
      const username = this.extractUsername(link);
      const comment = username ? notes.get(username) : undefined;
      if (comment?.notes.trim()) this.injectIcon(link, comment);
    });
  }

  private async fetchBatchNotes(
    usernames: string[],
    mediaId: number,
    isCurrent: () => boolean
  ): Promise<Map<string, UserComment>> {
    const results = new Map<string, UserComment>();
    // Bound active reads from long social feeds; the batcher still coalesces them.
    let next = 0;
    const worker = async () => {
      while (next < usernames.length && isCurrent()) {
        const username = usernames[next++];
        const comment = await this.comments.getComment(username, mediaId);
        if (isCurrent() && comment?.notes.trim()) results.set(username, comment);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, usernames.length) }, worker));
    return results;
  }

  private isCurrentContext(context?: ApiContext): boolean {
    if (!context) return true; // An unscoped API operation has no account snapshot to compare.
    const current = this.apiClient.getContext?.();
    return current?.sessionId === context.sessionId && current.userId === context.userId;
  }

  private injectIcon(link: HTMLAnchorElement, comment: UserComment): void {
    const { username, mediaId } = comment;
    if (this.injections.has(link)) return;
    const anchor =
      (link.closest('.activity-entry, .user-status-row, .following-list-item') as HTMLElement) ||
      link;
    const position = anchor.style.position;
    anchor.style.position = 'relative';
    // Vue may clone our DOM attributes without cloning its event listeners.
    anchor.querySelectorAll('.comment-icon-ghost').forEach((element) => element.remove());

    const iconContainer = html`
      <div class="comment-icon-ghost">
        <span
          class="anilist-comment-icon"
          role="button"
          tabindex="0"
          aria-label="Read ${username}'s notes"
          aria-haspopup="dialog"
        ></span>
      </div>
    `;
    if (window.location.pathname.endsWith('/social')) {
      iconContainer.classList.add('au-in-social-feed');
    }

    anchor.appendChild(iconContainer);

    const icon = iconContainer.querySelector('.anilist-comment-icon') as HTMLElement;
    icon.appendChild(this.createCommentIconSvg());
    const controller = new AbortController();
    const options = { signal: controller.signal };

    iconContainer.addEventListener(
      'mouseenter',
      (e) => {
        e.stopPropagation();
        if (this.isCurrentComment(link, username, mediaId)) this.tooltip.show(icon, comment);
      },
      options
    );

    iconContainer.addEventListener('mouseleave', () => this.tooltip.onIconLeave(), options);
    link.addEventListener('mouseenter', () => icon.classList.add('row-hover'), options);
    link.addEventListener('mouseleave', () => icon.classList.remove('row-hover'), options);
    const openReader = (event: Event) => {
      if (!(event.target instanceof Element) || !icon.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.isCurrentComment(link, username, mediaId)) return;
      this.tooltip.hide();
      this.reader.open(comment, icon);
    };
    // Capture on the row before Vue's handlers on nested icons or profile links.
    anchor.addEventListener('click', openReader, { ...options, capture: true });
    icon.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' || event.key === ' ') openReader(event);
      },
      options
    );
    const context = this.apiClient.getContext?.();
    this.injections.set(link, {
      username,
      mediaId,
      icon,
      iconContainer,
      controller,
      anchor,
      position,
      suppressed: new Set(),
      timestamp: comment.timestamp,
      ...(context ? { context: { ...context } } : {}),
    });
    this.suppressNativeIcon(link);
    link.setAttribute('data-au-comment-injected', 'true');
  }

  private isCurrentComment(link: HTMLAnchorElement, username: string, mediaId: number): boolean {
    const record = this.injections.get(link);
    const current =
      this.initialized &&
      this.ready &&
      this.apiClient.isAuthenticated() &&
      !!record &&
      this.isCurrentContext(record.context) &&
      Date.now() >= record.timestamp &&
      Date.now() - record.timestamp < COMMENT_CACHE_MAX_AGE &&
      link.isConnected &&
      getMediaRoute(window.location.pathname)?.id === mediaId &&
      this.extractUsername(link) === username;
    if (!current) this.removeInjection(link);
    return current;
  }

  private suppressNativeIcon(link: HTMLAnchorElement): void {
    const record = this.injections.get(link);
    if (!record) return;
    record.anchor
      .querySelectorAll<SVGElement>('.hover-icon.clickable svg[data-icon="comment"]')
      .forEach((svg) => {
        const native = svg.closest<HTMLElement>('.hover-icon.clickable');
        if (native) {
          if (!native.classList.contains('au-comment-native-suppressed'))
            native.classList.add('au-comment-native-suppressed');
          record.suppressed.add(native);
        }
      });
  }

  private removeInjection(link: HTMLAnchorElement): void {
    const record = this.injections.get(link);
    if (!record) return;
    this.reader.closeFor(record.icon);
    this.tooltip.forgetTarget(record.icon);
    record.controller.abort();
    record.iconContainer.remove();
    record.suppressed.forEach((native) => native.classList.remove('au-comment-native-suppressed'));
    if (record.anchor.style.position === 'relative') record.anchor.style.position = record.position;
    link.removeAttribute('data-au-comment-injected');
    this.injections.delete(link);
  }

  private createCommentIconSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('au-comment-svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
      'd',
      'M256 32C114.6 32 0 125.1 0 240c0 67.6 39.1 127.9 100.1 163.8c-3.1 13.1-13.8 37.7-35 53.7c-6.3 4.8-3.1 14.7 4.8 15c66.2 3.3 115.1-34.7 140.3-54.9c14.7 1.5 29.8 2.4 45.8 2.4c141.4 0 256-93.1 256-208S397.4 32 256 32z'
    );

    svg.appendChild(path);
    return svg;
  }

  private extractUsername(link: HTMLAnchorElement): string | null {
    const href = link.getAttribute('href');
    if (!href) return null;

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      const match = url.pathname.match(/^\/user\/([^/]+)(?:\/|$)/);
      const username = match ? decodeURIComponent(match[1]) : null;
      return username && username.trim() && username.length <= 100 ? username : null;
    } catch {
      return null;
    }
  }

  private extractMediaFromUrl(): { id: number; type: string } | null {
    return getMediaRoute(window.location.pathname);
  }

  private findFollowingSection(): HTMLElement | null {
    if (window.location.pathname.endsWith('/social')) {
      return this.findSectionByHeader('Following');
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div.following, .following, .activity-feed, .activities, div[class*="following"]'
      )
    );

    return (
      candidates.find((candidate) => candidate.querySelector('a[href*="/user/"]')) ||
      candidates[0] ||
      null
    );
  }

  private findSectionByHeader(title: string): HTMLElement | null {
    const normalizedTitle = title.toLowerCase();
    const headers = Array.from(document.querySelectorAll<HTMLElement>('h2, h3, .section-header'));

    for (const header of headers) {
      const headerText = header.textContent?.trim().toLowerCase();
      if (headerText !== normalizedTitle) continue;

      const section =
        header.closest<HTMLElement>(
          '.grid-section, section, .content-wrap, .sidebar, .following'
        ) || header.parentElement;

      if (section?.querySelector('a[href*="/user/"]')) {
        return section;
      }

      const next = header.nextElementSibling as HTMLElement | null;
      if (next?.querySelector('a[href*="/user/"]')) {
        return next;
      }
    }

    return null;
  }

  public override async destroy(): Promise<void> {
    this.initialized = false;
    this.fullReset();
    this.comments.clear();
    await super.destroy();
  }
}
