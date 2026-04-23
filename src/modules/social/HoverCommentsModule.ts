/**
 * Hover Comments Module
 * Fetches and displays user notes on media pages
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import { CommentTooltip } from './CommentTooltip';
import '../../styles/hover-comments.css';

@injectable()
export class HoverCommentsModule extends BaseModule {
  private tooltip: CommentTooltip;
  private pollingInterval: any = null;
  private processedMediaId: number | null = null;
  private isProcessing = false;
  private readonly ICON_SVG = `<svg class="au-comment-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M512 240c0 114.9-114.6 208-256 208c-37.1 0-72.3-6.4-104.1-17.9c-11.9 8.7-31.3 20.6-54.3 30.6C73.6 471.1 44.7 480 16 480c-6.5 0-12.3-3.9-14.8-9.9c-2.5-6-1.1-12.8 3.4-17.4l4.1-4.1c10.1-10.1 16.6-23.3 18.2-38.1C11.2 367.1 0 306.7 0 240C0 125.1 114.6 32 256 32s256 93.1 256 208z"/></svg>`;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger
  ) {
    super();
    this.tooltip = new CommentTooltip({
      onRefresh: () => window.location.reload(),
    });
  }

  public async init(): Promise<void> {
    this.logger.info('[HoverComments] Initializing...');

    this.onPageChange(() => {
      this.fullReset();
      if (this.isMediaPage()) {
        this.startPolling();
      }
    });

    if (this.isMediaPage()) {
      this.startPolling();
    }
  }

  public getName(): string {
    return 'hoverComments';
  }

  private fullReset(): void {
    this.stopPolling();
    this.processedMediaId = null;
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

    const media = this.extractMediaFromUrl();
    if (!media) return;

    // Check if we already processed this specific media ID on this page
    if (this.processedMediaId === media.id) {
      // Still check if icons need to be injected (e.g. after dynamic loading of "Following" list)
      this.injectIconsIfMissing(media.id);
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

    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]'));
    if (userLinks.length === 0) return;

    const usernames = userLinks
      .map(link => this.extractUsername(link))
      .filter((u): u is string => !!u);

    if (usernames.length === 0) return;

    this.logger.info(`[HoverComments] Fetching notes for ${usernames.length} users`);
    const notes = await this.fetchBatchNotes(usernames, mediaId);

    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (username && notes[username]) {
        this.injectIcon(link, username, mediaId, notes[username]);
      }
    });
  }

  private notesCache: Record<string, string> = {};

  private injectIconsIfMissing(mediaId: number): void {
    const followingSection = this.findFollowingSection();
    if (!followingSection) return;

    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]:not([data-au-comment-injected])'));
    if (userLinks.length === 0) return;

    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (username && this.notesCache[username]) {
        this.injectIcon(link, username, mediaId, this.notesCache[username]);
      }
    });

    // If there are still new links without cache, trigger a re-process
    const remaining = followingSection.querySelectorAll('a[href^="/user/"]:not([data-au-comment-injected])').length;
    if (remaining > 0) {
      this.processedMediaId = null; // Force full re-process on next poll
    }
  }

  private async fetchBatchNotes(usernames: string[], mediaId: number): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    // Filter out users already in cache
    const usersToFetch = usernames.filter(u => !this.notesCache[u]);
    if (usersToFetch.length === 0) return this.notesCache;

    this.logger.info(`[HoverComments] Batch fetching notes for ${usersToFetch.length} new users...`);

    try {
      // Build a batched query using aliases
      const aliasParts = usersToFetch.map((username, index) => {
        // Alaliases must start with a letter and only contain alphanumeric characters/underscores
        const safeAlias = `user_${index}`;
        return `${safeAlias}: MediaList(userName: "${username}", mediaId: ${mediaId}) { notes }`;
      });

      const query = `query { ${aliasParts.join('\n')} }`;
      const data = await this.apiClient.query<any>(query, {});

      usersToFetch.forEach((username, index) => {
        const safeAlias = `user_${index}`;
        const notes = data?.[safeAlias]?.notes;
        if (notes) {
          this.notesCache[username] = notes;
          results[username] = notes;
        }
      });
    } catch (error) {
      this.logger.error('[HoverComments] Batch fetch failed', error);
      // Fallback to sequential if batching fails for some reason (e.g. one bad username)
      for (const username of usersToFetch) {
        try {
          const query = `query ($u: String, $m: Int) { MediaList(userName: $u, mediaId: $m) { notes } }`;
          const data = await this.apiClient.query<any>(query, { u: username, m: mediaId });
          if (data?.MediaList?.notes) {
            this.notesCache[username] = data.MediaList.notes;
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {}
      }
    }

    return this.notesCache;
  }

  private injectIcon(link: HTMLAnchorElement, username: string, mediaId: number, notes: string): void {
    if (link.hasAttribute('data-au-comment-injected')) return;
    const anchor = link.closest('.activity-entry, .user-status-row, .following-list-item') as HTMLElement || link;
    anchor.style.position = 'relative';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'comment-icon-ghost';
    if (window.location.pathname.endsWith('/social')) {
      iconContainer.classList.add('au-in-social-feed');
    }
    iconContainer.innerHTML = `<span class="anilist-comment-icon">${this.ICON_SVG}</span>`;

    anchor.appendChild(iconContainer);

    const icon = iconContainer.querySelector('.anilist-comment-icon') as HTMLElement;

    iconContainer.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      this.tooltip.show(icon, {
        username,
        mediaId,
        notes,
        timestamp: Date.now(),
      });
    });

    iconContainer.addEventListener('mouseleave', () => {
      this.tooltip.onIconLeave();
    });

    link.addEventListener('mouseenter', () => icon.classList.add('row-hover'));
    link.addEventListener('mouseleave', () => icon.classList.remove('row-hover'));
  }

  private extractUsername(link: HTMLAnchorElement): string | null {
    const href = link.getAttribute('href');
    return href ? href.replace('/user/', '').replace(/\/$/, '') : null;
  }

  private extractMediaFromUrl(): { id: number; type: string } | null {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    return match ? { id: parseInt(match[2]), type: match[1].toUpperCase() } : null;
  }

  private findFollowingSection(): HTMLElement | null {
    // 1. Check for the standard sidebar following list
    const sidebar = document.querySelector('div.following, div[class*="following"], .following');
    if (sidebar) return sidebar as HTMLElement;

    // 2. If on social page, also look for the main activity feed
    if (window.location.pathname.endsWith('/social')) {
      return document.querySelector('.activity-feed') as HTMLElement;
    }

    return null;
  }

  public override async destroy(): Promise<void> {
    this.fullReset();
    await super.destroy();
  }
}
