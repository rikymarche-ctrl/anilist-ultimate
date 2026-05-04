import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarDataService } from './CalendarDataService';
import { EVENT_TYPES } from '@core/events/EventTypes';

// Mock dependencies
const mockCalendarStore = {
  setLoading: vi.fn(),
  setEntries: vi.fn(),
  setError: vi.fn(),
  updateEntry: vi.fn(),
  getState: vi.fn(() => ({
    entries: [
      { mediaId: 1, title: 'Anime 1', progress: 10 },
      { mediaId: 2, title: 'Anime 2', progress: 5 }
    ],
    loading: false
  })),
  loadEntriesFromCache: vi.fn(),
  saveEntriesToCache: vi.fn(),
  invalidateCache: vi.fn(),
};

describe('CalendarDataService', () => {
  let service: CalendarDataService;
  let mockEventBus: any;
  let mockCalendarService: any;
  let mockToastService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEventBus = {
      emit: vi.fn(),
    };

    mockCalendarService = {
      fetchAiringSchedule: vi.fn(),
      updateProgress: vi.fn(),
    };

    mockToastService = {
      success: vi.fn(),
      error: vi.fn(),
    };

    service = new CalendarDataService(
      mockEventBus,
      mockCalendarService,
      mockToastService,
      mockCalendarStore as any
    );
  });

  describe('loadSchedule', () => {
    it('should load schedule and update store', async () => {
      const mockEntries = [{ mediaId: 1, title: 'Test' }];
      mockCalendarService.fetchAiringSchedule.mockResolvedValue(mockEntries);

      await service.loadSchedule(123);

      expect(mockCalendarStore.setLoading).toHaveBeenCalledWith(true);
      expect(mockCalendarService.fetchAiringSchedule).toHaveBeenCalledWith(123);
      expect(mockCalendarStore.setEntries).toHaveBeenCalledWith(mockEntries);
      expect(mockCalendarStore.setLoading).toHaveBeenCalledWith(false);
      expect(mockToastService.success).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(EVENT_TYPES.CALENDAR_LOADED, expect.any(Object));
    });

    it('should handle errors during load', async () => {
      const error = new Error('API Error');
      mockCalendarService.fetchAiringSchedule.mockRejectedValue(error);

      await expect(service.loadSchedule(123)).rejects.toThrow('API Error');

      expect(mockCalendarStore.setError).toHaveBeenCalledWith(error);
      expect(mockCalendarStore.setLoading).toHaveBeenCalledWith(false);
    });
  });

  describe('updateProgress', () => {
    it('should increment progress and update store', async () => {
      mockCalendarService.updateProgress.mockResolvedValue(true);

      const result = await service.updateProgress(1);

      expect(result).toBe(11); // 10 + 1 from mockState
      expect(mockCalendarService.updateProgress).toHaveBeenCalledWith(1, 11);
      expect(mockCalendarStore.updateEntry).toHaveBeenCalledWith(1, { progress: 11 });
      expect(mockToastService.success).toHaveBeenCalledWith(expect.stringContaining('Anime 1'));
      expect(mockEventBus.emit).toHaveBeenCalledWith(EVENT_TYPES.PROGRESS_UPDATED, expect.any(Object));
    });

    it('should throw error if entry not found', async () => {
      await expect(service.updateProgress(999)).rejects.toThrow('Entry not found');
    });

    it('should handle API errors during progress update', async () => {
      mockCalendarService.updateProgress.mockRejectedValue(new Error('Update failed'));

      await expect(service.updateProgress(1)).rejects.toThrow('Update failed');
    });
  });
});
