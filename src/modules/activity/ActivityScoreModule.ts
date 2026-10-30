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
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { ActivityService } from './ActivityService';
import type { ActivityScoreData } from './ActivityService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { isActivityId } from './ActivityResponse';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import '../../styles/activity-score.css';

const ENTRY_SELECTOR = '.activity-entry, .activity-anime, .activity-manga, .list.small';
const MEDIA_LINK_SELECTOR = 'a[href^="/anime/"], a[href^="/manga/"]';
const REPLY_SELECTOR = '.reply, .activity-replies, .replies';
interface EntryScoreState {
  key: string | null;
}
interface ScoreTarget {
  element: HTMLElement;
  state: EntryScoreState;
}

/** Composition root and module must agree about pages that support score badges. */
export function isActivityScoreRoute(path: string): boolean {
  if (path === '/' || /^\/home\/?$/.test(path) || /^\/user\/[^/]+(?:\/|$)/.test(path)) return true;
  const activity = /^\/activity\/([1-9]\d*)\/?$/.exec(path);
  if (activity) return isActivityId(Number(activity[1]));
  const media = getMediaRoute(path);
  return !!media && isActivityId(media.id) && /\/social\/?$/.test(path);
}

@injectable()
export class ActivityScoreModule extends BaseModule {
  private readonly OBSERVER_NAME = 'activity-score-continuous';
  private pendingQueue: Map<
    string,
    { userName: string; mediaId: number; elements: ScoreTarget[] }
  > = new Map();
  private entryStates = new WeakMap<HTMLElement, EntryScoreState>();
  private batchTimer: number | null = null;
  private observationVersion = 0;
  private initialized = false;
  private destroyed = false;

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
    if (this.initialized) return;
    this.initialized = true;
    this.destroyed = false;
    logger.info('ActivityScore: Initializing...');

