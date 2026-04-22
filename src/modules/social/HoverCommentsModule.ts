/**
 * Hover Comments Module - Simplified Version
 * No caching - fetches fresh data on each page load
 */

import { CommentTooltip } from './CommentTooltip';
import { log } from '@core/logger';
import type { IModule } from '@core/interfaces/IModule';
// CSS will be loaded dynamically after page stabilization

const ICON_COMMENT_SVG = `<svg class="au-comment-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M512 240c0 114.9-114.6 208-256 208c-37.1 0-72.3-6.4-104.1-17.9c-11.9 8.7-31.3 20.6-54.3 30.6C73.6 471.1 44.7 480 16 480c-6.5 0-12.3-3.9-14.8-9.9c-2.5-6-1.1-12.8 3.4-17.4l4.1-4.1c10.1-10.1 16.6-23.3 18.2-38.1C11.2 367.1 0 306.7 0 240C0 125.1 114.6 32 256 32s256 93.1 256 208z"/></svg>`;

// Hover Comments CSS - Injected dynamically after page load (from original working code)
const HOVER_COMMENTS_CSS = `
/* Make links relative so icons can be positioned absolutely */
div.following a, div[class="following"] a, div[class^="following"] a { position: relative !important; }

/* Icon container - absolutely positioned */
.comment-icon-column {
  position: absolute !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer;
  pointer-events: auto;
  z-index: 10;
  top: 50%;
  transform: translateY(-50%);
  right: 100px;
  width: 20px;
  height: 20px;
  background: transparent;
  border-radius: 50%;
}
.comment-icon-column:hover { background-color: rgba(61, 180, 242, 0.1); }

/* Icon itself */
.anilist-comment-icon {
  color: #8f98a6;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.8;
  vertical-align: middle;
  transition: color 0.2s ease, opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease !important;
}
.anilist-comment-icon.row-hover { color: #3db4f2 !important; }
.comment-icon-column:hover .anilist-comment-icon {
  color: #3db4f2;
  opacity: 1;
  transform: scale(1.2);
  filter: drop-shadow(0 0 2px rgba(61, 180, 242, 0.5));
}
.au-comment-svg { width: 1em; height: 1em; vertical-align: -0.125em; }

/* Tooltip - positioned in right column */
#anilist-tooltip {
  width: 275px;
  max-height: 500px;
  overflow-y: auto;
  position: fixed;
  z-index: 10000;
  background: var(--cal-anime-bg);
  backdrop-filter: blur(10px);
  color: var(--cal-text);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(61, 180, 242, 0.1);
  border-radius: 6px;
  border-left: 3px solid var(--cal-blue);
  padding: 12px;
  font-size: 13px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.3s ease, visibility 0.3s ease !important;
}
#anilist-tooltip.visible { opacity: 1; visibility: visible; pointer-events: auto; }

/* Custom scrollbar - azzurrino style */
#anilist-tooltip::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
#anilist-tooltip::-webkit-scrollbar-track {
  background: var(--cal-bg-light);
  border-radius: 3px;
}
#anilist-tooltip::-webkit-scrollbar-thumb {
  background-color: var(--cal-blue);
  border-radius: 3px;
  transition: background-color 0.2s ease;
}
#anilist-tooltip::-webkit-scrollbar-thumb:hover {
  background-color: var(--cal-blue-bright);
}
#anilist-tooltip::-webkit-scrollbar-button {
  display: none;
}

.tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--cal-border);
  padding-bottom: 8px;
  margin-bottom: 8px;
}
.tooltip-user { font-weight: bold; color: var(--cal-blue); }
.tooltip-actions { display: flex; align-items: center; gap: 8px; }
.tooltip-age { font-size: 11px; opacity: 0.7; }
.tooltip-content { word-wrap: break-word; line-height: 1.5; white-space: pre-line; }
.tooltip-refresh-btn {
  background: rgba(61, 180, 242, 0.2);
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 11px;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 75px;
  text-align: center;
}
.tooltip-refresh-btn:hover { background: rgba(61, 180, 242, 0.4); }
`;

