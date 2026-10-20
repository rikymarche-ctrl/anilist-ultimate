import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from './ToastService';
import { ToastContainer } from '@ui/components/ToastContainer';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';

describe('toast service account lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });
  function fixture() {
    const bus = new EventBus(); const updateNotes = vi.fn(async () => undefined);
    const service = new ToastService(bus, { updateNotes } as never);
    return { service, bus, updateNotes };
  }

  it('clears old-account toasts and rejects a retained old note callback', async () => {
    const capture = vi.spyOn(ToastContainer.prototype, 'addToast'); const f = fixture();
    f.service.success('Updated', { mediaId: 1, progress: 2 }); const oldSave = capture.mock.calls[0][1]!;
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 2, timestamp: new Date() });
    expect(document.querySelector('.au-toast')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    await expect(oldSave(1, 'Old note')).rejects.toThrow('account changed'); expect(f.updateNotes).not.toHaveBeenCalled();
    f.service.success('New', { mediaId: 1, progress: 0 }); await capture.mock.calls[1][1]!(1, 'New note');
    expect(f.updateNotes).toHaveBeenCalledWith(1, 0, 'New note'); f.service.destroy();
  });

  it('shows the first rate-limit warning at time zero and suppresses duplicates', () => {
    const f = fixture(); const warn = vi.spyOn(f.service, 'warn');
    const payload = { error: new Error('rate limit'), statusCode: 429, context: 'api', severity: 'high' as const, timestamp: new Date() };
    f.bus.emit(EVENT_TYPES.API_ERROR, payload); f.bus.emit(EVENT_TYPES.API_ERROR, payload);
    expect(warn).toHaveBeenCalledOnce(); f.service.destroy();
    f.bus.emit(EVENT_TYPES.API_ERROR, payload); expect(warn).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds duplicate-error tracking and cancels every toast on destroy', () => {
    const f = fixture(); vi.spyOn(f.service, 'error').mockImplementation(() => undefined);
    for (let index = 0; index < 200; index++) f.bus.emit(EVENT_TYPES.ERROR_OCCURRED, { error: new Error(`error ${index}`), context: 'test', severity: 'high', timestamp: new Date() });
    expect((f.service as unknown as { lastErrorMessages: Map<string, number> }).lastErrorMessages.size).toBe(100);
    f.service.info('One'); f.service.info('Two'); f.service.destroy(); expect(vi.getTimerCount()).toBe(0); expect(document.querySelector('.au-toast-container')).toBeNull();
  });
});
