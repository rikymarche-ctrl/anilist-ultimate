/**
 * @file ProfileConnectionsService.ts
 * @description Session-cached profile relations for the connections line and Social sidebar counts.
 *
 * The viewer's following list comes from SocialService (cached per account). A profile's
 * followers and following are paged once per session with a request cap, and custom lists
 * are read fresh on every call so list edits show without refetching. Every result is
 * keyed by the API account context, so an account switch never serves another viewer's data.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { logger } from '@core/logger';
import { assertApiContext, captureApiContext } from '@/api/ApiContext';
import type { CustomListClient } from './CustomListClient';
import type { CustomLists } from './CustomListService';
import type { SocialService } from './SocialService';
import {
  CONNECTIONS_MAX_PAGES,
  SIDEBAR_MAX_PAGES,
  fetchRelations,
  pagesFor,
  computeConnections,
  type PagePlan,
  type ProfileConnections,
  type ProfileRelationsInput,
  type ProfileSocialCounts,
} from './ProfileConnections';
import { isAniListId } from './SocialResponse';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;
const EMPTY_RELATIONS: ProfileRelationsInput = {
  followers: [],
  followersComplete: true,
  following: [],
  followingComplete: true,
};

/** Bounded, expiring promise cache; a rejected load is evicted so a later call retries. */
class PromiseCache<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>();

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value;
    this.entries.delete(key);
    if (this.entries.size >= CACHE_MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
    const value = load();
    this.entries.set(key, { expires: now + CACHE_TTL_MS, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

const contextKey = (context: ApiContext | undefined): string =>
  `${context?.sessionId ?? 'anonymous'}:${context?.userId ?? 'none'}`;

@injectable()
export class ProfileConnectionsService {
  private relations = new PromiseCache<ProfileRelationsInput>();
  private counts = new PromiseCache<ProfileSocialCounts>();

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SocialService) private social: SocialService,
    @inject(TOKENS.CustomListService) private lists: CustomListClient
  ) {}

  /**
   * How the profile is connected to the people the viewer follows.
   * Null when the viewer is not connected through the extension, on the viewer's own
   * profile, or when the profile cannot be resolved.
   */
  async getConnections(profileName: string): Promise<ProfileConnections | null> {
    if (!this.api.isAuthenticated()) return null;
    const context = await captureApiContext(this.api);
    const assertCurrent = () => assertApiContext(this.api, context);
    const viewerId = await this.social.getViewerId();
    assertCurrent();
    if (!viewerId) return null;
    const profile = await this.social.getFullUser(profileName);
    assertCurrent();
    if (!profile || profile.id === viewerId) return null;

    const viewerFollowing = await this.social.getAllFollowings();
    assertCurrent();
    const relations =
      viewerFollowing.length === 0
        ? EMPTY_RELATIONS
        : await this.relations.get(`${contextKey(context)}:${profile.id}`, () =>
            this.loadRelations(profile.id, profile.followers, profile.following, assertCurrent)
          );
    assertCurrent();
    const lists = await this.readLists();
    assertCurrent();
    return computeConnections(viewerFollowing, relations, lists, new Set([viewerId, profile.id]));
  }

  /** Counts for the Social sidebar entries AniList shows without a number. */
  async getSocialCounts(profileId: number): Promise<ProfileSocialCounts> {
    if (!isAniListId(profileId)) throw new Error('Invalid profile ID');
    const context = await captureApiContext(this.api);
    const assertCurrent = () => assertApiContext(this.api, context);
    // Private messages are visible to their participants only, so counts depend on the viewer.
    const counts = await this.counts.get(`${contextKey(context)}:${profileId}`, async () => {
      const result = await fetchRelations(
        this.api,
        profileId,
        { threads: SIDEBAR_MAX_PAGES, messages: SIDEBAR_MAX_PAGES },
        ['mutualFollowers', 'threadComments'],
        assertCurrent
      );
      return {
        mutualFollowers: result.totals.mutualFollowers ?? null,
        forumThreads: result.tallies.threads!,
        forumComments: result.totals.threadComments ?? null,
        messages: result.tallies.messages!,
      };
    });
    assertCurrent();
    return counts;
  }

  /** Drops cached relations, e.g. after the viewer follows or unfollows someone. */
  clear(): void {
    this.relations.clear();
    this.counts.clear();
  }

  private async loadRelations(
    profileId: number,
    followerTotal: number,
    followingTotal: number,
    assertCurrent: () => void
  ): Promise<ProfileRelationsInput> {
    // Profile totals are exact, so only the pages that hold entries are asked for, all in one request.
    const plan: PagePlan = {
      followers: pagesFor(followerTotal, CONNECTIONS_MAX_PAGES),
      following: pagesFor(followingTotal, CONNECTIONS_MAX_PAGES),
    };
    if (!plan.followers && !plan.following) return EMPTY_RELATIONS;
    const result = await fetchRelations(this.api, profileId, plan, [], assertCurrent);
    return {
      followers: result.users.followers ?? [],
      followersComplete: result.tallies.followers?.complete ?? true,
      following: result.users.following ?? [],
      followingComplete: result.tallies.following?.complete ?? true,
    };
  }

  private async readLists(): Promise<CustomLists> {
    try {
      await this.lists.init();
      return this.lists.getLists();
    } catch (error) {
      // Counts stay useful without list attribution.
      logger.warn('[ProfileConnectionsService] Custom lists unavailable', error);
      return {};
    }
  }
}
