import { isRecord } from '@/api/GraphQLResponse';
import { isActivityId } from '@/modules/activity/ActivityResponse';
import { validListName } from '@/modules/social/CustomListService';

export const FRIEND_ALERTS_PREFIX = 'friend_alerts_account_';
export const FRIEND_ALERTS_ALARM = 'friend_alerts_poll';
export const FRIEND_ALERTS_INTERVAL_SECONDS = 5 * 60;
/** Alarm polls may run this many seconds early, so scheduler jitter cannot skip every other cycle. */
export const FRIEND_ALERTS_JITTER_SECONDS = 15;
/** Minimum gap between user-initiated checks ("Check now"). */
export const USER_POLL_MIN_SECONDS = 30;
export interface AlertScan {
  since: number;
  until: number;
  page: number;
  audience?: string;
}
/** One stable result set shared by titles with the same effective audience. */
export interface FriendAlertGroupScan extends AlertScan {
  mediaIds: number[];
  audience: string;
  recentAfter: number;
  complete?: boolean;
}
export interface FriendAlertRule {
  mediaId: number;
  title: string;
  mediaType: 'ANIME' | 'MANGA';
  list: string | null;
  since: number;
  checkedAt: number;
  scan?: AlertScan;
  recent?: Array<{ id: number; status: string; progress: string }>;
}
export interface FriendAlert {
  id: number;
  mediaId: number;
  userId: number;
  userName: string;
  title: string;
  status: string;
  progress: string;
  createdAt: number;
  read: boolean;
}
export interface FriendAlertsState {
  rules: FriendAlertRule[];
  alerts: FriendAlert[];
  lastPoll: number;
  failed?: boolean;
  groups?: FriendAlertGroupScan[];
}
export const emptyFriendAlerts = (): FriendAlertsState => ({ rules: [], alerts: [], lastPoll: 0 });
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, limit = 500): v is string => typeof v === 'string' && v.length <= limit;

/** A corrupt snapshot is never replaced with an empty inbox. */
export function parseFriendAlerts(value: unknown): FriendAlertsState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.rules) ||
    !Array.isArray(value.alerts) ||
    value.alerts.length > 200 ||
    !time(value.lastPoll) ||
    (value.failed !== undefined && typeof value.failed !== 'boolean')
  )
    throw new Error('Invalid friend alerts');
  const mediaIds = new Set<number>();
  for (const rule of value.rules) {
    if (
      !isRecord(rule) ||
      !isActivityId(rule.mediaId) ||
      mediaIds.has(rule.mediaId) ||
      !text(rule.title) ||
      !['ANIME', 'MANGA'].includes(rule.mediaType as string) ||
      !(rule.list === null || (typeof rule.list === 'string' && validListName(rule.list))) ||
      !time(rule.since) ||
      !time(rule.checkedAt) ||
      (rule.recent !== undefined &&
        (!Array.isArray(rule.recent) ||
          rule.recent.length > 50 ||
          !rule.recent.every(
            (entry) =>
              isRecord(entry) &&
              isActivityId(entry.id) &&
              text(entry.status) &&
              text(entry.progress)
          ))) ||
      (rule.scan !== undefined &&
        (!isRecord(rule.scan) ||
          !time(rule.scan.since) ||
          !time(rule.scan.until) ||
          rule.scan.until < rule.scan.since ||
          (rule.scan.audience !== undefined && !text(rule.scan.audience, 160000)) ||
          !isActivityId(rule.scan.page)))
    )
      throw new Error('Invalid friend alert rule');
    mediaIds.add(rule.mediaId);
  }
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups)) throw new Error('Invalid friend alert groups');
    const grouped = new Set<number>();
    for (const group of value.groups) {
      if (!isRecord(group) || !Array.isArray(group.mediaIds) || !group.mediaIds.length
        || group.mediaIds.length > 10000 || !text(group.audience, 160000)
        || !time(group.since) || !time(group.until) || group.until < group.since
        || !isActivityId(group.page) || !time(group.recentAfter)
        || (group.complete !== undefined && typeof group.complete !== 'boolean')) {
        throw new Error('Invalid friend alert groups');
      }
      for (const id of group.mediaIds) {
        if (!isActivityId(id) || !mediaIds.has(id) || grouped.has(id)) throw new Error('Invalid friend alert groups');
        grouped.add(id);
      }
    }
  }
  const ids = new Set<number>();
  for (const alert of value.alerts) {
    if (
      !isRecord(alert) ||
      !isActivityId(alert.id) ||
      ids.has(alert.id) ||
      !isActivityId(alert.mediaId) ||
      !isActivityId(alert.userId) ||
      !text(alert.userName, 200) ||
      !text(alert.title) ||
      !text(alert.status) ||
      !text(alert.progress) ||
      !time(alert.createdAt) ||
      typeof alert.read !== 'boolean'
    )
      throw new Error('Invalid friend alert');
    ids.add(alert.id);
  }
  return structuredClone(value) as unknown as FriendAlertsState;
}
