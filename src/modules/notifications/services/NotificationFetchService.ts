/**
 * @file NotificationFetchService.ts
 * @description Enterprise service for batched activity detail fetching for the Notification module.
 *
 * Optimizes network traffic by batching individual activity detail requests into
 * combined GraphQL alias queries and caches mostly static activity data.
 * Viewer-dependent details stay in memory.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import type { ICacheService } from '@core/interfaces/ICacheService';
import { CacheFactory } from '@core/cache/CacheFactory';
import { GraphQLResourceNotFoundError, type GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { TIME } from '@core/constants';
import { isRecord } from '@/api/GraphQLResponse';
import { isActivityId } from '@/modules/activity/ActivityResponse';
import { NOTIFICATION_ACTIVITY_QUERY, parseNotificationActivity, parseNotificationDetails } from './NotificationActivityResponse';

/** Simplified validated activity details used for notification grouping. */
export interface ActivityDetails {
  text: string;
  /** Present only for MessageActivity; null means the provider did not disclose it. */
  isPrivate?: boolean | null;
  mediaId?: number;
  mediaTitle?: string;
  status?: string;
  mediaType?: 'ANIME' | 'MANGA';
}

/**
 * Service responsible for fetching and caching activity metadata.
 */
@injectable()
export class NotificationFetchService {
  /** Factory-managed private cache for notification activity details */
  private cache: ICacheService<number, unknown>;
  private generation = 0;
  private cacheWrites: Promise<unknown> = Promise.resolve();
  private inFlight = new Map<string, Promise<ActivityDetails | undefined>>();
  private verifiedMessages = new Set<string>();
  private verifiedMissing = new Set<string>();

