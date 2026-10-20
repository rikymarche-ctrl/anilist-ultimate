import { describe, expect, it } from 'vitest';
import { parseAuthSessionId, parseAuthStatus, parseAuthUserCache } from './AuthMetadata';

describe('authentication metadata projection', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, '1', null, undefined])('rejects malformed authenticated owner %j', userId => {
    expect(() => parseAuthStatus({ authenticated: true, userId, sessionId: 'one' })).toThrow('Invalid authentication metadata');
  });
  it.each([undefined, null, '', ' ', 1, {}, []])('requires a session for authenticated status: %j', sessionId => {
    expect(() => parseAuthStatus({ authenticated: true, userId: 1, sessionId })).toThrow('Invalid authentication metadata');
  });
  it.each([null, undefined, {}, [], true, { authenticated: 'true' }])('rejects malformed public status %j', status => {
    expect(() => parseAuthStatus(status)).toThrow('Invalid authentication metadata');
  });
  it('projects authenticated metadata without credentials or borrowed object references', () => {
    const raw = { authenticated: true, userId: 1, userName: 'Literal <name>', sessionId: 'one', token: 'private', extra: {} };
    const result = parseAuthStatus(raw); raw.userName = 'Changed';
    expect(result).toEqual({ authenticated: true, userId: 1, userName: 'Literal <name>', sessionId: 'one' });
    expect(parseAuthStatus({ authenticated: true, userId: 2147483647, sessionId: 'opaque value' })).toEqual({ authenticated: true, userId: 2147483647, sessionId: 'opaque value' });
    expect(() => parseAuthStatus({ authenticated: true, userId: 1, sessionId: 'one', userName: {} })).toThrow('Invalid authentication metadata');
  });
  it('removes owner metadata from an anonymous status, preserving its valid session', () => {
    expect(parseAuthStatus({ authenticated: false, userId: 'invalid', userName: {}, token: 'private', sessionId: 'one' })).toEqual({ authenticated: false, sessionId: 'one' });
    expect(parseAuthStatus({ authenticated: false })).toEqual({ authenticated: false });
  });
  it('accepts absent stored metadata and returns independent cache projections', () => {
    expect(parseAuthUserCache(null)).toBeNull(); expect(parseAuthUserCache(undefined)).toBeNull();
    const raw = { userId: 1, userName: 'One', token: 'private' };
    const parsed = parseAuthUserCache(raw); raw.userName = 'Changed';
    expect(parsed).toEqual({ userId: 1, userName: 'One' });
    expect(parseAuthUserCache({ userId: 1, userName: '' })).toEqual({ userId: 1, userName: '' });
  });
  it.each([{}, [], 'cache', { userId: 0, userName: 'One' }, { userId: 2147483648, userName: 'One' },
    { userId: '1', userName: 'One' }, { userId: 1 }, { userId: 1, userName: null }])('rejects malformed stored user cache %j', value => {
    expect(() => parseAuthUserCache(value)).toThrow('Invalid authentication metadata');
  });
  it('keeps absent sessions distinct from malformed values', () => {
    expect(parseAuthSessionId(undefined)).toBeUndefined(); expect(parseAuthSessionId(null)).toBeUndefined();
    expect(parseAuthSessionId('opaque value')).toBe('opaque value');
    expect(() => parseAuthSessionId({})).toThrow('Invalid authentication metadata');
  });
});
