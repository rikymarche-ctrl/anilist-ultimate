/** Compile-time regressions, included by tsc; never invoked at runtime. */
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
export function verifyEventContracts(bus: IEventBus): void {
  bus.emit(EVENT_TYPES.AUTH_REQUIRED);
  bus.emit(EVENT_TYPES.ASTRA_OPEN);
  bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, timestamp: new Date() });
  // @ts-expect-error A known event must not fall through to a dynamic unknown payload.
  bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: 'true', timestamp: new Date() });
  // @ts-expect-error Progress notifications require the owner and previous progress.
  bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 2 });
  // @ts-expect-error Known nonempty payloads are required.
  bus.emit(EVENT_TYPES.CALENDAR_LOADED);
  // @ts-expect-error Known subscriptions preserve their numeric payload fields.
  bus.on(EVENT_TYPES.PROGRESS_UPDATED, (data?: { mediaId: string }) => { void data; });
  bus.on('custom:extension-event', data => {
    // @ts-expect-error Dynamic events are unknown until explicitly narrowed.
    void data.mediaId;
  });
}
