import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CalendarService } from '../CalendarService';
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';

@injectable()
export class CalendarDataService {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.CalendarService) private calendarService: CalendarService
  ) {}

  /**
   * Load airing schedule for the user
   */
  public async loadSchedule(userId: number): Promise<void> {
    try {
      calendarStore.setLoading(true);
      
      // Use the injected calendarService
      const entries = await this.calendarService.fetchAiringSchedule(userId);
      calendarStore.setEntries(entries);

      log.success(`[CalendarData] Loaded ${entries.length} anime entries`);

      // Emit global event
      this.eventBus.emit(EVENT_TYPES.CALENDAR_LOADED, {
        scheduleCount: entries.length,
        progressCount: entries.filter((e: any) => e.progress !== undefined).length,
        timestamp: new Date(),
      });
    } catch (error) {
      log.error('[CalendarData] Failed to load schedule', error);
      calendarStore.setError(error as Error);
      throw error;
    } finally {
      calendarStore.setLoading(false);
    }
  }

  /**
   * Mark an episode as watched
   */
  public async updateProgress(mediaId: number): Promise<number | null> {
    try {
      const entry = calendarStore.getState().entries.find(e => e.mediaId === mediaId);
      if (!entry) throw new Error('Entry not found');

      const newProgress = (entry.progress || 0) + 1;
      await this.calendarService.updateProgress(mediaId, newProgress);

      // Update local state
      calendarStore.updateEntry(mediaId, { progress: newProgress });
      
      // Emit progression event
      this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
        animeId: mediaId,
        progress: newProgress,
        timestamp: new Date(),
      });

      return newProgress;
    } catch (error) {
      log.error('[CalendarData] Failed to update progress', error);
      throw error;
    }
  }
}
