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
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';
import { AnimeEntry } from '@core/types';
import { TOKENS } from '@core/di/tokens';

@injectable()
export class CalendarSocialService {
  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService
  ) {
    // React to socialEnabled toggling from settings
    calendarStore.subscribeToSelector(
      state => state.preferences.socialEnabled,
      (curr, prev) => {
        if (curr === true && prev === false) {
          log.info('[CalendarSocial] Social features enabled, triggering fetch...');
          this.loadFriendActivity();
        }
      }
    );
  }
  /**
   * Load friend activity for current calendar entries
   */
  public async loadFriendActivity(): Promise<void> {
    const entries = calendarStore.getState().entries;
    if (entries.length === 0) return;

    log.info('[CalendarSocial] Fetching friend activity in batch...');
    
    const mediaIds = entries.map(e => e.mediaId);

    try {
      const socialMap = await this.socialService.getFriendActivityBatch(mediaIds);
      
      const updates = new Map<number, Partial<AnimeEntry>>();
      socialMap.forEach((activity: any[], mediaId: number) => {
        updates.set(mediaId, { friendActivity: activity });
      });

      calendarStore.updateEntriesBatch(updates);
      log.success(`[CalendarSocial] Activity loaded for ${socialMap.size} entries`);
    } catch (e) {
      log.error('[CalendarSocial] Failed to load social batch', e);
    }
  }
}
