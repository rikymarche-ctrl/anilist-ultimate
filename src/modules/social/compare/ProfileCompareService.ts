/**
 * @file ProfileCompareService.ts
 * @description Loads both anime or manga lists for a profile comparison.
 *
 * Every request goes through the shared API queue, whose sliding window keeps the whole
 * extension inside AniList's per-minute limit however long the lists are. Lists load one
 * chunk at a time. The other person's list stays cached per account for a few minutes, so
 * reopening a comparison stays cheap. The viewer's own list is read fresh on every opening:
 * a score changed a minute ago must show. The other list loads first, so a private list
 * costs one request instead of the viewer's whole list.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { assertApiContext, captureApiContext } from '@/api/ApiContext';
import { PROFILE_COMPARE_LIST_QUERY, profileCompareUsersQuery } from '@/api/queries/profile-compare';
import type { GraphQLResponse } from '@/api/GraphQLResponse';
import { PromiseCache } from '../ProfileConnectionsService';
import type { CompareEntry, CompareMedia, CompareUser } from './ProfileCompareModel';
import { parseCompareList, parseCompareUser } from './ProfileCompareResponse';

export type CompareFailure = 'signed-out' | 'self' | 'not-found' | 'private' | 'unavailable';

export class CompareError extends Error {
  constructor(readonly kind: CompareFailure) {
    super(`Profile comparison failed: ${kind}`);
    this.name = 'CompareError';
  }
}

export interface CompareData {
  viewer: CompareUser;
  other: CompareUser;
  viewerEntries: CompareEntry[];
  otherEntries: CompareEntry[];
}

export interface CompareProgress {
  name: string;
  isViewer: boolean;
  loaded: number;
}

export const PER_CHUNK = 500;
export const MAX_CHUNKS = 40;

interface UsersPayload {
  Viewer?: unknown;
  User?: unknown;
}

@injectable()
export class ProfileCompareService {
  private lists = new PromiseCache<CompareEntry[]>();

  constructor(@inject(TOKENS.ApiClient) private api: IApiClient) {}

  async load(
    profileName: string,
    media: CompareMedia = 'ANIME',
    onProgress?: (progress: CompareProgress) => void
  ): Promise<CompareData> {
    if (!this.api.isAuthenticated()) throw new CompareError('signed-out');
    const context = await captureApiContext(this.api);
    const { viewer, other } = await this.loadUsers(profileName, media, context);
    const read = (user: CompareUser, isViewer: boolean) =>
      this.loadList(
        user,
        media,
        (loaded) => onProgress?.({ name: user.name, isViewer, loaded }),
        context
      );
    const otherEntries = await this.lists.get(
      `${context?.sessionId ?? 'anonymous'}:${context?.userId ?? 'none'}:${media}:${other.id}`,
      () => read(other, false)
    );
    const viewerEntries = await read(viewer, true);
    assertApiContext(this.api, context);
    return { viewer, other, viewerEntries, otherEntries };
  }

  clear(): void {
    this.lists.clear();
  }

  private async loadUsers(
    name: string,
    media: CompareMedia,
    context: ApiContext | undefined
  ): Promise<{ viewer: CompareUser; other: CompareUser }> {
    let response: GraphQLResponse<UsersPayload | null>;
    try {
      response = await this.api.queryRaw<UsersPayload | null>(
        profileCompareUsersQuery(media),
        { name },
        { priority: true }
      );
    } catch {
      throw new CompareError('unavailable');
    }
    assertApiContext(this.api, context);
    const missing = response.errors?.some((error) => error.status === 404) ?? false;
    const other = parseCompareUser(response.data?.User, media);
    if (!other) throw new CompareError(missing ? 'not-found' : 'unavailable');
    const viewer = parseCompareUser(response.data?.Viewer, media);
    if (!viewer) throw new CompareError('signed-out');
    if (viewer.id === other.id) throw new CompareError('self');
    return { viewer, other };
  }

  private async loadList(
    user: CompareUser,
    media: CompareMedia,
    onLoaded: (count: number) => void,
    context: ApiContext | undefined
  ): Promise<CompareEntry[]> {
    const entries = new Map<number, CompareEntry>();
    for (let chunk = 1; chunk <= MAX_CHUNKS; chunk++) {
      const page = await this.readChunk(user.id, media, chunk);
      assertApiContext(this.api, context);
      for (const entry of page.entries)
        if (!entries.has(entry.mediaId)) entries.set(entry.mediaId, entry);
      onLoaded(entries.size);
      if (!page.hasNextChunk) return [...entries.values()];
      if (!page.entries.length) break;
    }
    throw new CompareError('unavailable');
  }

  private async readChunk(
    userId: number,
    media: CompareMedia,
    chunk: number
  ): Promise<ReturnType<typeof parseCompareList>> {
    let response: GraphQLResponse<unknown>;
    try {
      response = await this.api.queryRaw<unknown>(
        PROFILE_COMPARE_LIST_QUERY,
        { userId, type: media, chunk, perChunk: PER_CHUNK },
        { priority: true }
      );
    } catch {
      throw new CompareError('unavailable');
    }
    if (response.errors?.some((error) => /private/i.test(error.message)))
      throw new CompareError('private');
    try {
      return parseCompareList(response.data, userId);
    } catch {
      throw new CompareError('unavailable');
    }
  }
}
