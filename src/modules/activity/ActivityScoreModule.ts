/**
 * @file ActivityScoreModule.ts
 * @description Injects user-specific media ratings into activity feed entries
 *
 * Scans activity feed entries for user-media pairs, batches score
 * lookups via ActivityService, and injects formatted score badges
 * into the DOM. Uses debouncing (1.5s) to batch rapid DOM changes.
 *
 * @see ActivityService.ts for batched score fetching
 * @see ScoreFormatter.ts for display format conversion
 * @see docs/MODULES.md#4-activity-score-module
 */

import { injectable, inject } from 'tsyringe';
import { log } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { ActivityService, ActivityScoreData } from './ActivityService';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import '../../styles/activity-score.css';

@injectable()
export class ActivityScoreModule extends BaseModule {
  private readonly OBSERVER_NAME = 'activity-score-continuous';
  private pendingQueue: Map<string, { userName: string; mediaId: number; elements: HTMLElement[] }> = new Map();
  private batchTimer: number | null = null;

  constructor(
    @inject(TOKENS.ActivityService) private activityService: ActivityService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the module
   */
  public async init(): Promise<void> {
    log.info('ActivityScore: Initializing...');

    // Use centralized navigation events instead of polling
    this.onPageChange(async (event) => {
      const path = event?.path || window.location.pathname;
      if (this.shouldRun(path)) {
        await this.startObservation();
      } else {
        this.stopObservation();
      }
    });

    if (this.shouldRun(window.location.pathname)) {
      await this.startObservation();
    }
  }

  /**
   * Get module name
   */
  public getName(): string {
    return 'activityScore';
  }

  private shouldRun(path: string): boolean {
    return path === '/' || path === '/home' || path.includes('/user/') || path.includes('/social');
  }

  private async startObservation(): Promise<void> {
    this.checkAndProcess();

    // Broaden search for activity containers to support profiles and social pages
    const container = await this.waitForElement('.activity-feed-wrap, .activity-feed, .feed-container, .content > .grid-section', 5000);
    if (!container) {
      log.warn('[ActivityScore] Activity container not found, observing body');
      this.registerObserver(this.OBSERVER_NAME, document.body, { childList: true, subtree: true }, () => {
        this.checkAndProcess();
      });
    } else {
      this.registerObserver(this.OBSERVER_NAME, container, { childList: true, subtree: true }, () => {
        this.checkAndProcess();
      });
      log.debug('[ActivityScore] Observing activity container');
    }

    this.checkAndProcess();
  }

  private stopObservation(): void {
    this.suspendObserver(this.OBSERVER_NAME);
    if (this.batchTimer) window.clearTimeout(this.batchTimer);
  }

  private checkAndProcess(): void {
    // Enhanced selector to find all possible activity blocks, including profile list items
    const entries = document.querySelectorAll('.activity-entry:not([data-au-score-enhanced]), .activity-anime:not([data-au-score-enhanced]), .activity-manga:not([data-au-score-enhanced]), .list.small:not([data-au-score-enhanced])');

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
        entry.setAttribute('data-au-score-enhanced', 'skipped');
      }
    });
  }

  private extractActivityInfo(entry: HTMLElement): { userName: string; mediaId: number } | null {
    // 1. Find User Name
    let userName: string | null = null;
    const userLink = entry.querySelector('a[href^="/user/"]');
    
    if (userLink) {
      userName = userLink.getAttribute('href')?.replace('/user/', '').replace(/\//g, '') || null;
    } else if (window.location.pathname.startsWith('/user/')) {
      // Fallback: If on profile page, use username from URL
      userName = window.location.pathname.split('/')[2];
    }

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
        const scoreData = scores.get(key);
        data.elements.forEach(el => {
          if (scoreData && scoreData.score > 0) {
            this.injectRatingUI(el, scoreData);
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

  private injectRatingUI(entry: HTMLElement, scoreData: ActivityScoreData): void {
    if (entry.querySelector('.au-activity-rating')) return;

    const { score, format } = scoreData;
    const formattedScore = ScoreFormatter.format(score, format);
    const label = ScoreFormatter.getLabel(score);

    const badge = document.createElement('span');
    badge.className = `au-activity-rating au-rating--${label} au-format-${format.toLowerCase().replace(/_/g, '-')}`;
    badge.innerHTML = formattedScore;

    // Apply color from ScoreFormatter
    badge.style.color = ScoreFormatter.getColor(score);
    badge.style.borderColor = `${ScoreFormatter.getColor(score)}40`;
    badge.style.background = `${ScoreFormatter.getColor(score)}15`;

    // Target identification
    const isProfile = window.location.pathname.includes('/user/');
    const mediaLinks = entry.querySelectorAll('a[href^="/anime/"], a[href^="/manga/"]');
    const lastLink = mediaLinks[mediaLinks.length - 1];
    const generalTitle = entry.querySelector('.title, .name, .details .title, .content .title');
    
    const target = isProfile ? (lastLink || generalTitle) : generalTitle;

    if (target) {
      if (isProfile) {
        // Use after() to put it right after the link/text without being inside it
        (target as HTMLElement).after(badge);
        badge.style.marginLeft = '8px';
        badge.style.display = 'inline-flex';
        badge.style.verticalAlign = 'middle';
      } else {
        target.insertAdjacentElement('afterend', badge);
      }
      entry.setAttribute('data-au-score-enhanced', 'true');
    } else {
      // Fallback to cover
      const cover = entry.querySelector('.cover, .image, [class*="image"], [class*="cover"]');
      if (cover) {
        (cover as HTMLElement).style.position = 'relative';
        cover.appendChild(badge);
        entry.setAttribute('data-au-score-enhanced', 'true');
      } else {
        entry.setAttribute('data-au-score-enhanced', 'no-target');
      }
    }
  }

  public override async destroy(): Promise<void> {
    this.stopObservation();
    document.querySelectorAll('.au-activity-rating').forEach(el => el.remove());
    document.querySelectorAll('[data-au-score-enhanced]').forEach(el => el.removeAttribute('data-au-score-enhanced'));
    await super.destroy();
  }
}
