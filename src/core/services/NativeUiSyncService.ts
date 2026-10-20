/**
 * @file NativeUiSyncService.ts
 * @description Synchronizes native AniList UI elements with extension-driven data changes
 * 
 * Listen for events like PROGRESS_UPDATED and scans the DOM for relevant 
 * native elements (cards, lists, headers) to update their text content 
 * without requiring a page refresh.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { INativeUiSyncService } from '@core/interfaces/INativeUiSyncService';

@injectable()
export class NativeUiSyncService implements INativeUiSyncService {
  private subscription: EventSubscription | null = null;
  private lifecycleSubscriptions: EventSubscription[] = [];
  private dimmed = new Map<HTMLElement, { opacity: string; filter: string; transition: string }>();
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) { }

  public init(): void {
    if (this.subscription) return;
    logger.info('[NativeUiSync] Initializing sync service');

    this.subscription = this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, (payload) => {
      if (payload) {
        const context = this.api.getContext?.();
        if (context && (!context.userId || payload.userId !== context.userId)) return;
        this.syncProgress(payload.mediaId, payload.progress, payload.status);
      }
    });
    const restore = () => { for (const element of this.dimmed.keys()) this.restoreDimming(element); };
    this.lifecycleSubscriptions.push(this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, restore));
    this.lifecycleSubscriptions.push(this.eventBus.on(EVENT_TYPES.PAGE_CHANGED, restore));
  }

  /**
   * Scans the DOM for any native AniList elements referring to mediaId and updates them
   */
  public syncProgress(mediaId: number, progress: number, status?: string): void {
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !Number.isSafeInteger(progress) || progress < 0) return;
    for (const element of this.dimmed.keys()) if (!element.isConnected) this.dimmed.delete(element);
    logger.debug(`[NativeUiSync] Syncing progress for mediaId ${mediaId} -> ${progress}`);

    // 1. Find all potential containers (cards, list rows)
    const selectors = [
      `.media-preview-card`, // Home page "In Progress"
      `.media-card`,        // Grid view
      `.entry.row`,          // List view (classic)
      `.list-item`           // List view (new)
    ];

    const containers = document.querySelectorAll(selectors.join(', '));

    containers.forEach(container => {
      // Check if this container refers to our mediaId
      const matches = [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].some(link => {
        try {
          const url = new URL(link.href, window.location.href);
          return url.origin === window.location.origin && this.matchesMedia(url.pathname, mediaId);
        }
        catch { return false; }
      });
      if (!matches) return;

      logger.debug(`[NativeUiSync] Found native container for mediaId ${mediaId}`, container);

      // 2. Update Progress Text
      // Case A: Simple .progress element (e.g. Home page cards)
      const progressEl = container.querySelector('.progress');
      if (progressEl && !progressEl.querySelector('input')) this.updateProgressText(progressEl, progress);

      // Case B: List view progress input
      const listProgressInput = container.querySelector('.progress input') as HTMLInputElement;
      if (listProgressInput) {
        listProgressInput.value = `${progress}`;
      }

      // Case D: Info hover detail text
      const infoContainer = container.querySelector('.info');
      if (infoContainer) {
        const walker = document.createTreeWalker(infoContainer, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if (/(Progress:\s*)\d+/.test(text.textContent || '')) {
            text.textContent = text.textContent!.replace(/(Progress:\s*)\d+/, `$1${progress}`);
            break;
          }
        }
      }

      // 3. Handle status change feedback
      if (status === MediaListStatus.COMPLETED) {
        const isCurrentTab = !!document.querySelector('.status-tab.active[href*="/watching"], .status-tab.active[href*="/reading"]');
        if (isCurrentTab || window.location.pathname.includes('/home')) {
          const element = container as HTMLElement;
          if (!this.dimmed.has(element)) this.dimmed.set(element, {
            opacity: element.style.opacity, filter: element.style.filter, transition: element.style.transition,
          });
          (container as HTMLElement).style.opacity = '0.4';
          (container as HTMLElement).style.filter = 'grayscale(1)';
          (container as HTMLElement).style.transition = 'all 0.5s ease';
          logger.debug(`[NativeUiSync] Dimming completed item ${mediaId}`);
        }
      } else if (status) {
        this.restoreDimming(container as HTMLElement);
      }
    });

    // 4. Update Media Page Header (if we are ON the media page)
    if (this.matchesMedia(window.location.pathname, mediaId)) {
      // Find the progress display in the status button or sidebar
      const headerProgress = document.querySelector('.entry-progress .progress, .list-status .progress, .status-button .progress');
      if (headerProgress) {
        this.updateProgressText(headerProgress, progress);
      }
    }
  }

  private matchesMedia(path: string, mediaId: number): boolean {
    return new RegExp(`^/(?:anime|manga)/${mediaId}(?:/|$)`).test(path);
  }

  private updateProgressText(element: Element, progress: number): void {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (text.parentElement?.closest('button, input, select, .au-progress-actions')) continue;
      if (/\d+/.test(text.textContent || '')) {
        text.textContent = text.textContent!.replace(/\d+/, String(progress));
        return;
      }
    }
  }

  private restoreDimming(element: HTMLElement): void {
    const original = this.dimmed.get(element);
    if (original) Object.assign(element.style, original);
    this.dimmed.delete(element);
  }

  public destroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    for (const subscription of this.lifecycleSubscriptions.splice(0)) subscription.unsubscribe();
    for (const element of this.dimmed.keys()) this.restoreDimming(element);
  }
}
