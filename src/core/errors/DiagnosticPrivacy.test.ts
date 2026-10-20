import { describe, expect, it, vi } from 'vitest';
import { diagnosticError, diagnosticText, diagnosticValue } from './DiagnosticPrivacy';
import { ErrorHandler } from './ErrorHandler';
import { ApiError } from './ErrorTypes';
import { EVENT_TYPES } from '@core/events/EventTypes';

describe('diagnostic privacy', () => {
  it('redacts OAuth metadata, encoded query keys and URL user credentials', () => {
    expect(diagnosticValue({ state: 'oauth-secret', refresh_token: 'refresh-secret', client_secret: 'client-secret' })).toEqual({ state: '[redacted]', refresh_token: '[redacted]', client_secret: '[redacted]' });
    for (const text of [
      'Failed https://example.test/?access%5Ftoken=encoded-secret&ok=1',
      'Failed https://example.test/#access_token%3Dfragment-secret%26state%3Dstate-secret',
      'Failed https://private-user:private-password@example.test/api?ok=1',
      'Failed https://example.test/?access%5Ftoken=encoded-secret#malformed%3D%ZZ',
    ]) {
      const safe = diagnosticText(text);
      expect(safe).not.toMatch(/encoded-secret|fragment-secret|state-secret|private-user|private-password/);
      expect(safe).toContain('example.test');
    }
  });
  it('does not evaluate private or public getters or toJSON functions', () => {
    const getter = vi.fn(() => { throw new Error('private getter'); });
    const serialize = vi.fn(() => ({ token: 'serialized-secret' }));
    const original = Object.defineProperties({ ok: 400, toJSON: serialize }, {
      token: { enumerable: true, get: getter },
      detail: { enumerable: true, get: getter },
    });
    const safe = diagnosticValue(original);
    expect(JSON.stringify(safe)).not.toContain('serialized-secret');
    expect(safe).toMatchObject({ token: '[redacted]', detail: '[omitted accessor]', ok: 400 });
    expect(getter).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
  });
  it('does not evaluate array accessors while retaining useful values', () => {
    const getter = vi.fn(() => { throw new Error('private array getter'); });
    const original = [400, 'token=array-secret'];
    Object.defineProperty(original, '2', { enumerable: true, get: getter });
    expect(diagnosticValue(original)).toEqual([400, 'token=[redacted]', '[omitted accessor]']);
    expect(getter).not.toHaveBeenCalled();
  });
  it('removes untrusted Error subclass getters and serializers while preserving API classification', () => {
    const serialize = vi.fn(() => ({ body: 'subclass-secret' }));
    const getter = vi.fn(() => { throw new Error('private error getter'); });
    class TransportError extends ApiError {
      toJSON() { return serialize(); }
    }
    Object.defineProperty(TransportError.prototype, 'privateDetail', { get: getter, enumerable: true });
    const original = new TransportError('Network unavailable', 503, 'https://example.test/api', 2);
    Object.defineProperty(original, 'message', { get: getter });
    Object.defineProperty(original, 'stack', { value: { body: 'invalid stack secret' } });
    Object.defineProperty(original, 'context', { get: getter });
    const safe = diagnosticError(original);
    expect(safe).toBeInstanceOf(ApiError);
    expect((safe as ApiError).isRetryable()).toBe(true);
    expect((safe as ApiError).statusCode).toBe(503);
    expect(safe.message).toBe('[omitted accessor]');
    expect(safe).not.toHaveProperty('privateDetail');
    expect(JSON.stringify(safe)).not.toContain('subclass-secret');
    expect(getter).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
  });
  it('contains failures inspecting revoked proxies without exposing the thrown payload', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(diagnosticValue(proxy)).toBe('[unavailable diagnostic data]');
  });
  it('does not retain inherited serializers on otherwise ordinary errors', () => {
    const serialize = vi.fn(() => ({ token: 'inherited-serialization-secret' }));
    class TransportError extends ApiError {
      toJSON() { return serialize(); }
    }
    const original = new TransportError('Request failed', 429, 'https://example.test/api');
    original.name = 'TransportError token=name-secret';
    const safe = diagnosticError(original);
    expect(safe).toBeInstanceOf(ApiError);
    expect(safe.name).not.toContain('name-secret');
    expect(JSON.stringify(safe)).not.toContain('inherited-serialization-secret');
    expect(serialize).not.toHaveBeenCalled();
  });
  it('redacts credentials, URLs and serialized GraphQL payloads', () => {
    expect(diagnosticText('Authorization: Bearer secret-token')).not.toContain('secret-token');
    expect(diagnosticText('https://example.test/#access_token=secret&state=private')).not.toContain('secret');
    expect(diagnosticText('Transport error: variables: { notes: "private text" }')).not.toContain('private text');
    expect(diagnosticValue({ notes: 'private', headers: { Authorization: 'secret' }, nested: { token: 'other' }, ok: 400 })).toEqual({ notes: '[redacted]', headers: '[redacted]', nested: { token: '[redacted]' }, ok: 400 });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => diagnosticValue(circular)).not.toThrow();
  });
  it('sanitizes history, logging and events while preserving API error classification', () => {
    const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const bus = { emit: vi.fn() };
    const handler = new ErrorHandler(logger as never, bus as never);
    const original = new ApiError('Transport error variables: { notes: "private" }', 401, 'https://example.test/?access_token=secret', 0, new Error('private cause'));
    Object.assign(original, { request: { token: 'secret', notes: 'private' } });
    handler.handle(original);
    expect(bus.emit).toHaveBeenCalledWith(EVENT_TYPES.AUTH_REQUIRED);
    const safe = handler.getStats().errorHistory[0].error;
    expect(safe).toBeInstanceOf(ApiError);
    expect(safe).not.toHaveProperty('originalError');
    expect(safe).not.toHaveProperty('request');
    expect(handler.getExportableLogs()).not.toContain('private');
    expect(handler.getExportableLogs()).not.toContain('secret');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private');
    safe.message = 'modified outside';
    expect(handler.getStats().errorHistory[0].error.message).not.toBe('modified outside');
  });
});
