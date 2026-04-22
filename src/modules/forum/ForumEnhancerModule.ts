/**
 * Forum Enhancer Module
 * Adds direct links to media pages from forum tags
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import '../../styles/forum-enhancer.css';

export class ForumEnhancerModule extends BaseModule {
  private readonly OBSERVER_NAME = 'forum-enhancer-continuous';

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ForumEnhancer: Initializing...');

    // Use centralized navigation events instead of polling
    this.onPageChange((event) => {
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
    return path.includes('/forum/thread') || path === '/' || path === '/home';
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });
  }

  private stopObservation(): void {
    this.suspendObserver(this.OBSERVER_NAME);
  }

  private checkAndProcess(): void {
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
    const titleEl = document.querySelector('.forum-thread h1.title:not([data-au-enhanced])');
    if (!titleEl) return;

    const mediaHref = this.getMediaHref();
    if (!mediaHref) return;

    titleEl.setAttribute('data-au-enhanced', 'true');
    
    // Create link wrapper
    const a = document.createElement('a');
    a.href = mediaHref;
    a.className = 'au-title-link';
    a.innerHTML = titleEl.innerHTML;
    
    titleEl.innerHTML = '';
    titleEl.appendChild(a);
    log.info(`[ForumEnhancer] Linked thread title to ${mediaHref}`);
  }

  /**
   * Helper to find media href from tags
   */
  private getMediaHref(): string | null {
    const tag = document.querySelector('.forum-thread .category.media');
    if (!tag) return null;

    const mediaLink = tag.querySelector('a');
    const href = mediaLink?.getAttribute('href');

    if (href) return href;

    const parentHref = tag.getAttribute('href');
    const mediaMatch = parentHref?.match(/media=(\d+)/);
    if (mediaMatch) {
      const id = mediaMatch[1];
      const isAnime = tag.classList.contains('ANIME');
      return `/${isAnime ? 'anime' : 'manga'}/${id}`;
    }

    return null;
  }

  public override async destroy(): Promise<void> {
    this.stopObservation();
    
    // Unwrap title
    const linkedTitle = document.querySelector('.au-title-link');
    if (linkedTitle && linkedTitle.parentNode) {
      const h1 = linkedTitle.parentNode as HTMLElement;
      h1.innerHTML = linkedTitle.innerHTML;
      h1.removeAttribute('data-au-enhanced');
    }

    document.querySelectorAll('.au-media-link-btn').forEach(btn => btn.remove());
  }
}
