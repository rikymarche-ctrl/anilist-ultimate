import { assertNotesLength } from './NotesSafety';

const statuses = new Set(['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']);
export interface SyncPayload {
  mediaId?: number; status?: string | null; progress?: number | null;
  score?: number | null; repeat?: number | null;
  private?: boolean | null; hidden?: boolean | null; notes?: string | null;
  lists?: string[] | null;
  /** Internal precondition: exact remote text used to prepare this replacement. Never sent to AniList. */
  expectedNotes?: string | null;
  /** Internal automatic-report policy/version, rechecked by the background before dispatch. */
  astraNotesUpdatedAt?: number;
  startedAt?: { year?: number | null; month?: number | null; day?: number | null } | null;
  completedAt?: { year?: number | null; month?: number | null; day?: number | null } | null;
}
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2147483647;
const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || value === null || check(value);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = (value: unknown) => object(value) && Object.keys(value).every(k => ['year', 'month', 'day'].includes(k))
  && optional(value.year, v => integer(v) && (v as number) >= 1)
  && optional(value.month, v => integer(v) && (v as number) >= 1 && (v as number) <= 12)
  && optional(value.day, v => integer(v) && (v as number) >= 1 && (v as number) <= 31);

/** Runtime boundary for untrusted messages and persisted mutations; never accepts arbitrary queries. */
export function validateSyncPayload(type: unknown, payload: unknown): asserts payload is SyncPayload {
  if (type === 'ASTRA_DELETE') {
    if (!object(payload) || !integer(payload.mediaId) || (payload.mediaId as number) < 1
      || Object.keys(payload).some(key => key !== 'mediaId')) throw new Error('Invalid deletion payload');
    return;
  }
  if (type !== 'ASTRA_SAVE' || !object(payload)) throw new Error('Invalid sync mutation');
  const allowed = ['mediaId', 'status', 'progress', 'score', 'repeat', 'private', 'hidden', 'notes', 'lists', 'startedAt', 'completedAt', 'expectedNotes', 'astraNotesUpdatedAt'];
  const id = payload.mediaId;
  if (!integer(id) || (id as number) < 1 || !Object.keys(payload).every(key => allowed.includes(key))
    || !optional(payload.status, v => statuses.has(v as string))
    || !optional(payload.progress, integer) || !optional(payload.repeat, integer)
    || !optional(payload.score, v => integer(v) && (v as number) <= 100)
    || !optional(payload.notes, v => typeof v === 'string' && v.length <= 512 * 1024)
    || !optional(payload.expectedNotes, v => typeof v === 'string' && v.length <= 512 * 1024)
    || (payload.expectedNotes !== undefined && payload.notes === undefined)
    || (payload.astraNotesUpdatedAt !== undefined && (payload.notes === undefined || payload.expectedNotes === undefined
      || !Number.isSafeInteger(payload.astraNotesUpdatedAt) || (payload.astraNotesUpdatedAt as number) < 0))
    || !optional(payload.private, v => typeof v === 'boolean')
    || !optional(payload.hidden, v => typeof v === 'boolean')
    || !optional(payload.lists, v => Array.isArray(v) && v.length <= 100 && v.every(entry => typeof entry === 'string' && entry.length <= 200))
    || !optional(payload.startedAt, date) || !optional(payload.completedAt, date)) throw new Error('Invalid sync payload');
  if (payload.notes !== undefined) assertNotesLength(payload.notes as string | null);
}
