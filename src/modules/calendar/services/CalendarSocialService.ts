import { injectable } from 'tsyringe';
import { SocialService } from '../../social/SocialService';
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';
import { AnimeEntry } from '@core/types';

@injectable()
export class CalendarSocialService {
  /**
   * Load friend activity for current calendar entries
   */
  public async loadFriendActivity(): Promise<void> {
    const entries = calendarStore.getState().entries;
    if (entries.length === 0) return;

    log.info('[CalendarSocial] Fetching friend activity in batch...');
    
    const mediaIds = entries.map(e => e.mediaId);
    const socialService = SocialService.getInstance();

    try {
      const socialMap = await socialService.getFriendActivityBatch(mediaIds);
      
      const updates = new Map<number, Partial<AnimeEntry>>();
      socialMap.forEach((activity, mediaId) => {
        updates.set(mediaId, { friendActivity: activity });
      });

      calendarStore.updateEntriesBatch(updates);
      log.success(`[CalendarSocial] Activity loaded for ${socialMap.size} entries`);
    } catch (e) {
      log.error('[CalendarSocial] Failed to load social batch', e);
    }
  }
}
