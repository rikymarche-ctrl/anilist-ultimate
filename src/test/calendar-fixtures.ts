import type { AnimeEntry } from '@core/types';
import { DAYS_OF_WEEK } from '@core/constants';

export function calendarEntry(mediaId = 1, patch: Partial<AnimeEntry> = {}): AnimeEntry {
  const airingAt = new Date('2026-10-08T20:00:00Z');
  return { id: mediaId + 100, mediaId, title: `Anime ${mediaId}`, cleanTitle: `Anime ${mediaId}`, episode: 12,
    airingAt, timeUntilAiring: 3600, coverImage: 'https://example.com/cover.jpg', siteUrl: `https://anilist.co/anime/${mediaId}`,
    progress: 10, totalEpisodes: 12, dayOfWeek: DAYS_OF_WEEK[airingAt.getDay()], ...patch };
}

export function calendarListEntry(mediaId = 1) {
  return { id: mediaId + 100, mediaId, userId: 1, progress: 10, status: 'CURRENT',
    media: { id: mediaId, type: 'ANIME', status: 'RELEASING', episodes: 12,
      title: { english: `Anime ${mediaId}`, romaji: `Romaji ${mediaId}`, native: null },
      coverImage: { large: 'https://example.com/cover.jpg', medium: null }, siteUrl: `https://anilist.co/anime/${mediaId}`,
      nextAiringEpisode: { id: mediaId + 200, mediaId, episode: 12, airingAt: 1791489600, timeUntilAiring: 3600 } } };
}

export function calendarCollection(entries: unknown[] = [calendarListEntry()], hasNextChunk: boolean | null = false) {
  return { MediaListCollection: { user: { id: 1 }, hasNextChunk, lists: [{ entries }] } };
}
