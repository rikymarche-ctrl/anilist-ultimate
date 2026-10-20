import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { isRecord } from '@/api/GraphQLResponse';
import { isActivityId } from '@/modules/activity/ActivityResponse';
import { CustomListHost } from '@/modules/social/CustomListHost';
import { validListName } from '@/modules/social/CustomListService';
import {
  emptyFriendAlerts,
  FRIEND_ALERTS_PREFIX,
  FRIEND_ALERTS_INTERVAL_SECONDS,
  FRIEND_ALERTS_JITTER_SECONDS,
  parseFriendAlerts,
  USER_POLL_MIN_SECONDS,
  type FriendAlertsState,
} from './FriendAlerts';
import { parseFriendAlertPage } from './FriendAlertsQuery';
import { POLL_OVERLAP_SECONDS, prepareFriendAlertPoll } from './FriendAlertsPolling';
export { FRIEND_ALERTS_QUERY } from './FriendAlertsQuery';

/** Background-only writer: alarms and every open tab share one serialized inbox. */
@injectable()
export class FriendAlertsHost {
  private work: Promise<unknown> = Promise.resolve();
  constructor(
    @inject(TOKENS.AuthTokenService) private auth: AuthTokenService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(CustomListHost) private lists: CustomListHost
  ) {}

