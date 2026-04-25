import type { AnimeEntry } from '../types';

export interface ICalendarService {
  fetchAiringSchedule(userId: number): Promise<AnimeEntry[]>;
  updateProgress(mediaId: number, newProgress: number): Promise<boolean>;
  groupByDay(entries: AnimeEntry[]): Record<string, AnimeEntry[]>;
  getEntriesForDay(entries: AnimeEntry[], day: string): AnimeEntry[];
  getTodayEntries(entries: AnimeEntry[]): AnimeEntry[];
  getWeekEntries(entries: AnimeEntry[]): AnimeEntry[];
  formatTimeUntilAiring(seconds: number): string;
  formatAiringTime(date: Date): string;
  hasAired(entry: AnimeEntry): boolean;
  isAiringSoon(entry: AnimeEntry): boolean;
  isAiringToday(entry: AnimeEntry): boolean;
}
