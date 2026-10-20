/**
 * @file YearReviewService.ts
 * @description Loads everything Astra Wrapped needs for one period: the signed-in user's
 * list activity, posts, received messages and all-time genres, then cast/staff/community
 * details for every title they touched. Results are cached per account and period so
 * reopening the recap does not spend the AniList rate limit again.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { assertApiContext, captureApiContext } from '@/api/ApiContext';
import {
  YEAR_ACTIVITY_QUERY,
  YEAR_MEDIA_PAGE_SIZE,
  YEAR_MEDIA_QUERY,
  YEAR_PRIOR_BATCH,
  YEAR_SOCIAL_QUERY,
  yearPriorQuery,
} from '@/api/queries/year-review';
import type { AstraService } from '../../AstraService';
import { parseAstraBackup } from '../../store/AstraBackup';
import { wrappedDate, type WrappedPeriod } from '../AstraWrapped';
import {
  yearActivityPage,
  yearMediaPage,
  yearPriorPage,
  yearSocialPage,
} from './YearReviewResponse';
import type {
  ReviewActivity,
  ReviewMedia,
  ReviewOptions,
  YearReviewInput,
} from './YearReviewTypes';

/** AniList refuses listings deeper than 5,000 entries (100 pages of 50). */
const MAX_ACTIVITY_PAGES = 100;
const MAX_SOCIAL_PAGES = 20;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_ENTRIES = 4;

export interface YearReviewData {
  input: YearReviewInput;
  local: NonNullable<ReviewOptions['local']>;
  context?: ApiContext;
  loadedAt: number;
}

/** AniList data only: Astra flags and scores are re-read on every load so edits apply at once. */
type CachedReview = Omit<YearReviewData, 'local'>;

export type YearReviewProgress = (message: string) => void;

@injectable()
export class YearReviewService {
  private cache = new Map<string, CachedReview>();

