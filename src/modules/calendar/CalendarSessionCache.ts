/**
 * @file CalendarSessionCache.ts
 * @description Browser-session persistence for the calendar schedule
 *
 * The in-memory schedule cache dies with every page load, so each reload of
 * AniList waited for a fresh collection read in the shared API queue. This layer
 * keeps the last schedule in `chrome.storage.session` (memory-backed, cleared when
 * the browser closes, unreadable by content scripts) behind a worker protocol:
 *   - the worker binds the record to the auth session and viewer that wrote it;
 *   - the content side additionally requires the sync queue revision to match,
 *     so a queued or completed edit always forces a provider read.
 *
 * @see CalendarStore.ts for the in-memory layer in front of it
 * @see BackgroundRouter.ts for the MSG.CALENDAR_CACHE route
 */

import { injectable } from 'tsyringe';
import { isRecord } from '@/api/GraphQLResponse';
import { MSG } from '@shared/messages';
import { isCalendarId } from './CalendarEntries';

export const CALENDAR_SESSION_TTL_MS = 30 * 60 * 1000;
const STORAGE_KEY = 'au_calendar_schedule';
/** A calendar holds tens of entries; anything far larger is not a schedule. */
const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;

/** What the content script stores and reads back. Entries are JSON (dates as ISO strings). */
export interface CalendarSessionPayload {
  queueRevision: string;
  fingerprint: string;
  entries: unknown[];
}

interface CalendarSessionRecord extends CalendarSessionPayload {
  sessionId: string;
  userId: number;
  savedAt: number;
}

export interface CalendarCacheOwner {
  authenticated: boolean;
  userId?: number | null;
  sessionId?: string;
}

function payload(value: unknown): CalendarSessionPayload {
  if (
    !isRecord(value) ||
    typeof value.queueRevision !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(value.queueRevision) ||
    typeof value.fingerprint !== 'string' ||
    value.fingerprint.length > 32 ||
    !Array.isArray(value.entries) ||
    JSON.stringify(value.entries).length > MAX_PAYLOAD_CHARS
  )
    throw new Error('Invalid calendar session cache');
  return {
    queueRevision: value.queueRevision,
    fingerprint: value.fingerprint,
    entries: value.entries,
  };
}

/**
 * Worker side: executes one cache operation for the caller's verified owner.
 * Only one record exists, so writing for a new account drops the previous one.
 */
export async function dispatchCalendarSessionCache(
  operation: unknown,
  value: unknown,
  owner: CalendarCacheOwner,
  now: number = Date.now()
): Promise<CalendarSessionPayload | null> {
  const storage = chrome.storage.session;
  if (!storage) return null;
  if (operation === 'clear') {
    await storage.remove(STORAGE_KEY);
    return null;
  }
  if (!owner.authenticated || !isCalendarId(owner.userId) || !owner.sessionId)
    throw new Error('Calendar cache owner required');
  if (operation === 'set') {
    const record: CalendarSessionRecord = {
      ...payload(value),
      sessionId: owner.sessionId,
      userId: owner.userId,
      savedAt: now,
    };
    await storage.set({ [STORAGE_KEY]: record });
    return null;
  }
  if (operation !== 'get') throw new Error('Unknown calendar cache operation');
  const stored: unknown = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
  if (stored === undefined) return null;
  try {
    if (
      !isRecord(stored) ||
      stored.sessionId !== owner.sessionId ||
      stored.userId !== owner.userId ||
      typeof stored.savedAt !== 'number' ||
      now < stored.savedAt ||
      now - stored.savedAt >= CALENDAR_SESSION_TTL_MS
    )
      return null;
    return payload(stored);
  } catch {
    await storage.remove(STORAGE_KEY);
    return null;
  }
}

/** Content side of the protocol. Every failure reads as "not cached"; callers treat this layer as best effort. */
@injectable()
export class CalendarSessionCacheClient {
  public async read(sessionId: string): Promise<CalendarSessionPayload | null> {
    const data = await this.send('get', sessionId);
    return data === null || data === undefined ? null : payload(data);
  }

  public async write(sessionId: string, value: CalendarSessionPayload): Promise<void> {
    await this.send('set', sessionId, value);
  }

  public async clear(sessionId: string): Promise<void> {
    await this.send('clear', sessionId);
  }

  private async send(
    operation: 'get' | 'set' | 'clear',
    sessionId: string,
    value?: CalendarSessionPayload
  ): Promise<unknown> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return null;
    const response: unknown = await chrome.runtime.sendMessage({
      type: MSG.CALENDAR_CACHE,
      operation,
      sessionId,
      value,
    });
    if (!isRecord(response) || response.success !== true)
      throw new Error('Calendar session cache operation failed');
    return response.data;
  }
}