  // A late write must finish and remove its stale value before a newer session
  // can publish to the same key. Reads verify the envelope's session as well.
  private mutateCache<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.cacheWrites.then(operation);
    this.cacheWrites = pending.catch(() => undefined);
    return pending;
  }

  private activityKey(sessionId: string | undefined, userId: number | null | undefined, activityId: number): string {
    return JSON.stringify([sessionId ?? null, userId ?? null, activityId]);
  }

  /** Refresh message bodies on re-entry; confirmed missing IDs skip detail requests for this session. */
  public beginPage(): void {
    this.verifiedMessages.clear();
  }

  public isActivityUnavailable(activityId: number): boolean {
    const context = this.api?.getContext?.();
    return this.verifiedMissing.has(this.activityKey(context?.sessionId, context?.userId, activityId));
  }

  /** Cache configuration constants */
  private readonly CACHE_CONFIG = {
    namespace: 'notifications_activity',
    maxSize: 1000,
    ttlMs: 30 * TIME.DAY_MS // Notification content is mostly static
  };

  /**
   * @param batcher GraphQL alias batching engine
   * @param cacheFactory Factory to create isolated cache instances
   */
  constructor(
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(CacheFactory) cacheFactory: CacheFactory,
    @inject(TOKENS.ApiClient) private api?: IApiClient,
  ) {
    this.cache = cacheFactory.create<number, unknown>(this.CACHE_CONFIG);
  }

  /**
   * Extracts the activity ID from a notification DOM element.
   * Scans for data attributes and specific URL patterns in anchor tags.
   * 
   * @param notification Notification HTML element
   * @returns The extracted activity ID or null if not found
   */
  public extractActivityId(notification: HTMLElement): number | null {
    const dataId = notification.getAttribute('data-activity-id');
    if (dataId && /^\d+$/.test(dataId) && isActivityId(Number(dataId))) return Number(dataId);

    const links = [notification, ...notification.querySelectorAll<HTMLAnchorElement>('a[href]')];
    for (const link of links) {
      if (link.closest('.au-activity-context')) continue;
      const href = link.getAttribute('href') || '';
      try {
        const url = new URL(href, 'https://anilist.co');
        const match = url.pathname.match(/^\/activity\/(\d+)\/?$/);
        if (url.origin === 'https://anilist.co' && match && isActivityId(Number(match[1]))) return Number(match[1]);
      } catch { /* Ignore unrelated native links. */ }
    }
    return null;
  }

  /**
   * Fetches detailed metadata for multiple activity IDs.
   * Prioritizes the private cache and uses batcher for pending items.
   * 
   * @param activityIds Array of IDs to query
   * @returns Map of activityId to its details
   */
  public async fetchActivityDetails(activityIds: number[], onDetails?: (id: number, details: ActivityDetails) => void): Promise<Map<number, ActivityDetails>> {
    const ids = [...new Set(activityIds.filter(isActivityId))];
    const generation = this.generation;
    const context = this.api ? await captureApiContext(this.api) : undefined;
    const assertCurrent = () => {
      if (this.api) assertApiContext(this.api, context);
      if (generation !== this.generation) throw new Error('Notification cache changed');
    };
    assertCurrent();
    const results = new Map<number, ActivityDetails>();
    const publish = (id: number, details: ActivityDetails) => {
      assertCurrent();
      results.set(id, parseNotificationDetails(details));
      try { onDetails?.(id, parseNotificationDetails(details)); }
      catch (error) { logger.warn('[NotificationFetch] Detail subscriber failed', error); }
    };
    const pendingIds: number[] = [];
    const hasUsefulDetails = (details: ActivityDetails | undefined): details is ActivityDetails =>
      Boolean(details && (details.text.trim() || details.mediaId !== undefined || details.isPrivate !== undefined));
    const readDetails = (cached: unknown, id: number): ActivityDetails => {
      if (!isRecord(cached) || cached.schemaVersion !== 1 || cached.activityId !== id || cached.sessionId !== (context?.sessionId ?? null)
        || cached.userId !== (context?.userId ?? null)) throw new Error('Invalid notification cache identity');
      return parseNotificationDetails(cached.details);
    };

    // Prioritize cache
    for (const id of ids) {
      const activityKey = this.activityKey(context?.sessionId, context?.userId, id);
      if (this.verifiedMissing.has(activityKey)) continue;
      let cached: unknown;
      try { cached = await this.cache.get(id); }
      catch { assertCurrent(); /* A disposable cache cannot block provider reads. */ }
      assertCurrent();
      if (cached !== undefined) {
        try {
          const details = readDetails(cached, id);
          if (details.isPrivate !== undefined) {
            const key = this.activityKey(context?.sessionId, context?.userId, id);
            if (this.verifiedMessages.has(key)) {
              publish(id, details);
              continue;
            }
            // Revalidate on navigation so a deleted message keeps only its
            // native wording within its group, without stale body or privacy.
            pendingIds.push(id);
            continue;
          }
          if (hasUsefulDetails(details)) {
            publish(id, details);
            continue;
          }
          // Older versions could cache empty activity payloads. They look like
          // successful cache hits but suppress both display and future retries.
          await this.mutateCache(async () => { assertCurrent(); await this.cache.delete(id); });
          assertCurrent();
        } catch {
          try { await this.mutateCache(async () => {
            assertCurrent();
            // A newer write may have replaced this snapshot while eviction waited.
            // Validate again; cache adapters may return detached snapshots.
            const latest = await this.cache.get(id);
            assertCurrent();
            if (latest === undefined) return;
            try { readDetails(latest, id); } catch { await this.cache.delete(id); }
          }); } catch { assertCurrent(); }
          assertCurrent();
        }
      }
      pendingIds.push(id);
    }

    if (pendingIds.length === 0) { assertCurrent(); return results; }

    // The shared batcher owns batching and 404 isolation. Do not turn one failed
    // batch into individual API calls or serialize the whole page behind it.
    const loadOne = async (id: number): Promise<ActivityDetails | undefined> => { try {
        assertCurrent();
        let details: ActivityDetails | undefined;
        try {
          const data = await this.batcher.query<unknown>(NOTIFICATION_ACTIVITY_QUERY, { id });
          assertCurrent();
          details = parseNotificationActivity(data, id);
        } catch (error) {
          if (!(error instanceof GraphQLResourceNotFoundError)) throw error;
        }
        assertCurrent();
        const key = this.activityKey(context?.sessionId, context?.userId, id);
        if (details?.isPrivate !== undefined) {
          this.verifiedMessages.add(key);
        }
        if (!hasUsefulDetails(details)) {
          // Resolved without displayable content (deleted, or a null media/type): never request it again this session.
          this.verifiedMissing.add(key);
          if (this.verifiedMissing.size > this.CACHE_CONFIG.maxSize) this.verifiedMissing.delete(this.verifiedMissing.values().next().value!);
          await this.mutateCache(async () => { assertCurrent(); await this.cache.delete(id); });
          return;
        }
        try { await this.mutateCache(async () => {
          assertCurrent();
          try {
            await this.cache.set(id, { schemaVersion: 1, activityId: id, sessionId: context?.sessionId ?? null, userId: context?.userId ?? null,
              details: parseNotificationDetails(details) });
            assertCurrent();
          } catch (error) {
            // Removal is serialized with all service writes, so it cannot delete
            // a newer session's replacement while discarding this late write.
            await this.cache.delete(id);
            throw error;
          }
        }); } catch { assertCurrent(); }
        assertCurrent();
        return parseNotificationDetails(details);
      } catch (error) {
        logger.debug(`[NotificationFetch] Failed to fetch activity ${id}`, error);
        return undefined;
      }
    };

    // Reserve every ID before dispatch so overlapping scans share the same work.
    const requested: Array<{ id: number; task: Promise<ActivityDetails | undefined> }> = [];
    const jobs: Array<{ id: number; key: string; task: Promise<ActivityDetails | undefined>; resolve: (value: ActivityDetails | undefined) => void }> = [];
    for (const id of pendingIds) {
      const key = JSON.stringify([generation, context?.sessionId, context?.userId, id]);
      let task = this.inFlight.get(key);
      if (!task) {
        let resolve!: (value: ActivityDetails | undefined) => void;
        task = new Promise<ActivityDetails | undefined>(finish => { resolve = finish; });
        this.inFlight.set(key, task);
        jobs.push({ id, key, task, resolve });
      }
      requested.push({ id, task });
    }

    // Attach consumers before starting work: publish cache hits and each settled
    // ID immediately, even while an unrelated request or recovery is pending.
    const consuming = Promise.all(requested.map(async ({ id, task }) => {
      const details = await task;
      assertCurrent();
      if (hasUsefulDetails(details)) publish(id, details);
    }));
    const loading = Promise.all(jobs.map(async job => {
      try { job.resolve(await loadOne(job.id)); }
      catch { job.resolve(undefined); }
      finally { if (this.inFlight.get(job.key) === job.task) this.inFlight.delete(job.key); }
    }));
    await Promise.all([loading, consuming]);
    assertCurrent();
    return results;
  }

  /**
   * Clears the entire notification activity cache.
   */
  public async clearCache(): Promise<void> {
    this.generation++;
    this.inFlight.clear();
    this.verifiedMessages.clear();
    this.verifiedMissing.clear();
    await this.mutateCache(() => this.cache.clear());
    logger.info('[NotificationFetch] Activity cache cleared');
  }
}
