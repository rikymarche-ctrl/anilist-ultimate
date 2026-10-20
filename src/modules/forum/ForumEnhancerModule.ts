/**
 * @file ForumEnhancerModule.ts
 * @description Adds direct media page links to forum thread title tags
 *
 * Scans forum thread lists for media tags in thread titles and
 * converts them into clickable links pointing to the corresponding
 * AniList media page.
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @see docs/MODULES.md#12-forum-enhancer-module
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { mutationsMatchSelector, type SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { parseWebUrl } from '@core/utils/WebUrl';
import '../../styles/forum-enhancer.css';

@injectable()
export class ForumEnhancerModule extends BaseModule {
  private readonly OBSERVER_NAME = 'forum-enhancer-continuous';
  private active = false;
  private version = 0;
  private readonly titles = new Map<HTMLElement, HTMLAnchorElement>();

  constructor(
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    if (this.active) return;
    this.active = true;
    logger.info('ForumEnhancer: Initializing...');

    // Use centralized navigation events instead of polling
    this.onPageChange((event) => {
      if (!this.active) return;
      const path = event?.path || window.location.pathname;
      if (this.shouldRun(path)) {
        this.startObservation();
      } else {
        this.stopObservation();
      }
    });

    if (this.shouldRun(window.location.pathname)) {
      this.startObservation();
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'forumEnhancer';
  }

  private shouldRun(path: string): boolean {
    return /^\/forum\/thread\/\d+(?:\/|$)/.test(path) || path === '/' || path === '/home';
  }

  private startObservation(): void {
    this.stopObservation();
    if (!this.active || !this.shouldRun(window.location.pathname)) return;
    const version = this.version;
    this.checkAndProcess();
    this.sharedObserver.register(this.OBSERVER_NAME, () => {
      if (this.active && version === this.version && this.shouldRun(window.location.pathname)) this.checkAndProcess();
    }, undefined, mutationsMatchSelector('.forum-thread h1.title, .forum-thread .category.media, .au-media-link-btn'));
  }

  private releaseTitle(title: HTMLElement, link: HTMLAnchorElement): void {
    if (link.parentElement === title) {
      while (link.firstChild) title.insertBefore(link.firstChild, link);
      link.remove();
    }
    if (title.getAttribute('data-au-enhanced') === 'true') title.removeAttribute('data-au-enhanced');
    this.titles.delete(title);
  }

  private stopObservation(): void {
    this.version++;
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    for (const [title, link] of this.titles) this.releaseTitle(title, link);
  }

  private checkAndProcess(): void {
    const mediaHref = this.getMediaHref();
    for (const [title, link] of this.titles) {
      // Rebuild the link when its media target changed or vanished, so the title never points at a stale media page.
      if (!title.isConnected || link.parentElement !== title || link.getAttribute('href') !== mediaHref) this.releaseTitle(title, link);
    }
    // 1. Process Forum Thread Title
    if (window.location.pathname.includes('/forum/thread')) {
      this.enhanceTitle();
    }

    // 2. Clear out any old buttons if they exist
    document.querySelectorAll('.au-media-link-btn').forEach(btn => btn.remove());
  }

  /**
   * Turn the forum thread title into a direct media link
   */
  private enhanceTitle(): void {
    const titleEl = document.querySelector<HTMLElement>('.forum-thread h1.title:not([data-au-enhanced])');
    if (!titleEl) return;

    const mediaHref = this.getMediaHref();
    if (!mediaHref) return;

    titleEl.setAttribute('data-au-enhanced', 'true');
    
    const a = document.createElement('a');
    a.href = mediaHref;
    a.className = 'au-title-link';
    this.titles.set(titleEl, a);

    // Move all children to the link
    while (titleEl.firstChild) {
      a.appendChild(titleEl.firstChild);
    }
    
    titleEl.appendChild(a);
    logger.info(`[ForumEnhancer] Linked thread title to ${mediaHref}`);
  }

  /**
   * Helper to find media href from tags
   */
  private getMediaHref(): string | null {
    const tag = document.querySelector('.forum-thread .category.media');
    if (!tag) return null;

    const mediaLink = tag.querySelector('a');
    const href = mediaLink?.getAttribute('href');

    if (href) {
      const url = parseWebUrl(href);
      const match = url && url.hostname === 'anilist.co' && url.pathname.match(/^\/(anime|manga)\/([1-9]\d*)(?:\/|$)/);
      if (match && Number(match[2]) <= 2147483647) return `/${match[1]}/${match[2]}`;
      return null;
    }

    const parentHref = tag.getAttribute('href');
    const parent = parseWebUrl(parentHref);
    const mediaId = parent?.hostname === 'anilist.co' ? parent.searchParams.get('media') : null;
    const mediaMatch = mediaId && /^[1-9]\d*$/.test(mediaId) && Number(mediaId) <= 2147483647 ? mediaId : null;
    if (mediaMatch) {
      const id = mediaMatch;
      const isAnime = tag.classList.contains('ANIME');
      return `/${isAnime ? 'anime' : 'manga'}/${id}`;
    }

    return null;
  }

  public override async destroy(): Promise<void> {
    this.active = false;
    this.stopObservation();
    document.querySelectorAll('.au-media-link-btn').forEach(btn => btn.remove());
    await super.destroy();
  }
}
