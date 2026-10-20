/**
 * @file CalendarSocialService.ts
 * @description Loads friend activity data for calendar anime entries
 *
 * Uses SocialService.getFriendActivityBatch() to fetch which friends
 * are watching each anime in the calendar, then attaches the results
 * to AnimeEntry.friendActivity for avatar overlay rendering.
 *
 * @see SocialService.ts for the batch GraphQL fetching
 * @see AnimeCard.ts for the social bubble UI
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import { SocialService } from '../../social/SocialService';
import { CalendarStore } from '../CalendarStore';
import { logger } from '@core/logger';
import { AnimeEntry } from '@core/types';
import { TOKENS } from '@core/di/tokens';

@injectable()
export class CalendarSocialService {
  private loadVersion = 0;
  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.CalendarStore) private calendarStore: CalendarStore
  ) {
    // React to social toggles from settings
    this.calendarStore.subscribeToSelector(
      (state) => ({
        enabled: state.preferences.socialEnabled,
        showAvatars: state.preferences.socialShowAvatars
      }),
      (curr, prev) => {
        this.loadVersion++;
        const becameEnabled = curr.enabled && !prev.enabled;
        const avatarsActivated = curr.enabled && curr.showAvatars && !prev.showAvatars;

        if (becameEnabled || avatarsActivated) {
          logger.info('[CalendarSocial] Social settings changed, triggering fetch...');
          void this.loadFriendActivity().catch((error: unknown) => logger.error('[CalendarSocial] Friend activity refresh failed', error));
        }
      }
    );
  }
  /**
   * Load friend activity for current calendar entries
   */
  public async loadFriendActivity(): Promise<void> {
    const version = ++this.loadVersion;
    const entries = this.calendarStore.getState().entries;
    if (entries.length === 0) return;

    logger.info('[CalendarSocial] Fetching friend activity in batch...');
    
    const mediaIds = entries.map((e: AnimeEntry) => e.mediaId);

    try {
      const socialMap = await this.socialService.getFriendActivityBatch(mediaIds);
      
      const state = this.calendarStore.getState();
      if (version !== this.loadVersion || state.entries !== entries || !state.preferences.socialEnabled) return;
      const updates = new Map<number, Partial<AnimeEntry>>();
      socialMap.forEach((activity, mediaId) => {
        updates.set(mediaId, { friendActivity: activity });
      });

      this.calendarStore.updateEntriesBatch(updates);
      logger.success(`[CalendarSocial] Activity loaded for ${socialMap.size} entries. Total updates: ${updates.size}`);
    } catch (e: unknown) {
      logger.error('[CalendarSocial] Failed to load social batch', e);
    }
  }
}
