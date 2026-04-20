/**
 * Activity Service
 * Handles batched fetching of user scores for activity entries
 */

import { anilistClient } from '@/api/AnilistClient';
import { log } from '@core/logger';

export class ActivityService {
  private static instance: ActivityService;
  private scoreCache: Map<string, number | null> = new Map(); // key: "userName-mediaId"

  private constructor() {}

  public static getInstance(): ActivityService {
    if (!ActivityService.instance) {
      ActivityService.instance = new ActivityService();
    }
    return ActivityService.instance;
  }

  /**
   * Fetch scores for a batch of User-Media pairs
   */
  public async getScoresBatch(pairs: { userName: string; mediaId: number }[]): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    const pendingPairs: { userName: string; mediaId: number; key: string }[] = [];

    pairs.forEach(p => {
      const key = `${p.userName}-${p.mediaId}`;
      if (this.scoreCache.has(key)) {
        results.set(key, this.scoreCache.get(key)!);
      } else {
        pendingPairs.push({ ...p, key });
      }
    });

    if (pendingPairs.length === 0) return results;

    // AniList Alias Batching (Max ~50 per request to be safe)
    const chunkSize = 25;
    for (let i = 0; i < pendingPairs.length; i += chunkSize) {
      const chunk = pendingPairs.slice(i, i + chunkSize);
      
      const aliases = chunk.map((p, idx) => {
        // Alias must be valid identifier (no dashes)
        return `s${idx}: MediaList(userName: "${p.userName}", mediaId: ${p.mediaId}) { score(format: POINT_100) }`;
      });

      const query = `query { ${aliases.join('\n')} }`;

      try {
        const response = await anilistClient.query<Record<string, { score: number } | null>>(query);
        
        chunk.forEach((p, idx) => {
          const data = response[`s${idx}`];
          const score = data ? data.score : null;
          this.scoreCache.set(p.key, score);
          results.set(p.key, score);
        });
      } catch (e) {
        log.error('[ActivityService] Batch fetch failed', e);
        // Mark as null to avoid spamming failed requests
        chunk.forEach(p => {
          this.scoreCache.set(p.key, null);
          results.set(p.key, null);
        });
      }

      // Small delay between chunks if multiple
      if (i + chunkSize < pendingPairs.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return results;
  }
}