export class HoverCommentsModule implements IModule {
  private tooltip: CommentTooltip;
  private pollingInterval: any = null;
  private processedPages = new Set<number>();
  private isProcessing = false;
  private cssLoaded = false;
  private commentsCache: Record<string, string> = {}; // Temporary cache per page load
  private lastUrl: string = '';

  constructor() {
    this.tooltip = new CommentTooltip({
      onRefresh: () => {
        // Refresh is handled automatically on page reload
        window.location.reload();
      },
    });
  }

  public async init(): Promise<void> {
    log.info('Hover Comments: Initializing (no cache mode)...');

    // Wait for the absolute end of the loading process
    const startAfterWait = () => {
      setTimeout(() => {
        try {
          this.tooltip.mount(document.body);
          this.startPolling();
        } catch (err) {
          log.error('Initialization failed', err);
        }
      }, 3000); // 3 seconds safety margin
    };

    if (document.readyState === 'complete') {
      startAfterWait();
    } else {
      window.addEventListener('load', () => startAfterWait());
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'hoverComments';
  }

  /**
   * Periodic Polling instead of MutationObserver (Zero performance impact)
   */
  private startPolling(): void {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    
    log.info('Starting Low-Impact Polling (Every 3s)');
    
    // Scan immediately once, then every 3s
    this.processPageSafely();
    this.pollingInterval = setInterval(() => {
      this.processPageSafely();
    }, 3000);
  }

  private async processPageSafely(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.processPage();
    } catch (err) {
      log.debug('Scan skipped', err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processPage(): Promise<void> {
    const currentUrl = window.location.href;

    // Reset everything if URL changed (handles navigation between tabs like /social, /characters, etc.)
    if (currentUrl !== this.lastUrl) {
      log.info(`URL changed from ${this.lastUrl} to ${currentUrl} - resetting`);
      this.lastUrl = currentUrl;
      this.processedPages.clear();
      this.commentsCache = {};
    }

    const media = this.extractMediaFromUrl();
    if (!media) {
      log.debug('Not on a media page, skipping');
      return;
    }

    // Skip if already processed this page
    if (this.processedPages.has(media.id)) {
      return;
    }

    const followingSection = this.findFollowingSection();
    if (!followingSection) {
      log.debug('Following section not found');
      return;
    }

    // Load CSS only when we are sure we are on a relevant page
    this.ensureCSS();

    // Find ALL user links directly
    const userLinks = Array.from(followingSection.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]'));
    log.debug(`Found ${userLinks.length} user links to process`);

    if (userLinks.length === 0) return;

    // Extract usernames
    const usernames = userLinks
      .map(link => this.extractUsername(link))
      .filter((username): username is string => username !== null);

    log.info(`Fetching comments for ${usernames.length} users...`);

    // Fetch all comments in parallel (no cache!)
    const comments = await this.fetchAllComments(usernames, media.id);

    log.info(`Received ${Object.keys(comments).length} comments`);

    // Inject icons only for users with comments
    userLinks.forEach(link => {
      const username = this.extractUsername(link);
      if (username && comments[username]) {
        this.injectIcon(link, username, media.id, comments[username]);
      }
    });

    // Mark this page as processed
    this.processedPages.add(media.id);
  }

  /**
   * Fetch all comments in parallel
   */
  private async fetchAllComments(usernames: string[], mediaId: number): Promise<Record<string, string>> {
    const promises = usernames.map(username =>
      this.fetchUserComment(username, mediaId)
        .then(notes => ({ username, notes }))
        .catch(err => {
          log.debug(`Failed to fetch comment for ${username}:`, err);
          return { username, notes: '' };
        })
    );

    const results = await Promise.all(promises);

    // Build cache and filter out empty comments
    const comments: Record<string, string> = {};
    results.forEach(({ username, notes }) => {
      if (notes && notes.trim()) {
        comments[username] = notes;
        this.commentsCache[`${username}_${mediaId}`] = notes;
      }
    });

    return comments;
  }

  /**
   * Fetch a single user's comment
   */
  private async fetchUserComment(username: string, mediaId: number): Promise<string> {
    const query = `
      query ($userName: String, $mediaId: Int) {
        MediaList(userName: $userName, mediaId: $mediaId) {
          notes
        }
      }
    `;

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { userName: username, mediaId },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error('GraphQL errors');
    }

    return data?.data?.MediaList?.notes || '';
  }

  private injectIcon(link: HTMLAnchorElement, username: string, media_id: number, comment: string): void {
    // Check if icon already exists
    if (link.querySelector('.comment-icon-column')) return;

    // Create icon container (like original code)
    const iconContainer = document.createElement('div');
    iconContainer.className = 'comment-icon-column';
    iconContainer.setAttribute('data-user', username);
    iconContainer.innerHTML = `<span class="anilist-comment-icon">${ICON_COMMENT_SVG}</span>`;

    // Find score element to insert before it (like original code)
    const scoreEl = link.querySelector('div[class*="score"]');
    if (scoreEl) {
      scoreEl.parentNode!.insertBefore(iconContainer, scoreEl);
    } else {
      link.appendChild(iconContainer);
    }

    const icon = iconContainer.querySelector('.anilist-comment-icon') as HTMLElement;

    // Hover events on icon
    iconContainer.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      // Show tooltip with the comment we already have
      this.tooltip.show(icon, {
        username,
        mediaId: media_id,
        notes: comment,
        timestamp: Date.now(),
      });
    });

    iconContainer.addEventListener('mouseleave', () => {
      // Don't hide immediately, wait 2 seconds
      this.tooltip.onIconLeave();
    });

    // Row hover effect
    link.addEventListener('mouseenter', () => icon.classList.add('row-hover'));
    link.addEventListener('mouseleave', () => icon.classList.remove('row-hover'));
  }

