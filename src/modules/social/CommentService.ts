/** Session-scoped notes cache shared by the tooltip/reader integration. Old
 * persistent cache keys are intentionally neither read nor overwritten. */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { isRecord } from '@/api/GraphQLResponse';
import { isAniListId } from './SocialResponse';
import { logger } from '@core/logger';

export interface UserComment {
  username: string;
  mediaId: number;
  notes: string;
  timestamp: number;
}
export const COMMENT_CACHE_MAX_AGE = 48 * 60 * 60 * 1000;
const EMPTY_CACHE_MAX_AGE = 10 * 60 * 1000;
/** A failed lookup is not cached as empty, but the same key is not re-requested on every scan either. */
const FAILED_LOOKUP_BACKOFF_MS = 60 * 1000;
interface CommentScope {
  version: number;
  context?: ApiContext;
}

export function parseCommentNotes(value: unknown): string {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'MediaList')) {
    if (Object.prototype.hasOwnProperty.call(value, 'notes'))
      throw new Error('Invalid notes response');
    value = value.MediaList;
  }
  if (value === null) return '';
  if (!isRecord(value) || (value.notes !== null && typeof value.notes !== 'string'))
    throw new Error('Invalid notes response');
  return value.notes === null ? '' : value.notes;
}

@injectable()
export class CommentService {
  private cache = new Map<string, UserComment>();
  private pending = new Map<
    string,
    { scope: CommentScope; promise: Promise<UserComment | null> }
  >();
  private context?: ApiContext;
  private version = 0;
  private cachedCharacters = 0;
  private failures = new Map<string, number>();
  private readonly MAX_ENTRIES = 500;
  private readonly MAX_CHARACTERS = 2 * 1024 * 1024;

  constructor(
    @inject(TOKENS.GraphQLBatcher) private batcher: GraphQLBatcher,
    @inject(TOKENS.ApiClient) private api: IApiClient
  ) {}

  public async init(): Promise<void> {
    await this.api.ensureContext?.();
    this.syncContext();
  }

  public clear(): void {
    this.version++;
    this.cache.clear();
    this.pending.clear();
    this.cachedCharacters = 0;
    this.resetFailures();
  }

  /** Forget failed lookups so they may be requested again; cached notes are kept. */
  public resetFailures(): void {
    this.failures.clear();
  }

  private syncContext(): CommentScope {
    const context = this.api.getContext?.();
    if (
      context?.sessionId !== this.context?.sessionId ||
      context?.userId !== this.context?.userId ||
      !this.api.isAuthenticated()
    ) {
      this.clear();
      this.context = context ? { ...context } : undefined;
    }
    return { version: this.version, ...(context ? { context: { ...context } } : {}) };
  }

  private current(scope: CommentScope): boolean {
    if (scope.version !== this.version || !this.api.isAuthenticated()) return false;
    const context = this.api.getContext?.();
    return (
      !scope.context ||
      (context?.sessionId === scope.context.sessionId && context.userId === scope.context.userId)
    );
  }

  public async getComment(
    username: string,
    mediaId: number,
    forceRefresh = false
  ): Promise<UserComment | null> {
    const scope = this.syncContext();
    if (
      !this.current(scope) ||
      typeof username !== 'string' ||
      !username.trim() ||
      username.length > 100 ||
      !isAniListId(mediaId)
    )
      return null;
    const key = `${username.toLowerCase()}_${mediaId}`;
    const cached = this.cache.get(key);
    if (!forceRefresh && cached) {
      const age = Date.now() - cached.timestamp;
      const ttl = cached.notes.trim() ? COMMENT_CACHE_MAX_AGE : EMPTY_CACHE_MAX_AGE;
      if (age >= 0 && age < ttl) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return { ...cached, username };
      }
      this.remove(key);
    }
    if (!forceRefresh && this.isBackingOff(key)) return null;
    const existing = this.pending.get(key);
    const task =
      existing && this.current(existing.scope)
        ? existing.promise
        : this.fetch(username, mediaId, key, scope);
    if (!existing || task !== existing.promise) this.pending.set(key, { scope, promise: task });
    try {
      const result = await task;
      return this.current(scope) && result ? { ...result, username } : null;
    } finally {
      if (this.pending.get(key)?.promise === task) this.pending.delete(key);
    }
  }

  private async fetch(
    username: string,
    mediaId: number,
    key: string,
    scope: CommentScope
  ): Promise<UserComment | null> {
    try {
      const data = await this.batcher.query<unknown>(
        `query ($userName: String, $mediaId: Int) { MediaList(userName: $userName, mediaId: $mediaId) { notes } }`,
        { userName: username, mediaId }
      );
      if (!this.current(scope)) return null;
      const comment = { username, mediaId, notes: parseCommentNotes(data), timestamp: Date.now() };
      this.failures.delete(key);
      // Very large notes remain readable, but do not consume the bounded cache.
      this.remove(key);
      if (comment.notes.length <= this.MAX_CHARACTERS) {
        this.cache.set(key, comment);
        this.cachedCharacters += comment.notes.length;
        while (this.cache.size > this.MAX_ENTRIES || this.cachedCharacters > this.MAX_CHARACTERS)
          this.remove(this.cache.keys().next().value!);
      }
      return comment;
    } catch (error) {
      if (this.current(scope)) {
        logger.debug('Could not fetch notes', error);
        this.recordFailure(key);
      }
      // A failure does not establish that notes are empty; preserve a prior entry.
      return null;
    }
  }

  private isBackingOff(key: string): boolean {
    const failedAt = this.failures.get(key);
    if (failedAt === undefined) return false;
    const age = Date.now() - failedAt;
    if (age >= 0 && age < FAILED_LOOKUP_BACKOFF_MS) return true;
    this.failures.delete(key);
    return false;
  }

  private recordFailure(key: string): void {
    this.failures.set(key, Date.now());
    while (this.failures.size > this.MAX_ENTRIES)
      this.failures.delete(this.failures.keys().next().value!);
  }

  public hasValidComment(username: string, mediaId: number): boolean {
    const scope = this.syncContext();
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      username.length > 100 ||
      !isAniListId(mediaId)
    )
      return false;
    const entry = this.cache.get(`${username.toLowerCase()}_${mediaId}`);
    if (!this.current(scope) || !entry?.notes.trim()) return false;
    const age = Date.now() - entry.timestamp;
    return age >= 0 && age < COMMENT_CACHE_MAX_AGE;
  }

  private remove(key: string): void {
    const entry = this.cache.get(key);
    if (entry) this.cachedCharacters -= entry.notes.length;
    this.cache.delete(key);
  }
}
