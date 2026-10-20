import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorHandler } from './ErrorHandler';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';

describe('error handler function and listener lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('preserves receiver, arguments and return value in the async wrapper', async () => {
    const handler = new ErrorHandler(logger, new EventBus());
    const object = { base: 3, sum: handler.wrap(async function (this: { base: number }, addition: number) { return this.base + addition; }) };
    expect(await object.sum(4)).toBe(7);
  });
  it('reports non-Error rejections without changing the value thrown to the caller', async () => {
    const handler = new ErrorHandler(logger, new EventBus());
    const wrapped = handler.wrap(async () => { throw 'offline'; }, 'test');
    await expect(wrapped()).rejects.toBe('offline'); expect(handler.getStats().totalErrors).toBe(1);
    expect(handler.getStats().errorHistory[0].error.message).toBe('offline');
  });
  it('registers global handlers once and removes them on destroy/reinit', () => {
    const suppressSynthetic = (event: Event) => event.preventDefault();
    self.addEventListener('error', suppressSynthetic);
    const bus = new EventBus(); const errors = vi.fn(); bus.on(EVENT_TYPES.ERROR_OCCURRED, errors);
    const handler = new ErrorHandler(logger, bus); handler.setupGlobalHandlers(); handler.setupGlobalHandlers();
    try {
      self.dispatchEvent(new ErrorEvent('error', { cancelable: true, error: new Error('test') })); expect(errors).toHaveBeenCalledOnce();
      handler.destroy(); self.dispatchEvent(new ErrorEvent('error', { cancelable: true, error: new Error('ignored') })); expect(errors).toHaveBeenCalledOnce();
      handler.setupGlobalHandlers(); self.dispatchEvent(new ErrorEvent('error', { cancelable: true, message: 'again' })); expect(errors).toHaveBeenCalledTimes(2);
    } finally { handler.destroy(); self.removeEventListener('error', suppressSynthetic); }
  });
  it('does not serialize private objects thrown as global rejection reasons', () => {
    const handler = new ErrorHandler(logger, new EventBus()); handler.setupGlobalHandlers();
    const event = new Event('unhandledrejection'); Object.assign(event, { reason: { notes: 'private text', toString: () => 'private text' } });
    self.dispatchEvent(event); expect(handler.getExportableLogs()).not.toContain('private text'); handler.destroy();
  });
});
