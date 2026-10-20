import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { isRecord } from '@/api/GraphQLResponse';
import { isAniListId } from './SocialResponse';

export const FOLLOWING_PROGRESS_TTL = 5 * 60 * 1000;
export const FOLLOWING_PROGRESS_QUERY = `query ($userName: String, $mediaId: Int) {
  MediaList(userName: $userName, mediaId: $mediaId) {
    id mediaId userId progress user { id name }
  }
}`;

/** Accept both the batcher's root value and a normal GraphQL data object. */
export function parseFollowingProgress(value: unknown, username: string, mediaId: number): number {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'MediaList')) value = value.MediaList;
  if (value === null) return 0;
  if (!isRecord(value) || !isAniListId(value.id) || value.mediaId !== mediaId
    || !isAniListId(value.userId) || !isRecord(value.user) || value.user.id !== value.userId
    || typeof value.user.name !== 'string' || value.user.name.toLowerCase() !== username.toLowerCase()
    || (value.progress !== null && (typeof value.progress !== 'number' || !Number.isInteger(value.progress)
      || value.progress < 0 || value.progress > 2147483647))) throw new Error('Invalid Following progress response');
  return value.progress === null ? 0 : value.progress as number;
}

@injectable()
export class FollowingProgressService {
  private cache = new Map<string, { progress: number; timestamp: number }>();
  private pending = new Map<string, Promise<number | undefined>>();
  private context?: ApiContext;
  private version = 0;

  constructor(
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  clear(): void { this.version++; this.cache.clear(); this.pending.clear(); }

  async getProgress(username: string, mediaId: number): Promise<number | undefined> {
    const context = this.api.getContext?.();
    if (context?.sessionId !== this.context?.sessionId || context?.userId !== this.context?.userId || !this.api.isAuthenticated()) {
      this.clear(); this.context = context ? { ...context } : undefined;
    }
    if (!this.api.isAuthenticated() || !username.trim() || username.length > 100 || !isAniListId(mediaId)) return undefined;
    const version = this.version;
    const current = () => version === this.version && this.api.isAuthenticated()
      && context?.sessionId === this.api.getContext?.()?.sessionId && context?.userId === this.api.getContext?.()?.userId;
    const key = JSON.stringify([mediaId, username.toLowerCase()]);
    const cached = this.cache.get(key);
    const age = cached ? Date.now() - cached.timestamp : -1;
    if (cached && age >= 0 && age < FOLLOWING_PROGRESS_TTL) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached.progress;
    }
    this.cache.delete(key);
    let task = this.pending.get(key);
    if (!task) {
      task = (async () => {
        try {
          const response = await this.batcher.query<unknown>(FOLLOWING_PROGRESS_QUERY, { userName: username, mediaId });
          if (!current()) return undefined;
          const progress = parseFollowingProgress(response, username, mediaId);
          this.cache.set(key, { progress, timestamp: Date.now() });
          while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
          return progress;
        } catch { return undefined; } // Failures remain retryable, never confirmed zero.
      })();
      this.pending.set(key, task);
    }
    try { const progress = await task; return current() ? progress : undefined; }
    finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
}