  private ensureCSS(): void {
    if (this.cssLoaded) return;
    this.cssLoaded = true;

    log.info('Dynamically injecting CSS after hydration stabilization');

    // Inject CSS as inline <style> tag only after page is stable
    const style = document.createElement('style');
    style.id = 'au-hover-comments-css';
    style.textContent = HOVER_COMMENTS_CSS;
    document.head.appendChild(style);
  }

  private extractUsername(link: HTMLAnchorElement): string | null {
    const href = link.getAttribute('href');
    if (!href) return null;
    return href.replace('/user/', '').replace(/\/$/, '');
  }

  private extractMediaFromUrl(): { id: number; type: string } | null {
    const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
    if (match && match[2]) {
      return { id: parseInt(match[2]), type: match[1].toUpperCase() };
    }
    return null;
  }

  private findFollowingSection(): HTMLElement | null {
    const selectors = ['div.following', 'div[class*="following"]', '.following'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        log.debug(`Found following section with selector: ${sel}`);
        return el as HTMLElement;
      }
    }
    log.warn('Following section not found with any selector');
    return null;
  }

  // Debug method exposed to console
  public debugDOM(): void {
    log.info('=== HOVER COMMENTS DEBUG ===');

    const media = this.extractMediaFromUrl();
    log.info('Media:', media);

    const following = this.findFollowingSection();
    log.info('Following section:', following);

    if (following) {
      const userLinks = following.querySelectorAll('a[href^="/user/"]');
      log.info(`User links found: ${userLinks.length}`);

      userLinks.forEach((link, i) => {
        const username = this.extractUsername(link as HTMLAnchorElement);
        log.info(`Link ${i}:`, { link, username, href: link.getAttribute('href') });
      });
    }

    log.info('Comments cache:', this.commentsCache);
    log.info('Processed pages:', this.processedPages);
  }
}
