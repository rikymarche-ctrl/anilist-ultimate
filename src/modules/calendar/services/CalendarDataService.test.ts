import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarDataService } from './CalendarDataService';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { calendarEntry } from '@/test/calendar-fixtures';
import { EventBus } from '@core/events/EventBus';
import type { CalendarService } from '../CalendarService';
import type { CalendarStore } from '../CalendarStore';
import type { ToastService } from '@core/services/ToastService';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { MediaListStatus } from '@/api/AnilistTypes';

function makeEventBus() {
  const bus = new EventBus();
  return Object.assign(bus, { emit: vi.spyOn(bus, 'emit') });
}

function makeCalendarService() {
  return {
    fetchAiringSchedule: vi.fn<CalendarService['fetchAiringSchedule']>(),
    incrementProgress: vi.fn<CalendarService['incrementProgress']>(),
  } satisfies Pick<CalendarService, 'fetchAiringSchedule' | 'incrementProgress'>;
}

function makeToastService() {
  return {
    success: vi.fn<ToastService['success']>(), error: vi.fn<ToastService['error']>(),
  } satisfies Pick<ToastService, 'success' | 'error'>;
}

function makeService(bus: EventBus, calendar: ReturnType<typeof makeCalendarService>, toast: ReturnType<typeof makeToastService>, store = mockCalendarStore) {
  // Concrete services carry private state; only the checked public operations
  // exercised by this service cross the constructor seam.
  return new CalendarDataService(bus, calendar as unknown as CalendarService,
    toast as unknown as ToastService, store as unknown as CalendarStore);
}

// Mock dependencies
const mockCalendarStore = {
  getCustomPlans: vi.fn<CalendarStore['getCustomPlans']>(() => []),
  setLoading: vi.fn<CalendarStore['setLoading']>(),
  setEntries: vi.fn<CalendarStore['setEntries']>(),
  setError: vi.fn<CalendarStore['setError']>(),
  updateEntry: vi.fn<CalendarStore['updateEntry']>(),
  getState: vi.fn(() => ({
    entries: [
      calendarEntry(1, { title: 'Anime 1', progress: 10 }),
      calendarEntry(2, { title: 'Anime 2', progress: 5 }),
    ],
    customPlans: [], customOwner: null,
    loading: false,
    error: null, lastUpdate: null, preferences: { ...DEFAULT_CALENDAR_PREFERENCES },
    selectedDay: null, expandedDays: new Set<string>(), countdownInterval: null,
  })),
  loadEntriesFromCache: vi.fn<CalendarStore['loadEntriesFromCache']>(),
  saveEntriesToCache: vi.fn<CalendarStore['saveEntriesToCache']>(),
  invalidateCache: vi.fn<CalendarStore['invalidateCache']>(),
} satisfies Pick<CalendarStore, 'getCustomPlans' | 'setLoading' | 'setEntries' | 'setError' | 'updateEntry' | 'getState' | 'loadEntriesFromCache' | 'saveEntriesToCache' | 'invalidateCache'>;

describe('CalendarDataService', () => {
  let service: CalendarDataService;
  let mockEventBus: ReturnType<typeof makeEventBus>;
  let mockCalendarService: ReturnType<typeof makeCalendarService>;
  let mockToastService: ReturnType<typeof makeToastService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEventBus = makeEventBus();

    mockCalendarService = makeCalendarService();

    mockToastService = makeToastService();

    service = makeService(mockEventBus, mockCalendarService, mockToastService);
  });

  describe('loadSchedule', () => {
    it('should load schedule and update store', async () => {
      const mockEntries = [calendarEntry(1, { title: 'Test' })];
      mockCalendarService.fetchAiringSchedule.mockResolvedValue(mockEntries);

      await service.loadSchedule(123);

      expect(mockCalendarStore.setLoading).toHaveBeenCalledWith(true);
      expect(mockCalendarService.fetchAiringSchedule).toHaveBeenCalledWith(123, [], { priority: false });
      expect(mockCalendarStore.setEntries).toHaveBeenCalledWith(mockEntries);
      expect(mockCalendarStore.setLoading).toHaveBeenCalledWith(false);
      expect(mockToastService.success).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        EVENT_TYPES.CALENDAR_LOADED,
        expect.any(Object)
      );
    });

    it('requests the priority lane only while no entries are on screen', async () => {
      const visible = mockCalendarStore.getState();
      mockCalendarStore.getState.mockReturnValueOnce({ ...visible, entries: [] });
      mockCalendarService.fetchAiringSchedule.mockResolvedValue([calendarEntry(1)]);

      await service.loadSchedule(123, true);

      expect(mockCalendarService.fetchAiringSchedule).toHaveBeenCalledWith(123, [], { priority: true });
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
      mockCalendarService.incrementProgress.mockResolvedValue({ mediaId: 1, progress: 11, previousProgress: 10, userId: 42, status: MediaListStatus.CURRENT, title: 'Anime 1' });

      const result = await service.updateProgress(1);

      expect(result).toBe(11); // 10 + 1 from mockState
      expect(mockCalendarService.incrementProgress).toHaveBeenCalledWith(1);
      expect(mockCalendarStore.updateEntry).toHaveBeenCalledWith(1, { progress: 11 });
      // The service now passes a metadata object as a second argument.
      expect(mockToastService.success).toHaveBeenCalledWith(
        expect.stringContaining('Anime 1'),
        expect.anything()
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        EVENT_TYPES.EPISODE_MARKED_WATCHED,
        expect.objectContaining({ userId: 42, episodeNumber: 11 })
      );
    });

    it('should throw error if entry not found', async () => {
      await expect(service.updateProgress(999)).rejects.toThrow('Entry not found');
    });

    it('should handle API errors during progress update', async () => {
      mockCalendarService.incrementProgress.mockRejectedValue(new Error('Update failed'));

      await expect(service.updateProgress(1)).rejects.toThrow('Update failed');
    });
  });
});


