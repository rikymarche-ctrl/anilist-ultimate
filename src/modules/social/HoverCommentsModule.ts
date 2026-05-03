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
import '../../styles/hover-comments.css';

@injectable()
export class HoverCommentsModule extends BaseModule {
  private tooltip: CommentTooltip;
  private pollingInterval: any = null;
  private processedMediaId: number | null = null;
  private isProcessing = false;
  private readonly ICON_SVG = `<svg class="au-comment-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 32C114.6 32 0 125.1 0 240c0 67.6 39.1 127.9 100.1 163.8c-3.1 13.1-13.8 37.7-35 53.7c-6.3 4.8-3.1 14.7 4.8 15c66.2 3.3 115.1-34.7 140.3-54.9c14.7 1.5 29.8 2.4 45.8 2.4c141.4 0 256-93.1 256-208S397.4 32 256 32z"/></svg>`;

  private notesCache: Record<string, { notes: string, timestamp: number }> = {};
  private readonly CACHE_KEY = 'hover_comments_cache';

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) {
    super(eventBus);
    this.tooltip = new CommentTooltip({
      onRefresh: () => window.location.reload(),
    });
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

  public getName(): string { return 'hoverComments'; }

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

    const notes = await this.fetchBatchNotes(usernamesToFetch, mediaId);
    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (username && notes[username]) {
        this.injectIcon(link, username, mediaId, notes[username]);
      }
    });
  }

  private async fetchBatchNotes(usernames: string[], mediaId: number): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    const fetchPromises = usernames.map(async username => {
      try {
        const query = `{ MediaList(userName: "${username}", mediaId: ${mediaId}) { notes } }`;
        const data = await this.batcher.query<any>(query);
        if (data?.notes) {
          const cacheKey = this.getCacheKey(username, mediaId);
          this.notesCache[cacheKey] = { notes: data.notes, timestamp: Date.now() };
          results[username] = data.notes;
        }
      } catch (e) {}
    });

    await Promise.all(fetchPromises);
    await this.saveCache();
    return results;
  }

  private async loadCache(): Promise<void> {
    try {
      const stored = await this.storage.get<Record<string, any>>(this.CACHE_KEY);
      if (stored) this.notesCache = stored;
    } catch (e) {}
  }

  private async saveCache(): Promise<void> {
    if (StorageManager.isContextDead()) return;
    try {
      await this.storage.set(this.CACHE_KEY, this.notesCache);
    } catch (e) {}
  }

  private getCacheKey(username: string, mediaId: number): string {
    return `${username.toLowerCase()}_${mediaId}`;
  }

  private injectIconsIfMissing(mediaId: number): void {
    const followingSection = this.findFollowingSection();
    if (!followingSection) return;

    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]:not([data-au-comment-injected])'));
    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      const cacheKey = username ? this.getCacheKey(username, mediaId) : null;
      if (username && cacheKey && this.notesCache[cacheKey]) {
        this.injectIcon(link, username, mediaId, this.notesCache[cacheKey].notes);
      }
    });
  }

  private injectIcon(link: HTMLAnchorElement, username: string, mediaId: number, notes: string): void {
    if (link.hasAttribute('data-au-comment-injected')) return;
    const anchor = link.closest('.activity-entry, .user-status-row, .following-list-item') as HTMLElement || link;
    anchor.style.position = 'relative';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'comment-icon-ghost';
    iconContainer.innerHTML = `<span class="anilist-comment-icon">${this.ICON_SVG}</span>`;
    anchor.appendChild(iconContainer);

    const icon = iconContainer.querySelector('.anilist-comment-icon') as HTMLElement;
    iconContainer.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      this.tooltip.show(icon, { username, mediaId, notes, timestamp: Date.now() });
    });

    iconContainer.addEventListener('mouseleave', () => this.tooltip.onIconLeave());
    link.addEventListener('mouseenter', () => icon.classList.add('row-hover'));
    link.addEventListener('mouseleave', () => icon.classList.remove('row-hover'));
    link.setAttribute('data-au-comment-injected', 'true');
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
    const sidebar = document.querySelector('div.following, div[class*="following"], .following');
    if (sidebar) return sidebar as HTMLElement;
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
