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

  private injectIconsIfMissing(_mediaId: number): void {
    const followingSection = this.findFollowingSection();
    if (!followingSection) return;

    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]:not([data-au-comment-injected])'));
    if (userLinks.length === 0) return;

    // For new links, we'd need to fetch notes again or use a cache. 
    // To keep it simple and lean, we let the next full scan handle it if processedMediaId changes, 
    // or we could implement a small cache.
  }

  private async fetchBatchNotes(usernames: string[], mediaId: number): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    // AniList GraphQL doesn't easily support batching multiple MediaList queries in one call for different users 
    // without complex alias generation. We'll use parallel individual calls via the rate-limited apiClient.
    const promises = usernames.map(async (username) => {
      try {
        const query = `
          query ($userName: String, $mediaId: Int) {
            MediaList(userName: $userName, mediaId: $mediaId) {
              notes
            }
          }
        `;
        const data = await this.apiClient.query<any>(query, { userName: username, mediaId });
        if (data?.MediaList?.notes) {
          results[username] = data.MediaList.notes;
        }
      } catch (e) {
        // Ignore failures for individual users
      }
    });

    await Promise.all(promises);
    return results;
  }

  private injectIcon(link: HTMLAnchorElement, username: string, mediaId: number, notes: string): void {
    if (link.hasAttribute('data-au-comment-injected')) return;
    link.setAttribute('data-au-comment-injected', 'true');

    const iconContainer = document.createElement('div');
    iconContainer.className = 'comment-icon-column';
    iconContainer.innerHTML = `<span class="anilist-comment-icon">${this.ICON_SVG}</span>`;

    const scoreEl = link.querySelector('div[class*="score"]');
    if (scoreEl) {
      scoreEl.parentNode!.insertBefore(iconContainer, scoreEl);
    } else {
      link.appendChild(iconContainer);
    }

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
    return document.querySelector('div.following, div[class*="following"], .following') as HTMLElement;
  }

  public override async destroy(): Promise<void> {
    this.fullReset();
    await super.destroy();
  }
}
