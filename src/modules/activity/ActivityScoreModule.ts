/**
 * Activity Score Module
 * Injects user ratings into activity feed entries
 */

import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { ActivityService } from './ActivityService';
import '../../styles/activity-score.css';

export class ActivityScoreModule extends BaseModule {
  private activityService: ActivityService;
  private readonly OBSERVER_NAME = 'activity-score-continuous';
  private pendingQueue: Map<string, { userName: string; mediaId: number; elements: HTMLElement[] }> = new Map();
  private batchTimer: number | null = null;

  constructor() {
    super();
    this.activityService = ActivityService.getInstance();
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ActivityScore: Initializing...');

    this.watchPageNavigation((path) => {
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

  private shouldRun(path: string): boolean {
    return path === '/' || path === '/home' || path.includes('/user/');
  }

  private startObservation(): void {
    this.checkAndProcess();

    this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
      this.checkAndProcess();
    });
  }

  private stopObservation(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    if (this.batchTimer) window.clearTimeout(this.batchTimer);
  }

  private checkAndProcess(): void {
    // Select all activity entries that haven't been enhanced yet
    const entries = document.querySelectorAll('.activity-entry:not([data-au-score-enhanced]), .activity-anime:not([data-au-score-enhanced]), .activity-manga:not([data-au-score-enhanced])');
    
    entries.forEach(el => {
      const entry = el as HTMLElement;
      entry.setAttribute('data-au-score-enhanced', 'pending');

      const info = this.extractActivityInfo(entry);
      if (info) {
        const key = `${info.userName}-${info.mediaId}`;
        if (!this.pendingQueue.has(key)) {
          this.pendingQueue.set(key, { ...info, elements: [] });
        }
        this.pendingQueue.get(key)!.elements.push(entry);
        this.triggerBatch();
      } else {
        // Mark as failed/skipped so we don't re-process
        entry.setAttribute('data-au-score-enhanced', 'skipped');
      }
    });
  }

  private extractActivityInfo(entry: HTMLElement): { userName: string; mediaId: number } | null {
    // 1. Find User Name
    const userLink = entry.querySelector('a[href^="/user/"]');
    if (!userLink) return null;
    const userName = userLink.getAttribute('href')?.replace('/user/', '').replace(/\//g, '');
    if (!userName) return null;

    // 2. Find Media ID
    const mediaLink = entry.querySelector('a[href^="/anime/"], a[href^="/manga/"]');
    if (!mediaLink) return null;
    const href = mediaLink.getAttribute('href') || '';
    const match = href.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return null;
    const mediaId = parseInt(match[2], 10);

    return { userName, mediaId };
  }

  private triggerBatch(): void {
    if (this.batchTimer) return;

    this.batchTimer = window.setTimeout(() => {
      this.processBatch();
      this.batchTimer = null;
    }, 1500); // 1.5s debounce for batching
  }

  private async processBatch(): Promise<void> {
    if (this.pendingQueue.size === 0) return;

    const currentBatch = new Map(this.pendingQueue);
    this.pendingQueue.clear();

    const pairs = Array.from(currentBatch.values()).map(v => ({ userName: v.userName, mediaId: v.mediaId }));
    
    try {
      const scores = await this.activityService.getScoresBatch(pairs);
      
      currentBatch.forEach((data, key) => {
        const score = scores.get(key);
        data.elements.forEach(el => {
          if (score !== null && score !== undefined && score > 0) {
            this.injectRatingUI(el, score);
            el.setAttribute('data-au-score-enhanced', 'true');
          } else {
            el.setAttribute('data-au-score-enhanced', 'no-score');
          }
        });
      });
    } catch (e) {
      log.error('[ActivityScore] processBatch failed', e);
    }
  }

  private injectRatingUI(entry: HTMLElement, score: number): void {
    if (entry.querySelector('.au-activity-rating')) return;

    const badge = document.createElement('span');
    badge.className = `au-activity-rating ${this.getColorClass(score)}`;
    badge.textContent = `${score}`;

    // Target the title link
    const title = entry.querySelector('.title');
    if (title) {
      title.insertAdjacentElement('afterend', badge);
    } else {
      // Fallback to cover if title not found (unlikely for ListActivity)
      const cover = entry.querySelector('.cover, .image, [class*="image"], [class*="cover"]');
      if (cover) {
        (cover as HTMLElement).style.position = 'relative';
        cover.appendChild(badge);
      }
    }
  }

  private getColorClass(rating: number): string {
    if (rating >= 90) return 'au-rating--perfect';
    if (rating >= 80) return 'au-rating--excellent';
    if (rating >= 70) return 'au-rating--high';
    if (rating >= 60) return 'au-rating--good';
    if (rating >= 50) return 'au-rating--medium';
    if (rating >= 40) return 'au-rating--poor';
    return 'au-rating--terrible';
  }

  public override destroy(): void {
    this.stopObservation();
    document.querySelectorAll('.au-activity-rating').forEach(el => el.remove());
    document.querySelectorAll('[data-au-score-enhanced]').forEach(el => el.removeAttribute('data-au-score-enhanced'));
  }
}
