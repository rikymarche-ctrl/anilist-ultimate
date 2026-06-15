/**
 * @file AstraSyncService.ts
 * @description Service for synchronizing Astra data with AniList.
 */

import { injectable, inject } from 'tsyringe';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { MediaListCollectionResponse } from '@/api/AnilistTypes';
import { AstraRepository } from '../store/AstraRepository';
import type { IAstraParser } from '../interfaces/IAstraParser';
import type { AstraWork } from '../AstraInterfaces';

@injectable()
export class AstraSyncService {
  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(AstraRepository) private repository: AstraRepository,
    @inject(TOKENS.AstraParserService) private parser: IAstraParser,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {}

  /**
   * Sync all user works from AniList.
   */
  public async syncWithAniList(): Promise<{ added: number; updated: number }> {
    await this.repository.init();

    try {
      const viewer = await this.api.getCurrentUser();
      const userId = viewer.id;

      const query = `
        query ($userId: Int, $type: MediaType) {
          MediaListCollection(userId: $userId, type: $type) {
            lists {
              entries {
                mediaId
                status
                score(format: POINT_10)
                progress
                notes
                customLists
                private
                hiddenFromStatusLists
                media {
                  title { romaji english native }
                  type
                  format
                  countryOfOrigin
                  coverImage { extraLarge large medium }
                  siteUrl
                  genres
                  episodes
                  chapters
                  duration
                }
              }
            }
          }
        }
      `;

      const [animeRes, mangaRes] = await Promise.all([
        this.api.query<MediaListCollectionResponse>(query, { userId, type: 'ANIME' }),
        this.api.query<MediaListCollectionResponse>(query, { userId, type: 'MANGA' }),
      ]);

      let addedCount = 0;
      let updatedCount = 0;

      const sections = this.repository.getSections();
      const existingSummariesByMediaId = new Map(
        this.repository.getWorks().map((summary) => [summary.mediaId, summary])
      );
      const existingMediaIds = new Set(existingSummariesByMediaId.keys());

      const processResult = async (result: MediaListCollectionResponse) => {
        const collection = result?.MediaListCollection;
        if (!collection?.lists) return;

        for (const list of collection.lists) {
          for (const entry of list.entries) {
            const existingSummary = existingMediaIds.has(entry.mediaId);

            if (existingSummary) {
              const full = await this.repository.getFullWork(entry.mediaId);
              if (!full) continue;

              const newTitle =
                entry.media.title.english ||
                entry.media.title.romaji ||
                entry.media.title.native ||
                'Unknown Title';
              let changed = false;

              if (full.status !== entry.status || full.title !== newTitle) {
                full.title = newTitle;
                full.status = entry.status;
                changed = true;
              }

              // Sync metadata
              const customLists = this.parseCustomLists(entry);
              const currentSummary = existingSummariesByMediaId.get(entry.mediaId);
              if (
                JSON.stringify(full.customLists) !== JSON.stringify(customLists) ||
                JSON.stringify(currentSummary?.customLists || []) !== JSON.stringify(customLists)
              ) {
                full.customLists = customLists;
                changed = true;
              }

              // Persist refreshed media metadata. These were previously assigned
              // without flagging `changed`, so updated episode/chapter totals never
              // got saved (entries stayed stuck on "?" until something else changed).
              const nextEpisodes = entry.media.episodes ?? undefined;
              const nextChapters = entry.media.chapters ?? undefined;
              const nextDuration = entry.media.duration ?? undefined;
              const nextGenres = entry.media.genres || [];
              const nextPrivate = !!entry.private;
              const nextHidden = !!entry.hiddenFromStatusLists;
              if (
                full.episodes !== nextEpisodes ||
                full.chapters !== nextChapters ||
                full.progress !== entry.progress ||
                full.duration !== nextDuration ||
                full.isPrivate !== nextPrivate ||
                full.isHidden !== nextHidden ||
                JSON.stringify(full.genres) !== JSON.stringify(nextGenres)
              ) {
                changed = true;
              }
              full.genres = nextGenres;
              full.episodes = nextEpisodes;
              full.chapters = nextChapters;
              full.progress = entry.progress;
              full.duration = nextDuration;
              full.isPrivate = nextPrivate;
              full.isHidden = nextHidden;
              if (entry.notes) {
                const parsed = this.parser.parse(entry.notes, sections);
                if (parsed) {
                  if (this.parser.merge(full, parsed)) {
                    changed = true;
                  }
                } else {
                  if (full.notes !== entry.notes) {
                    full.notes = entry.notes || '';
                    const season = full.seasons[full.seasons.length - 1];
                    if (season) season.notes = entry.notes || '';
                    changed = true;
                  }
                }
              }

              if (changed) {
                // Defer manifest persist; flushed once after the full sync.
                const saved = await this.repository.saveWork(full, true);
                existingMediaIds.add(saved.mediaId);
                updatedCount++;
              }
            } else {
              // NEW WORK
              const media = entry.media;
              const type =
                media.type === 'ANIME' ? 'anime' : media.format === 'NOVEL' ? 'novel' : 'manga';

              const newWork: AstraWork = {
                id: `w_new_${entry.mediaId}`, // Temporary ID, saveWork will generate proper UUID if needed
                mediaId: entry.mediaId,
                title:
                  media.title.english ||
                  media.title.romaji ||
                  media.title.native ||
                  'Unknown Title',
                type: type as any,
                country: media.countryOfOrigin,
                cover:
                  media.coverImage.extraLarge ||
                  media.coverImage.large ||
                  media.coverImage.medium ||
                  undefined,
                status: entry.status,
                isPrivate: !!entry.private,
                isHidden: !!entry.hiddenFromStatusLists,
                customLists: this.parseCustomLists(entry),
                tags: [],
                seasons: [this.repository.createDefaultSeason()],
                notes: entry.notes || '',
                updatedAt: Date.now(),
                genres: media.genres || [],
                episodes: media.episodes ?? undefined,
                chapters: media.chapters ?? undefined,
                progress: entry.progress,
                duration: media.duration ?? undefined,
              };

              if (entry.notes) {
                const parsed = this.parser.parse(entry.notes, sections);
                if (parsed) this.parser.merge(newWork, parsed);
              }

              if (entry.score > 0) {
                const normalized = entry.score > 10 ? entry.score / 10 : entry.score;
                newWork.seasons[0].legacyScore = normalized;
              }

              const saved = await this.repository.saveWork(newWork, true);
              existingMediaIds.add(saved.mediaId);
              addedCount++;
            }
          }
        }
      };

      await processResult(animeRes);
      await processResult(mangaRes);

      // Flush the manifest once for the whole sync (avoids O(n²) re-writes).
      await this.repository.persist();

      log.info(`[AstraSyncService] Sync complete: +${addedCount} added, ~${updatedCount} updated`);
      this.eventBus.emit(EVENT_TYPES.ASTRA_SYNC_COMPLETE, {
        added: addedCount,
        updated: updatedCount,
      });
      return { added: addedCount, updated: updatedCount };
    } catch (error) {
      log.error('[AstraSyncService] Sync failed', error);
      throw error;
    }
  }

  private parseCustomLists(entry: any): string[] {
    let customLists: string[] = [];
    if (entry.customLists) {
      const cl = entry.customLists as Record<string, boolean>;
      customLists = Object.keys(cl).filter((k) => cl[k]);
    }
    if (entry.private) customLists.push('Private');
    if (entry.hiddenFromStatusLists) customLists.push('Hide from status lists');
    return customLists;
  }
}