describe('calendar cached personal rows and failure feedback', () => {
  const plan = { mediaId: 5, title: 'Plan 5', coverImage: '', siteUrl: 'https://anilist.co/anime/5', totalEpisodes: 12, progress: 3, dayOfWeek: 'Monday' as const, time: '20:00' };

  it('reuses a cached personal row progress instead of rebuilding it from the plan', async () => {
    const calendar = makeCalendarService(); const toast = makeToastService();
    const cached = calendarEntry(5, { calendarKind: 'personal', progress: 7 });
    const store = { ...mockCalendarStore, getCustomPlans: vi.fn(() => [plan]), loadEntriesFromCache: vi.fn(async () => [cached]), setEntries: vi.fn() };
    await makeService(makeEventBus(), calendar, toast, store as never).loadSchedule(42, false);
    expect(calendar.fetchAiringSchedule).not.toHaveBeenCalled();
    expect(store.setEntries).toHaveBeenCalledWith([expect.objectContaining({ mediaId: 5, progress: 7, calendarKind: 'personal' })]);
  });

  it('builds a personal row from the plan only when nothing is cached for it', async () => {
    const calendar = makeCalendarService(); const toast = makeToastService();
    const store = { ...mockCalendarStore, getCustomPlans: vi.fn(() => [plan]), loadEntriesFromCache: vi.fn(async () => []), setEntries: vi.fn() };
    await makeService(makeEventBus(), calendar, toast, store as never).loadSchedule(42, false);
    expect(store.setEntries).toHaveBeenCalledWith([expect.objectContaining({ mediaId: 5, progress: 3, calendarKind: 'personal' })]);
  });

  it('shows an error toast when marking watched fails before the progress is accepted', async () => {
    const calendar = makeCalendarService(); calendar.incrementProgress.mockRejectedValueOnce(new Error('offline'));
    const toast = makeToastService();
    await expect(makeService(makeEventBus(), calendar, toast, mockCalendarStore).updateProgress(1)).rejects.toThrow('offline');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not mark'), { mediaId: 1 });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('calendar progress account protection', () => {
  it('does not apply a completed increment to the next account after the auth event', async () => {
    let changed!: () => void; let resolve!: (value: { mediaId: number; userId: number; progress: number }) => void;
    const bus = { on: (event: string, handler: () => void) => { if (event === EVENT_TYPES.AUTH_STATE_CHANGED) changed = handler; }, emit: vi.fn() };
    const store = { getState: () => ({ entries: [{ mediaId: 1, title: 'Old account' }] }), clearCustomPlans: vi.fn(), setEntries: vi.fn(), setLoading: vi.fn(), updateEntry: vi.fn() };
    const service = new CalendarDataService(bus as never, { incrementProgress: () => new Promise(r => { resolve = r; }) } as never, { success: vi.fn(), error: vi.fn() } as never, store as never);
    const pending = service.updateProgress(1); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    changed(); resolve({ mediaId: 1, userId: 42, progress: 2 }); await expect(pending).rejects.toThrow('account changed');
    expect(store.updateEntry).not.toHaveBeenCalled(); expect(bus.emit).not.toHaveBeenCalled();
  });
});
