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
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { log } from '@core/logger';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { INativeUiSyncService } from '@core/interfaces/INativeUiSyncService';

@injectable()
export class NativeUiSyncService implements INativeUiSyncService {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) { }

  public init(): void {
    log.info('[NativeUiSync] Initializing sync service');

    this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, (payload) => {
      if (payload) {
        this.syncProgress(payload.mediaId, payload.progress, payload.status);
      }
    });
  }

  /**
   * Scans the DOM for any native AniList elements referring to mediaId and updates them
   */
  public syncProgress(mediaId: number, progress: number, status?: string): void {
    log.debug(`[NativeUiSync] Syncing progress for mediaId ${mediaId} -> ${progress}`);

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
      const links = container.querySelectorAll(`a[href*="/anime/${mediaId}"], a[href*="/manga/${mediaId}"]`);
      if (links.length === 0) return;

      log.debug(`[NativeUiSync] Found native container for mediaId ${mediaId}`, container);

      // 2. Update Progress Text
      // Case A: Simple .progress element (e.g. Home page cards)
      const progressEl = container.querySelector('.progress');
      if (progressEl && !progressEl.querySelector('input')) {
        const currentText = progressEl.textContent || '';
        if (currentText.includes('/')) {
          const parts = currentText.split('/');
          const total = parts[1].trim();
          // Keep whatever prefix was there (e.g. "Ep 12 / 24")
          const prefixMatch = parts[0].match(/^[^\d]*/);
          const prefix = prefixMatch ? prefixMatch[0] : '';
          progressEl.textContent = `${prefix}${progress} / ${total}`;
        } else {
          // If it's just a number, replace it but keep prefix if exists
          const prefixMatch = currentText.match(/^[^\d]*/);
          const prefix = prefixMatch ? prefixMatch[0] : '';
          progressEl.textContent = `${prefix}${progress}`;
        }
      }

      // Case B: List view progress input
      const listProgressInput = container.querySelector('.progress input') as HTMLInputElement;
      if (listProgressInput) {
        listProgressInput.value = `${progress}`;
      }

      // Case C: List view progress text (when not editing)
      const listProgressText = container.querySelector('.progress .content');
      if (listProgressText) {
        listProgressText.textContent = `${progress}`;
      }

      // Case D: Info hover detail text
      const infoContainer = container.querySelector('.info');
      if (infoContainer) {
        const html = infoContainer.innerHTML;
        if (html.includes('Progress:')) {
          // Robust regex to replace ONLY the number after "Progress: "
          infoContainer.innerHTML = html.replace(/(Progress:\s*)\d+/, `$1${progress}`);
        }
      }

      // 3. Handle status change feedback
      if (status === MediaListStatus.COMPLETED) {
        const isCurrentTab = !!document.querySelector('.status-tab.active[href*="/watching"], .status-tab.active[href*="/reading"]');
        if (isCurrentTab || window.location.pathname.includes('/home')) {
          (container as HTMLElement).style.opacity = '0.4';
          (container as HTMLElement).style.filter = 'grayscale(1)';
          (container as HTMLElement).style.transition = 'all 0.5s ease';
          log.debug(`[NativeUiSync] Dimming completed item ${mediaId}`);
        }
      }
    });

    // 4. Update Media Page Header (if we are ON the media page)
    if (window.location.pathname.includes(`/${mediaId}`)) {
      // Find the progress display in the status button or sidebar
      const headerProgress = document.querySelector('.entry-progress .progress, .list-status .progress, .status-button .progress');
      if (headerProgress) {
        const currentText = headerProgress.textContent || '';
        if (currentText.toLowerCase().includes('progress')) {
          headerProgress.textContent = `Progress: ${progress}`;
        } else {
          headerProgress.textContent = `${progress}`;
        }
      }
    }
  }
}
