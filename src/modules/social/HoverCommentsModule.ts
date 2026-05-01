/**
 * @file HoverCommentsModule.ts
 * @description Hover-to-reveal user notes on anime/manga pages
 *
 * On media pages (/anime/*, /manga/*), scans the "Following" sidebar for users
 * who have written notes for the current media. Injects a comment icon next to
 * each user with notes, and shows a tooltip on hover.
 *
 * Data Fetching:
 *   - Uses GraphQL alias batching to fetch notes for all users in a single request
 *   - Falls back to sequential fetching if batch fails
 *   - In-memory cache to avoid re-fetching on subsequent polls
 *
 * Polling:
 *   - 3-second polling interval to detect dynamically loaded content
 *   - Processes new user links that weren't present on initial load
 *
 * @see CommentTooltip.ts for the tooltip UI component
 * @see docs/MODULES.md#6-hover-comments-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { CommentTooltip } from './CommentTooltip';
import { localStorage } from '@core/storage/StorageManager';
import '../../styles/hover-comments.css';

@injectable()
export class HoverCommentsModule extends BaseModule {
  private tooltip: CommentTooltip;
  private pollingInterval: any = null;
  private processedMediaId: number | null = null;
  private currentMediaId: number | null = null; // BUG-033 fix: track current context
  private isProcessing = false;
  private readonly ICON_SVG = `<svg class="au-comment-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 32C114.6 32 0 125.1 0 240c0 67.6 39.1 127.9 100.1 163.8c-3.1 13.1-13.8 37.7-35 53.7c-6.3 4.8-3.1 14.7 4.8 15c66.2 3.3 115.1-34.7 140.3-54.9c14.7 1.5 29.8 2.4 45.8 2.4c141.4 0 256-93.1 256-208S397.4 32 256 32z"/></svg>`;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
    this.tooltip = new CommentTooltip({
      onRefresh: () => window.location.reload(),
    });
  }

  public async init(): Promise<void> {
    // Auth guard: modulo richiede autenticazione
    if (!this.apiClient.isAuthenticated()) {
      this.logger.warn('[HoverComments] Not authenticated, deferring initialization');
      return; // Non crasha, semplicemente non si attiva
    }

    this.logger.info('[HoverComments] Initializing...');
    await this.loadCache();

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
    this.currentMediaId = null; // BUG-033 fix: clear context
    this.notesCache = {}; // BUG-033 fix: clear cache to prevent stale data
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
    this.currentMediaId = media.id; // BUG-033 fix: set current context
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

    // 1. Immediate injection for cached users
    const usernamesToFetch: string[] = [];
    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (!username) return;
      const cacheKey = this.getCacheKey(username, mediaId);
      if (this.notesCache[cacheKey]) {
        this.injectIcon(link, username, mediaId, this.notesCache[cacheKey].notes);
      } else {
        usernamesToFetch.push(username);
      }
    });

    if (usernamesToFetch.length === 0) return;

    // 2. Fetch missing ones in background
    this.logger.info(`[HoverComments] Fetching notes for ${usernamesToFetch.length} new users`);
    const notes = await this.fetchBatchNotes(usernamesToFetch, mediaId);

    // 3. Inject newly fetched icons
    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (username && notes[username]) {
        this.injectIcon(link, username, mediaId, notes[username]);
      }
    });
  }

  private notesCache: Record<string, { notes: string, timestamp: number }> = {};
  private readonly CACHE_KEY = 'hover_comments_cache';

  private async loadCache(): Promise<void> {
    try {
      const stored = await localStorage.get<Record<string, any>>(this.CACHE_KEY);
      if (stored) {
        this.notesCache = stored;
      }
    } catch (e) {
      this.logger.debug('[HoverComments] Failed to load cache', e);
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await localStorage.set(this.CACHE_KEY, this.notesCache);
    } catch (e) {
      this.logger.debug('[HoverComments] Failed to save cache', e);
    }
  }

  private getCacheKey(username: string, mediaId: number): string {
    return `${username.toLowerCase()}_${mediaId}`;
  }

  private injectIconsIfMissing(mediaId: number): void {
    const followingSection = this.findFollowingSection();
    if (!followingSection) return;

    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]:not([data-au-comment-injected])'));
    if (userLinks.length === 0) return;

    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      const cacheKey = username ? this.getCacheKey(username, mediaId) : null;
      if (username && cacheKey && this.notesCache[cacheKey]) {
        this.injectIcon(link, username, mediaId, this.notesCache[cacheKey].notes);
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
    const usersToFetch = usernames.filter(u => !this.notesCache[this.getCacheKey(u, mediaId)]);
    if (usersToFetch.length === 0) {
      // All users are in cache, but we need to return the notes for the current mediaId
      usernames.forEach(u => {
        const cached = this.notesCache[this.getCacheKey(u, mediaId)];
        if (cached) results[u] = cached.notes;
      });
      return results;
    }

    this.logger.info(`[HoverComments] Batch fetching notes for ${usersToFetch.length} new users...`);

    try {
      // Build a batched query using GraphQL variables
      const varDecls = usersToFetch.map((_, i) => `$u${i}: String!`).join(', ');
      const aliasParts = usersToFetch.map((_, i) =>
        `user_${i}: MediaList(userName: $u${i}, mediaId: $mid) { notes }`
      );

      const query = `query ($mid: Int!, ${varDecls}) { ${aliasParts.join('\n')} }`;
      const variables: Record<string, unknown> = { mid: mediaId };
      usersToFetch.forEach((u, i) => { variables[`u${i}`] = u; });

      const data = await this.apiClient.query<any>(query, variables);

      // Only update cache if still on same media
      if (this.currentMediaId === mediaId) {
        usersToFetch.forEach((username, index) => {
          const safeAlias = `user_${index}`;
          const notes = data?.[safeAlias]?.notes;
          if (notes) {
            const cacheKey = this.getCacheKey(username, mediaId);
            this.notesCache[cacheKey] = { notes, timestamp: Date.now() };
            results[username] = notes;
          }
        });
        await this.saveCache();
      }
    } catch (error) {
      this.logger.error('[HoverComments] Batch fetch failed', error);
      // Fallback to sequential
      for (const username of usersToFetch) {
        try {
          const query = `query ($u: String, $m: Int) { MediaList(userName: $u, mediaId: $m) { notes } }`;
          const data = await this.apiClient.query<any>(query, { u: username, m: mediaId });

          if (this.currentMediaId === mediaId && data?.MediaList?.notes) {
            const cacheKey = this.getCacheKey(username, mediaId);
            const notes = data.MediaList.notes;
            this.notesCache[cacheKey] = { notes, timestamp: Date.now() };
            results[username] = notes;
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {}
      }
      await this.saveCache();
    }

    return results;
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
