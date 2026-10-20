import type { AnimeEntry } from '@core/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** An upcoming episode becomes available at its actual boundary, without a new fetch. */
export function availableEpisodes(entry: AnimeEntry, now = Date.now()): number {
  const available = Math.max(0, entry.episode - (entry.airingAt.getTime() > now ? 1 : 0));
  return entry.totalEpisodes && entry.totalEpisodes > 0 ? Math.min(entry.totalEpisodes, available) : available;
}

/**
 * True when a schedule-backed entry has reached its airing time, so the provider should be asked again.
 * Personal plans and catch-up rows (no upcoming episode) never count: their dates are not provider dates.
 */
export function hasLapsedAiring(entries: readonly AnimeEntry[], now = Date.now()): boolean {
  return entries.some(entry => entry.calendarKind === 'airing' && entry.airingAt.getTime() <= now);
}

/** Airings a week or more out show their real date, since the weekday column alone is ambiguous. */
export function isBeyondWeek(airingAt: Date, now = Date.now()): boolean {
  return airingAt.getTime() - now >= WEEK_MS;
}

/** Short calendar date for far-future airings, e.g. "Mon, Oct 27". */
export function formatAiringDay(airingAt: Date): string {
  return airingAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
