/**
 * @file HoverCommentsModule.ts
 * @description Hover-to-reveal user notes on anime/manga pages
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { CommentTooltip } from './CommentTooltip';
import { StorageManager } from '@core/storage/StorageManager';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { html } from '@core/utils/Template';
import '../../styles/hover-comments.css';

@injectable()
export class HoverCommentsModule extends BaseModule {
  private pollingInterval: any = null;
  private processedMediaId: number | null = null;
  private isProcessing = false;

  private notesCache: Record<string, { notes: string; timestamp: number }> = {};
  private readonly CACHE_KEY = 'hover_comments_cache_v2';
  private readonly EMPTY_CACHE_TTL_MS = 10 * 60 * 1000;
  /** SEC-010: cap the persisted notes cache to avoid unbounded growth over a session. */
  private readonly MAX_CACHE_ENTRIES = 500;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(CommentTooltip) private tooltip: CommentTooltip
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (!this.apiClient.isAuthenticated()) return;

    this.logger.info('[HoverComments] Initializing...');
    await this.loadCache();

    this.onPageChange(() => {
      this.fullReset();
      if (this.isMediaPage()) this.startPolling();
    });

    if (this.isMediaPage()) this.startPolling();
  }

  public getName(): string {
    return 'hoverComments';
  }

  private fullReset(): void {
    this.stopPolling();
    this.processedMediaId = null;
    this.notesCache = {};
    this.tooltip.unmount();
    this.isProcessing = false;
  }

  private isMediaPage(): boolean {
    return /\/(anime|manga)\/(\d+)/.test(window.location.pathname);
  }

  private startPolling(): void {
    this.stopPolling();
    this.tooltip.mount(document.body);
    this.processPage();
    this.pollingInterval = window.setInterval(() => this.processPage(), 3000);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async processPage(): Promise<void> {
    if (this.isProcessing) return;

    if (StorageManager.isContextDead()) {
      this.stopPolling();
      return;
    }

    const media = this.extractMediaFromUrl();
    if (!media) return;

    if (this.processedMediaId === media.id) {
      await this.runInjectionFlow(media.id);
      return;
    }

    this.isProcessing = true;
    try {
      await this.runInjectionFlow(media.id);
      this.processedMediaId = media.id;
    } catch (error) {
      this.logger.debug('[HoverComments] Page process failed', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async runInjectionFlow(mediaId: number): Promise<void> {
    const followingSection = this.findFollowingSection();
    if (!followingSection) return;

    const userLinks = Array.from(
      followingSection.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/user/"]:not([data-au-comment-injected])'
      )
    );
    if (userLinks.length === 0) return;

    const usernamesToFetch: string[] = [];

    userLinks.forEach((link) => {
      const username = this.extractUsername(link);
      if (!username) return;
      const cacheKey = this.getCacheKey(username, mediaId);
      const cached = this.notesCache[cacheKey];
      if (cached && (cached.notes.trim() || Date.now() - cached.timestamp < this.EMPTY_CACHE_TTL_MS)) {
        const cachedNotes = cached.notes;
        if (cachedNotes.trim()) {
          this.injectIcon(link, username, mediaId, cachedNotes);
        }
      } else {
        usernamesToFetch.push(username);
      }
    });

    if (usernamesToFetch.length === 0) return;

    const notes = await this.fetchBatchNotes(usernamesToFetch, mediaId);
    userLinks.forEach((link) => {
      const username = this.extractUsername(link);
      if (username && notes[username]) {
        this.injectIcon(link, username, mediaId, notes[username]);
      }
    });
  }

  private async fetchBatchNotes(
    usernames: string[],
    mediaId: number
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};

    const fetchPromises = usernames.map(async (username) => {
      try {
        // Use GraphQL variables (not string interpolation) to prevent injection.
        const query = `query ($userName: String, $mediaId: Int) { MediaList(userName: $userName, mediaId: $mediaId) { notes } }`;
        const data = await this.batcher.query<any>(query, { userName: username, mediaId });
        const cacheKey = this.getCacheKey(username, mediaId);
        const userNotes = data?.notes || '';

        this.notesCache[cacheKey] = { notes: userNotes, timestamp: Date.now() };

        if (userNotes.trim()) {
          results[username] = data.notes;
        }
      } catch (e) {
        this.logger.debug('[HoverComments] note fetch failed', e);
      }
    });

    await Promise.all(fetchPromises);
    await this.saveCache();
    return results;
  }

  private async loadCache(): Promise<void> {
    try {
      const stored = await this.storage.get<Record<string, any>>(this.CACHE_KEY);
      if (stored) this.notesCache = stored;
    } catch (e) {
      this.logger.debug('[HoverComments] cache op failed', e);
    }
  }

  private async saveCache(): Promise<void> {
    if (StorageManager.isContextDead()) return;
    try {
      this.pruneCache();
      await this.storage.set(this.CACHE_KEY, this.notesCache);
    } catch (e) {
      this.logger.debug('[HoverComments] cache op failed', e);
    }
  }

  /** SEC-010: keep only the most recent MAX_CACHE_ENTRIES notes by timestamp. */
  private pruneCache(): void {
    const entries = Object.entries(this.notesCache);
    if (entries.length <= this.MAX_CACHE_ENTRIES) return;
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    this.notesCache = Object.fromEntries(entries.slice(0, this.MAX_CACHE_ENTRIES));
  }

  private getCacheKey(username: string, mediaId: number): string {
    return `${username.toLowerCase()}_${mediaId}`;
  }

  private injectIcon(
    link: HTMLAnchorElement,
    username: string,
    mediaId: number,
    notes: string
  ): void {
    if (link.hasAttribute('data-au-comment-injected')) return;
    const anchor =
      (link.closest('.activity-entry, .user-status-row, .following-list-item') as HTMLElement) ||
      link;
    anchor.style.position = 'relative';

    const iconContainer = html`
      <div class="comment-icon-ghost">
        <span class="anilist-comment-icon"></span>
      </div>
    `;
    if (window.location.pathname.endsWith('/social')) {
      iconContainer.classList.add('au-in-social-feed');
    }

    anchor.appendChild(iconContainer);

    const icon = iconContainer.querySelector('.anilist-comment-icon') as HTMLElement;
    icon.appendChild(this.createCommentIconSvg());
    iconContainer.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      this.tooltip.show(icon, { username, mediaId, notes, timestamp: Date.now() });
    });

    iconContainer.addEventListener('mouseleave', () => this.tooltip.onIconLeave());
    link.addEventListener('mouseenter', () => icon.classList.add('row-hover'));
    link.addEventListener('mouseleave', () => icon.classList.remove('row-hover'));
    link.setAttribute('data-au-comment-injected', 'true');
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
      const match = url.pathname.match(/^\/user\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      const match = href.match(/\/user\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }

  private extractMediaFromUrl(): { id: number; type: string } | null {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    return match ? { id: parseInt(match[2]), type: match[1].toUpperCase() } : null;
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
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>('h2, h3, .section-header')
    );

    for (const header of headers) {
      const headerText = header.textContent?.trim().toLowerCase();
      if (headerText !== normalizedTitle) continue;

      const section =
        header.closest<HTMLElement>('.grid-section, section, .content-wrap, .sidebar, .following') ||
        header.parentElement;

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
    this.fullReset();
    await super.destroy();
  }
}
