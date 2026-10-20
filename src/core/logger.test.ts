import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';
import { ApiError } from './errors/ErrorTypes';

afterEach(() => {
  logger.disable();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('logger privacy at console sinks', () => {
  it.each(['debug', 'info', 'warn', 'error', 'success'] as const)('sanitizes messages and structured DEV data for %s', level => {
    vi.stubEnv('DEV', true);
    logger.enable();
    const sink = vi.spyOn(console, 'log').mockImplementation(() => {});
    const getter = vi.fn(() => { throw new Error('getter secret'); });
    const data = Object.defineProperty({ token: 'token-secret', state: 'state-secret', status: 401 }, 'detail', { enumerable: true, get: getter });
    logger[level]('Request https://example.test/?access%5Ftoken=url-secret', data);
    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/token-secret|state-secret|url-secret|getter secret/);
    expect(sink.mock.calls[0][2]).toEqual({ token: '[redacted]', state: '[redacted]', status: 401, detail: '[omitted accessor]' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('omits production data without inspecting it and still reports disabled errors', () => {
    vi.stubEnv('DEV', false);
    logger.disable();
    const sink = vi.spyOn(console, 'log').mockImplementation(() => {});
    const getter = vi.fn(() => { throw new Error('production getter secret'); });
    const data = Object.defineProperty({}, 'detail', { enumerable: true, get: getter });
    logger.error('Failure token=message-secret', data);
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]).toHaveLength(2);
    expect(sink.mock.calls[0][0]).not.toContain('message-secret');
    expect(getter).not.toHaveBeenCalled();
  });
  it('preserves safe DEV API classification without error causes or request data', () => {
    vi.stubEnv('DEV', true);
    const sink = vi.spyOn(console, 'log').mockImplementation(() => {});
    const original = new ApiError('Failure token=message-secret', 503, 'https://example.test/api', 2, new Error('cause-secret'));
    logger.error('Request failed', original);
    const safe = sink.mock.calls[0][2] as ApiError;
    expect(safe).toBeInstanceOf(ApiError);
    expect(safe.isRetryable()).toBe(true);
    expect(safe.statusCode).toBe(503);
    expect(safe).not.toHaveProperty('originalError');
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/message-secret|cause-secret/);
  });
  it('sanitizes DEV tables and suppresses tables in production', () => {
    logger.enable();
    const sink = vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.stubEnv('DEV', true);
    logger.table([{ notes: 'note-secret', status: 400 }]);
    expect(sink).toHaveBeenCalledWith([{ notes: '[redacted]', status: 400 }]);
    vi.stubEnv('DEV', false);
    logger.table({ token: 'production-secret' });
    expect(sink).toHaveBeenCalledOnce();
  });
  it('sanitizes group and timing labels', () => {
    logger.enable();
    const group = vi.spyOn(console, 'group').mockImplementation(() => {});
    const collapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const time = vi.spyOn(console, 'time').mockImplementation(() => {});
    const timeEnd = vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    const label = 'Request token=label-secret';
    logger.group(label);
    logger.group(label, true);
    logger.time(label);
    logger.timeEnd(label);
    for (const sink of [group, collapsed, time, timeEnd]) {
      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0][0]).not.toContain('label-secret');
    }
    expect(time.mock.calls[0][0]).toBe(timeEnd.mock.calls[0][0]);
  });
});
