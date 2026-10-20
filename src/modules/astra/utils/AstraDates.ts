import type { AniListDate } from '@/api/AnilistTypes';
import type { QueuedMutation } from '@core/interfaces/ISyncQueueService';
import { validateSyncPayload } from '@core/services/SyncPayload';
import type { AstraPendingListState } from '../interfaces/IAstraRatingService';

export interface AstraListDates { startedAt?: AniListDate | null; completedAt?: AniListDate | null; }
const fields = ['year', 'month', 'day'] as const;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Retain fuzzy components without creating a Date, timezone or invented suffix. */
export function readAstraDate(value: unknown, requireSelectedComponents = false): AniListDate | null {
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))) throw new Error('Invalid Astra date');
  const input = value as Record<string, unknown>;
  const components = fields.map((field, index) => {
    if (requireSelectedComponents && (!own(input, field) || input[field] === undefined)) throw new Error('Invalid Astra date');
    const component = input[field] ?? null;
    const max = index === 0 ? 2147483647 : index === 1 ? 12 : 31;
    if (component !== null && (typeof component !== 'number' || !Number.isInteger(component) || component < 1 || component > max)) throw new Error('Invalid Astra date');
    return component as number | null;
  });
  const [year, month, day] = components;
  const leap = year === null || year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month !== null && day !== null && day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) throw new Error('Invalid Astra date');
  return { year, month, day };
}

/** Optional persisted fields stay absent; null remains an explicit Clear. */
export function copyAstraDates(value: { startedAt?: unknown; completedAt?: unknown }): AstraListDates {
  const result: AstraListDates = {};
  for (const field of ['startedAt', 'completedAt'] as const) {
    if (value[field] !== undefined) result[field] = readAstraDate(value[field]);
  }
  return result;
}

/** Only explicit fields of this owner/media's durable intent override remote dates. */
export function queuedAstraDates(entries: QueuedMutation[], mediaId: number, userId: number): AstraListDates {
  const dates: AstraListDates = {};
  for (const entry of entries) {
    if (entry.userId !== userId || entry.type !== 'ASTRA_SAVE' || entry.payload?.mediaId !== mediaId) continue;
    validateSyncPayload(entry.type, entry.payload);
    Object.assign(dates, copyAstraDates(entry.payload));
  }
  return dates;
}

/** Read this owner's latest durable list-field intent without attributing another account's queue. */
export function queuedAstraListState(entries: QueuedMutation[], mediaId: number, userId: number): AstraPendingListState {
  const state: AstraPendingListState = {};
  const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
  for (const entry of entries) {
    if (entry.userId !== userId || entry.type !== 'ASTRA_SAVE' || entry.payload?.mediaId !== mediaId) continue;
    validateSyncPayload(entry.type, entry.payload);
    const payload = entry.payload;
    for (const field of ['status', 'progress', 'repeat', 'private', 'hidden'] as const) {
      if (own(payload, field) && payload[field] !== undefined && payload[field] !== null) {
        (state as Record<string, unknown>)[field] = payload[field];
      }
    }
    if (own(payload, 'lists') && payload.lists !== undefined) state.customLists = [...(payload.lists ?? [])];
    Object.assign(state, copyAstraDates(payload));
  }
  return state;
}

/** Build once for a bulk import: do not scan the entire queue for each work. */
export function indexQueuedAstraDates(entries: QueuedMutation[], userId: number): Map<number, AstraListDates> {
  const index = new Map<number, AstraListDates>();
  for (const entry of entries) {
    if (entry.userId !== userId || entry.type !== 'ASTRA_SAVE') continue;
    validateSyncPayload(entry.type, entry.payload);
    const dates = copyAstraDates(entry.payload);
    if (Object.keys(dates).length === 0) continue;
    const mediaId = entry.payload.mediaId!; // Validated ASTRA_SAVE identity above.
    index.set(mediaId, { ...index.get(mediaId), ...dates });
  }
  return index;
}
