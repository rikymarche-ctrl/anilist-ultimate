import { isRecord } from '@/api/GraphQLResponse';
import type { AuthStatusResponse, UserCache } from '@shared/messages';

function invalid(): never { throw new Error('Invalid authentication metadata'); }

export function isAuthUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

/** Session identifiers are opaque: validate without changing their value. */
export function parseAuthSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

/** Absence is legitimate; malformed persisted metadata is never an owner. */
export function parseAuthUserCache(value: unknown): UserCache | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isAuthUserId(value.userId) || typeof value.userName !== 'string') invalid();
  return { userId: value.userId, userName: value.userName };
}

/** Public status is projected separately from credentials and persisted values. */
export function parseAuthStatus(value: unknown): AuthStatusResponse {
  if (!isRecord(value) || typeof value.authenticated !== 'boolean') invalid();
  const sessionId = parseAuthSessionId(value.sessionId);
  if (!value.authenticated) return sessionId === undefined ? { authenticated: false } : { authenticated: false, sessionId };
  if (!isAuthUserId(value.userId) || sessionId === undefined
    || (value.userName !== undefined && typeof value.userName !== 'string')) invalid();
  return { authenticated: true, userId: value.userId, sessionId,
    ...(value.userName === undefined ? {} : { userName: value.userName }) };
}