  constructor(
    @inject(TOKENS.AstraService) private astra: AstraService,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  async load(
    period: WrappedPeriod,
    isCurrent: () => boolean,
    progress: YearReviewProgress = () => {}
  ): Promise<YearReviewData> {
    const context = await captureApiContext(this.api);
    const owner = context?.userId ?? (await this.api.getCurrentUserId());
    const check = () => {
      assertApiContext(this.api, context);
      if (!isCurrent()) throw new Error('Astra Wrapped closed');
    };
    check();
    if (!owner || !this.api.isAuthenticated())
      throw new Error('Sign in to AniList to open Astra Wrapped.');
    const key = `${context?.sessionId ?? ''}|${owner}|${period.start}|${period.end}`;
    let cached = this.cache.get(key);
    if (!cached || Date.now() - cached.loadedAt >= CACHE_TTL_MS) {
      cached = await this.fetch(owner, period, check, progress, context);
      this.remember(key, cached);
    }
    progress('Matching your Astra scores…');
    const local = await this.localOverrides(owner);
    check();
    return { ...cached, local };
  }

  private async fetch(
    owner: number,
    period: WrappedPeriod,
    check: () => void,
    progress: YearReviewProgress,
    context: ApiContext | undefined
  ): Promise<CachedReview> {
    const start = wrappedDate(period.start);
    const end = wrappedDate(period.end);
    end.setDate(end.getDate() + 1);
    const window = { after: start.getTime() / 1000 - 1, before: end.getTime() / 1000 };
    const { activities, truncated } = await this.activities(owner, window, check, progress);
    const social = await this.social(owner, window, check, progress);
    const media = await this.media(activities, check, progress);
    const priorProgress = await this.prior(
      owner,
      window.after + 1,
      activities,
      media,
      check,
      progress
    );
    return {
      input: {
        period: { ...period },
        ownerId: owner,
        activities,
        media,
        priorProgress,
        ...social,
        truncated,
      },
      context,
      loadedAt: Date.now(),
    };
  }

  private remember(key: string, data: CachedReview): void {
    this.cache.delete(key);
    this.cache.set(key, data);
    while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
  }

  private async activities(
    owner: number,
    window: { after: number; before: number },
    check: () => void,
    progress: YearReviewProgress
  ) {
    const activities: ReviewActivity[] = [];
    for (let page = 1; page <= MAX_ACTIVITY_PAGES; page++) {
      progress(`Reading your activity · ${activities.length} updates so far`);
      const response = await this.api.query<unknown>(
        YEAR_ACTIVITY_QUERY,
        { userId: owner, page, ...window },
        true
      );
      check();
      const result = yearActivityPage(response, owner);
      activities.push(...result.activities);
      if (!result.hasNextPage) return { activities, truncated: false };
      if (!result.activities.length) throw new Error('Could not read the complete activity feed.');
    }
    return { activities, truncated: true };
  }

  private async social(
    owner: number,
    window: { after: number; before: number },
    check: () => void,
    progress: YearReviewProgress
  ) {
    const result: Pick<YearReviewInput, 'posts' | 'messages' | 'allTimeGenres'> = {
      posts: [],
      messages: [],
      allTimeGenres: [],
    };
    progress('Counting likes, posts and messages…');
    for (let page = 1; page <= MAX_SOCIAL_PAGES; page++) {
      const response = await this.api.query<unknown>(
        YEAR_SOCIAL_QUERY,
        { userId: owner, page, ...window },
        true
      );
      check();
      const social = yearSocialPage(response, owner);
      result.posts.push(...social.posts);
      result.messages.push(...social.messages);
      if (page === 1) result.allTimeGenres = social.genres;
      if (!social.hasNextPage) break;
    }
    return result;
  }

  /** Details for every title with something other than a planning update. */
  private async media(
    activities: ReviewActivity[],
    check: () => void,
    progress: YearReviewProgress
  ): Promise<ReviewMedia[]> {
    const ids = [
      ...new Set(
        activities
          .filter((activity) => activity.kind !== 'planning')
          .map((activity) => activity.mediaId)
      ),
    ];
    const media: ReviewMedia[] = [];
    for (let index = 0; index < ids.length; index += YEAR_MEDIA_PAGE_SIZE) {
      progress(
        `Meeting the cast and crew · ${Math.min(index + YEAR_MEDIA_PAGE_SIZE, ids.length)} of ${ids.length} titles`
      );
      const batch = ids.slice(index, index + YEAR_MEDIA_PAGE_SIZE);
      const response = await this.api.query<unknown>(YEAR_MEDIA_QUERY, { ids: batch }, true);
      check();
      media.push(...yearMediaPage(response, batch));
    }
    return media;
  }

  /** Last progress before the period for titles completed before any in-period progress. */
  private async prior(
    owner: number,
    before: number,
    activities: ReviewActivity[],
    media: ReviewMedia[],
    check: () => void,
    progress: YearReviewProgress
  ): Promise<Record<number, number>> {
    const lengths = new Map(
      media.map((item) => [item.id, item.type === 'ANIME' ? item.episodes : item.chapters])
    );
    const progressed = new Set<number>();
    const needed: number[] = [];
    for (const activity of [...activities].sort(
      (a, b) => a.createdAt - b.createdAt || a.id - b.id
    )) {
      if (activity.kind === 'progress' || activity.kind === 'repeat-progress')
        progressed.add(activity.mediaId);
      else if (
        (activity.kind === 'completed' || activity.kind === 'repeated') &&
        !progressed.has(activity.mediaId) &&
        lengths.get(activity.mediaId) &&
        !needed.includes(activity.mediaId)
      )
        needed.push(activity.mediaId);
    }
    const prior: Record<number, number> = {};
    for (let index = 0; index < needed.length; index += YEAR_PRIOR_BATCH) {
      progress(
        `Checking where you left off · ${Math.min(index + YEAR_PRIOR_BATCH, needed.length)} of ${needed.length}`
      );
      const batch = needed.slice(index, index + YEAR_PRIOR_BATCH);
      const variables: Record<string, number> = { userId: owner, before };
      batch.forEach((id, position) => {
        variables[`m${position}`] = id;
      });
      const response = await this.api.query<unknown>(yearPriorQuery(batch.length), variables, true);
      check();
      for (const [id, value] of yearPriorPage(response, owner, batch))
        prior[id] = value === 'complete' ? lengths.get(id)! : value;
    }
    return prior;
  }

  private async localOverrides(owner: number): Promise<YearReviewData['local']> {
    const backup = parseAstraBackup(await this.astra.exportJSON());
    const local: YearReviewData['local'] = new Map();
    for (const work of Object.values(backup.works)) {
      if (work.ownerId != null && work.ownerId !== owner) throw new Error('Astra account changed');
      local.set(work.mediaId, {
        score: this.astra.calcSeriesOverall(work),
        private: !!work.isPrivate,
        hidden: !!work.isHidden,
      });
    }
    return local;
  }
}