  dispatch(operation: unknown, value: unknown, session: unknown): Promise<FriendAlertsState> {
    // Reads answer from storage at once; only writes queue behind a slow poll.
    if (operation === 'get') return this.read(session);
    const copy: unknown = structuredClone(value);
    const pending = this.work.then(async () => {
      if (!['watch', 'remove', 'read', 'clear', 'poll'].includes(operation as string))
        throw new Error('Unknown alert command');
      const { owner, key, assertSession } = await this.scope(session);
      const raw = (await chrome.storage.local.get(key))[key];
      assertSession();
      const state = raw === undefined ? emptyFriendAlerts() : parseFriendAlerts(raw);
      const now = Math.floor(Date.now() / 1000);
      const args = isRecord(copy) ? copy : {};
      if (operation === 'watch') {
        if (!this.config.isFeatureEnabled('friendAlerts'))
          throw new Error('Friend alerts disabled');
        if (
          !isActivityId(args.mediaId) ||
          !(args.list === null || (typeof args.list === 'string' && validListName(args.list)))
        )
          throw new Error('Invalid alert selection');
        if (args.list !== null) {
          const lists = await this.lists.dispatch('get', undefined, session);
          assertSession();
          if (!Object.prototype.hasOwnProperty.call(lists, args.list))
            throw new Error('List no longer exists');
        }
        if (!this.config.isFeatureEnabled('friendAlerts'))
          throw new Error('Friend alerts disabled');
        const existing = state.rules.find(rule => rule.mediaId === args.mediaId);
        if (existing?.list === args.list) return state;
        // Changing an existing title's audience needs only local metadata.
        const result: unknown = existing ? { Media: { id: existing.mediaId, type: existing.mediaType,
          title: { romaji: existing.title } } } : await this.api.query<unknown>(
          'query ($id: Int!) { Media(id: $id) { id type title { romaji english } } }',
          { id: args.mediaId },
          true
        );
        assertSession();
        if (!this.config.isFeatureEnabled('friendAlerts'))
          throw new Error('Friend alerts disabled');
        if (
          !isRecord(result) ||
          !isRecord(result.Media) ||
          result.Media.id !== args.mediaId ||
          !['ANIME', 'MANGA'].includes(result.Media.type as string) ||
          !isRecord(result.Media.title)
        )
          throw new Error('Invalid watched title');
        const title = result.Media.title.english || result.Media.title.romaji;
        if (typeof title !== 'string' || !title.trim() || title.length > 500)
          throw new Error('Invalid watched title');
        if (state.groups) state.groups = state.groups.filter(group => !group.mediaIds.includes(args.mediaId as number));
        state.rules = state.rules.filter((rule) => rule.mediaId !== args.mediaId);
        state.rules.push({
          mediaId: args.mediaId,
          title,
          mediaType: result.Media.type as 'ANIME' | 'MANGA',
          list: args.list,
          since: now,
          checkedAt: 0,
        });
      } else if (operation === 'remove') {
        if (!isActivityId(args.mediaId)) throw new Error('Invalid alert selection');
        if (state.groups) state.groups = state.groups.filter(group => !group.mediaIds.includes(args.mediaId as number));
        state.rules = state.rules.filter((rule) => rule.mediaId !== args.mediaId);
      } else if (operation === 'read') {
        if (args.id !== undefined && !isActivityId(args.id)) throw new Error('Invalid alert ID');
        for (const alert of state.alerts)
          if (args.id === undefined || alert.id === args.id) alert.read = true;
      } else if (operation === 'clear') state.alerts = [];
      else if (operation === 'poll') {
        // "Check now" needs only a short gap; the alarm keeps its 5-minute cadence.
        const minimumGap = args.manual === true
          ? USER_POLL_MIN_SECONDS
          : FRIEND_ALERTS_INTERVAL_SECONDS - FRIEND_ALERTS_JITTER_SECONDS;
        if (
          !this.config.isFeatureEnabled('friendAlerts') ||
          !state.rules.length ||
          now - state.lastPoll < minimumGap
        )
          return state;
        state.lastPoll = now;
        state.failed = false;
        // Reserve the interval before transport, including across MV3 restarts.
        await chrome.storage.local.set({ [key]: state });
        assertSession();
        const lists = await this.lists.dispatch('get', undefined, session);
        assertSession();
        const { tasks, batch } = prepareFriendAlertPoll(state, lists, owner!, now);
        if (batch) {
          if (!this.config.isFeatureEnabled('friendAlerts')) return state;
          let result: unknown;
          try {
            result = this.api.queryOnce
              ? await this.api.queryOnce<unknown>(batch.query, batch.variables, true)
              : await this.api.query<unknown>(batch.query, batch.variables, true);
          } catch {
            assertSession();
            state.failed = true;
          }
          if (!this.config.isFeatureEnabled('friendAlerts')) return state;
          for (const [index, { rules, scan, variables }] of tasks.entries()) {
            try {
              assertSession();
              const response = batch.decode(result, index);
              const page = parseFriendAlertPage(response.Page, variables);
              const recent = variables.checkRecent ? parseFriendAlertPage(response.recent, variables, true).activities : [];
              const byMedia = new Map(rules.map(rule => [rule.mediaId, rule]));
              // Validate the entire group before advancing or collecting any part.
              for (const activity of [...recent, ...page.activities]) {
                if (byMedia.get(activity.mediaId)?.mediaType !== activity.mediaType) throw new Error('Unrelated alert media');
              }
              for (const activity of recent) {
                if (!byMedia.get(activity.mediaId)?.recent?.some(entry => entry.id === activity.id)) throw new Error('Unrelated recent activity');
              }
              const collect = (activity: typeof page.activities[number], isRecent: boolean) => {
                const rule = byMedia.get(activity.mediaId)!;
                // A shared query starts at the oldest checkpoint. Never backfill a
                // newer subscription with another title's earlier activity.
                if (!isRecent && activity.createdAt < rule.since) return;
                rule.recent ??= [];
                const previous = rule.recent.find(entry => entry.id === activity.id)
                  ?? state.alerts.find(alert => alert.id === activity.id);
                const unchanged = previous?.status === activity.status && previous?.progress === activity.progress;
                if (!unchanged || !rule.recent.some(entry => entry.id === activity.id)) {
                  rule.recent = rule.recent.filter(entry => entry.id !== activity.id);
                  rule.recent.push({ id: activity.id, status: activity.status, progress: activity.progress });
                  rule.recent = rule.recent.slice(-50);
                }
                if (unchanged) return;
                state.alerts = state.alerts.filter(alert => alert.id !== activity.id);
                state.alerts.push({ id: activity.id, mediaId: rule.mediaId, userId: activity.userId,
                  userName: activity.userName, title: rule.title, status: activity.status,
                  progress: activity.progress, createdAt: activity.createdAt, read: false });
              };
              for (const activity of recent) collect(activity, true);
              for (const activity of page.activities) collect(activity, false);
              if (variables.checkRecent) scan.recentAfter = variables.ids[variables.ids.length - 1];
              if (!page.hasNextPage) {
                for (const rule of rules) rule.since = Math.max(rule.since, scan.until - POLL_OVERLAP_SECONDS);
                scan.complete = true;
              } else scan.page++;
            } catch {
              assertSession();
              // Commit valid audience groups; failed groups keep their stable window/page.
              state.failed = true;
            }
            for (const rule of rules) rule.checkedAt = now;
          }
        }
        state.alerts.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
        state.alerts = state.alerts.slice(0, 200);
      }
      assertSession();
      parseFriendAlerts(state);
      await chrome.storage.local.set({ [key]: state });
      assertSession();
      return structuredClone(state);
    });
    this.work = pending.catch(() => undefined);
    return pending;
  }

  /** Resolves the signed-in owner and returns an assertion that the caller's session still owns it. */
  private async scope(session: unknown): Promise<{ owner: number | undefined; key: string; assertSession: () => void }> {
    await this.auth.ensureInitialized();
    const owner = this.auth.getUserCache()?.userId;
    const assertSession = (): void => {
      if (
        !owner ||
        !this.auth.hasToken() ||
        typeof session !== 'string' ||
        this.auth.getSessionId() !== session ||
        this.auth.getUserCache()?.userId !== owner
      )
        throw new Error('Alerts account changed');
    };
    assertSession();
    return { owner, key: FRIEND_ALERTS_PREFIX + owner, assertSession };
  }

  private async read(session: unknown): Promise<FriendAlertsState> {
    const { key, assertSession } = await this.scope(session);
    const raw = (await chrome.storage.local.get(key))[key];
    assertSession();
    return raw === undefined ? emptyFriendAlerts() : parseFriendAlerts(raw);
  }

  async poll(): Promise<void> {
    await this.auth.ensureInitialized();
    if (!this.auth.hasToken() || !this.auth.getUserCache()?.userId) return;
    await this.dispatch('poll', undefined, this.auth.getSessionId());
  }
}