    // Use centralized navigation events instead of polling
    this.onPageChange((event) => {
      void this.handlePageChange(event?.path).catch((error: unknown) =>
        logger.error('[ActivityScore] Page change handling failed', error)
      );
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      void this.handleAuthStateChanged().catch((error: unknown) =>
        logger.error('[ActivityScore] Auth state handling failed', error)
      );
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

  private async handlePageChange(eventPath: string | undefined): Promise<void> {
    const path = eventPath || window.location.pathname;
    this.stopObservation();
    if (this.shouldRun(path)) {
      await this.startObservation();
    }
  }

  private async handleAuthStateChanged(): Promise<void> {
    this.stopObservation();
    const version = this.observationVersion;
    try {
      await this.activityService.clearCache();
    } catch (error) {
      logger.error('[ActivityScore] Cache invalidation failed', error);
    }
    if (
      !this.destroyed &&
      version === this.observationVersion &&
      this.shouldRun(window.location.pathname)
    ) {
      await this.startObservation();
    }
  }

  private shouldRun(path: string): boolean {
    return isActivityScoreRoute(path);
  }

  private async startObservation(): Promise<void> {
    if (this.destroyed || !this.shouldRun(window.location.pathname)) return;
    const version = ++this.observationVersion;
    this.checkAndProcess();

    // Broaden search for activity containers to support profiles and social pages
    const container = await this.waitForElement(
      '.activity-feed-wrap, .activity-feed, .feed-container, .content > .grid-section',
      5000
    );
    if (version !== this.observationVersion) return;
    if (!container) {
      logger.warn('[ActivityScore] Activity container not found, observing body');
      this.registerObserver(
        this.OBSERVER_NAME,
        document.body,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] },
        () => {
          this.checkAndProcess();
        }
      );
    } else {
      this.registerObserver(
        this.OBSERVER_NAME,
        container.parentElement || container,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] },
        () => {
          this.checkAndProcess();
        }
      );
      logger.debug('[ActivityScore] Observing activity container');
    }

    this.checkAndProcess();
  }

  private stopObservation(): void {
    this.observationVersion++;
    this.cleanup();
    if (this.batchTimer) window.clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.pendingQueue.clear();
    this.entryStates = new WeakMap();
    document.querySelectorAll('.au-activity-rating').forEach((el) => el.remove());
    document
      .querySelectorAll('[data-au-score-enhanced]')
      .forEach((el) => el.removeAttribute('data-au-score-enhanced'));
  }

  private checkAndProcess(): void {
    if (this.destroyed || !this.shouldRun(window.location.pathname)) return;
    const entries = document.querySelectorAll<HTMLElement>(ENTRY_SELECTOR);

    entries.forEach((el) => {
      const entry = el;
      if (entry.parentElement?.closest(ENTRY_SELECTOR)) return;
      const info = this.extractActivityInfo(entry);
      const key = info ? `${info.userName}-${info.mediaId}` : null;
      const previous = this.entryStates.get(entry);
      const marker = entry.getAttribute('data-au-score-enhanced');
      if (
        previous?.key === key &&
        marker &&
        (marker !== 'true' || entry.querySelector('.au-activity-rating'))
      )
        return;
      entry.querySelectorAll('.au-activity-rating').forEach((badge) => badge.remove());
      const state: EntryScoreState = { key };
      this.entryStates.set(entry, state);
      entry.setAttribute('data-au-score-enhanced', 'pending');
      if (info) {
        const pairKey = `${info.userName}-${info.mediaId}`;
        if (!this.pendingQueue.has(pairKey)) {
          this.pendingQueue.set(pairKey, { ...info, elements: [] });
        }
        this.pendingQueue.get(pairKey)!.elements.push({ element: entry, state });
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
      const path = this.localPath(userLink.getAttribute('href'));
      userName = path ? this.profileName(path) : null;
    } else if (/^\/user\/[^/]+(?:\/|$)/.test(window.location.pathname)) {
      // Fallback: If on profile page, use username from URL
      userName = this.profileName(window.location.pathname);
    }

    if (!userName) return null;

    // 2. Find Media ID: only a single distinct work is attributable to the entry.
    // Text posts can embed many works, so ambiguous entries get no badge.
    const mediaIds = new Set<number>();
    for (const mediaLink of this.mediaLinks(entry)) {
      const path = this.localPath(mediaLink.getAttribute('href'));
      const media = path ? getMediaRoute(path) : null;
      if (media && isActivityId(media.id)) mediaIds.add(media.id);
    }
    if (mediaIds.size !== 1) return null;
    const [mediaId] = mediaIds;
    return { userName, mediaId };
  }

  /** Media links inside the entry, excluding those nested in reply sections. */
  private mediaLinks(entry: HTMLElement): HTMLAnchorElement[] {
    return Array.from(entry.querySelectorAll<HTMLAnchorElement>(MEDIA_LINK_SELECTOR)).filter(
      (link) => !this.isInsideReply(link, entry)
    );
  }

  private isInsideReply(link: HTMLElement, entry: HTMLElement): boolean {
    const reply = link.closest(REPLY_SELECTOR);
    return !!reply && reply !== entry && entry.contains(reply);
  }

  private localPath(href: string | null): string | null {
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      return url.origin === window.location.origin ? url.pathname : null;
    } catch {
      return null;
    }
  }

  private profileName(path: string): string | null {
    const match = /^\/user\/([^/]+)(?:\/|$)/.exec(path);
    if (!match) return null;
    try {
      const name = decodeURIComponent(match[1]);
      return name.trim() ? name : null;
    } catch {
      return null;
    }
  }

  private currentTarget(target: ScoreTarget): boolean {
    if (!target.element.isConnected || this.entryStates.get(target.element) !== target.state)
      return false;
    const info = this.extractActivityInfo(target.element);
    return !!info && `${info.userName}-${info.mediaId}` === target.state.key;
  }

  private releaseTarget(target: ScoreTarget): void {
    if (this.entryStates.get(target.element) !== target.state) return;
    target.element.querySelectorAll('.au-activity-rating').forEach((badge) => badge.remove());
    target.element.removeAttribute('data-au-score-enhanced');
    this.entryStates.delete(target.element);
  }

  private triggerBatch(): void {
    if (this.batchTimer) return;

    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = null;
      void this.processBatch();
    }, 1500); // 1.5s debounce for batching
  }

  private async processBatch(): Promise<void> {
    if (this.batchTimer !== null) window.clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (this.pendingQueue.size === 0) return;
    const version = this.observationVersion;

    const currentBatch = new Map(this.pendingQueue);
    this.pendingQueue.clear();

    let changed = false;
    for (const [key, data] of currentBatch) {
      data.elements = data.elements.filter((target) => {
        if (this.currentTarget(target)) return true;
        this.releaseTarget(target);
        changed = true;
        return false;
      });
      if (!data.elements.length) currentBatch.delete(key);
    }
    if (changed) this.checkAndProcess();
    const pairs = Array.from(currentBatch.values()).map((v) => ({
      userName: v.userName,
      mediaId: v.mediaId,
    }));
    if (!pairs.length || this.destroyed || !this.shouldRun(window.location.pathname)) return;

    try {
      const scores = await this.activityService.getScoresBatch(pairs);
      if (
        version !== this.observationVersion ||
        this.destroyed ||
        !this.shouldRun(window.location.pathname)
      )
        return;
      let reused = false;

      currentBatch.forEach((data, key) => {
        const scoreData = scores.get(key);
        data.elements.forEach((target) => {
          const el = target.element;
          if (!this.currentTarget(target)) {
            this.releaseTarget(target);
            reused = true;
            return;
          }
          if (!scores.has(key)) {
            el.removeAttribute('data-au-score-enhanced');
            return;
          }
          if (scoreData && scoreData.score > 0) {
            this.injectRatingUI(el, scoreData);
            el.setAttribute(
              'data-au-score-enhanced',
              el.querySelector('.au-activity-rating') ? 'true' : 'no-target'
            );
          } else {
            el.setAttribute('data-au-score-enhanced', 'no-score');
          }
        });
      });
      if (reused) this.checkAndProcess();
    } catch (e) {
      if (version !== this.observationVersion) return;
      currentBatch.forEach((data) => data.elements.forEach((target) => this.releaseTarget(target)));
      logger.error('[ActivityScore] processBatch failed', e);
    }
  }

  private injectRatingUI(entry: HTMLElement, scoreData: ActivityScoreData): void {
    if (entry.querySelector('.au-activity-rating')) return;

    const { score, format } = scoreData;
    const formattedScore = ScoreFormatter.format(score, format);
    const label = ScoreFormatter.getLabel(score);

    const badge = document.createElement('span');
    badge.className = `au-activity-rating au-rating--${label} au-format-${format.toLowerCase().replace(/_/g, '-')}`;
    badge.textContent = formattedScore;

    // Apply color from ScoreFormatter
    badge.style.color = ScoreFormatter.getColor(score);
    badge.style.borderColor = `${ScoreFormatter.getColor(score)}40`;
    badge.style.background = `${ScoreFormatter.getColor(score)}15`;

    // Target identification (same rule on feed and profile pages)
    // 1. List rows: right after the work title in `.status` (replies excluded).
    // 2. Text posts: right after the username link in the header, which is stable
    //    across AniList renders (the old `.title, .name, ...` union was not).
    // 3. Otherwise: the cover.
    const statusTitle = this.mediaLinks(entry).find((link) => !!link.closest('.status'));
    const userLink =
      entry.querySelector<HTMLElement>('a.name[href^="/user/"]') ??
      entry.querySelector<HTMLElement>('a[href^="/user/"]');

    const target = statusTitle ?? userLink;

    if (target) {
      // after() places the badge next to the link without nesting it inside
      target.after(badge);
      if (statusTitle) badge.classList.add('au-activity-rating--after-title');
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
    this.destroyed = true;
    this.initialized = false;
    this.stopObservation();
    document.querySelectorAll('.au-activity-rating').forEach((el) => el.remove());
    document
      .querySelectorAll('[data-au-score-enhanced]')
      .forEach((el) => el.removeAttribute('data-au-score-enhanced'));
    await super.destroy();
  }
}
