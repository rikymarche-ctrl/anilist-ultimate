import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWork } from '@modules/astra/AstraInterfaces';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '@modules/astra/utils/AstraConstants';
import type { SeasonalEntry } from '@modules/astra/services/SeasonalWrappedModel';
import type { SeasonalData } from '@modules/astra/services/SeasonalWrappedService';

export const seasonalEntry = (patch: Partial<SeasonalEntry> = {}): SeasonalEntry => ({
  mediaId: 1, title: 'Spring story', cover: null, format: 'TV', status: MediaListStatus.COMPLETED, progress: 12, score: 8,
  private: false, hidden: false, startedAt: { year: 2026, month: 4, day: 5 }, completedAt: { year: 2026, month: 6, day: 28 },
  releaseStatus: 'FINISHED', startDate: { year: 2026, month: 4, day: 1 }, endDate: { year: 2026, month: 6, day: 28 },
  origin: { year: 2026, season: 'SPRING' }, genres: ['Drama', 'Fantasy'], ...patch,
});
export const seasonalWork = (patch: Partial<AstraWork> = {}): AstraWork => ({ id: 'w1', mediaId: 1, ownerId: 42, title: 'Spring story',
  type: 'anime', status: MediaListStatus.COMPLETED, progress: 12, tags: [], customLists: [], notes: 'Private note', updatedAt: 1,
  seasons: [{ scores: { story: 9 } }], ...patch });
export function seasonalData(entries = [seasonalEntry()], works = [seasonalWork()]): SeasonalData {
  return { entries, ownerId: 42, loadedAt: 1, context: { userId: 42, sessionId: 'one' },
    backup: { schemaVersion: 1, manifest: [], works: Object.fromEntries(works.map(work => [work.mediaId, work])),
      sections: structuredClone(DEFAULT_SECTIONS), settings: { ...DEFAULT_SETTINGS } } };
}
export function seasonalResponse(entries = [seasonalEntry()], hasNextChunk = false, owner = 42) {
  return { MediaListCollection: { user: { id: owner }, hasNextChunk, lists: [{ entries: entries.map(entry => ({
    id: entry.mediaId + 1000, mediaId: entry.mediaId, userId: owner, status: entry.status, progress: entry.progress, score: entry.score,
    private: entry.private, hiddenFromStatusLists: entry.hidden, startedAt: entry.startedAt, completedAt: entry.completedAt,
    media: { id: entry.mediaId, type: 'ANIME', format: entry.format, status: entry.releaseStatus,
      title: { userPreferred: entry.title }, coverImage: { large: entry.cover }, season: entry.origin?.season ?? null,
      seasonYear: entry.origin?.year ?? null, startDate: entry.startDate, endDate: entry.endDate, genres: entry.genres },
  })) }] } };
}
