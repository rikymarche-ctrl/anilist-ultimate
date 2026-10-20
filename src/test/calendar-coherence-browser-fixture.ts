/** Durable revision RPC and native invalidations on an isolated extension page. */
import { syncListEntry, syncAcknowledgement } from './sync-fixtures';
import { SyncQueueClient } from '@core/services/SyncQueueClient';
import { SyncQueueService } from '@core/services/SyncQueueService';
import { CalendarService } from '@modules/calendar/CalendarService';
import { CalendarDataService } from '@modules/calendar/services/CalendarDataService';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG } from '@shared/messages';
import { STORAGE_PREFIX } from '@core/constants';
import { calendarCollection, calendarEntry, calendarListEntry } from './calendar-fixtures';

export async function runCalendarCoherenceBrowserFixture(): Promise<string[]> {
  const checks: string[] = []; const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const key = `${STORAGE_PREFIX}sync_queue_v1`; const saved = await chrome.storage.local.get(key);
  const status = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
  const metadata = { ensureInitialized: async () => {}, getSessionId: () => status.sessionId };
  const bus = new EventBus(); let signals = 0; const stop = bus.on(EVENT_TYPES.SYNC_QUEUE_CHANGED, () => { signals++; });
  const first = new SyncQueueClient(metadata as never, bus); const second = new SyncQueueClient(metadata as never);
  const waitFor = async (condition: () => boolean) => {
    for (let spin = 0; spin < 100 && !condition(); spin++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(condition(), 'native queue invalidation was not delivered');
  };
  try {
    await chrome.storage.local.set({ [key]: { schemaVersion: 2, revision: 'native-one', entries: [] } });
    await waitFor(() => signals >= 1);
    const snapshot = await first.getSnapshot(); const other = await second.getSnapshot();
    assert(snapshot.revision === 'native-one' && other.revision === snapshot.revision && !snapshot.entries.length,
      'two real RPC clients must read the same opaque persisted revision');
    checks.push('two native RPC clients share an opaque durable queue revision and receive value-free invalidations');

    const values = new Map<string, unknown>(); const cache = { get: async (name: string) => values.get(name),
      set: async (name: string, value: unknown) => { values.set(name, value); }, delete: async (name: string) => { values.delete(name); }, clear: async () => { values.clear(); } };
    let progress = 10; let fetches = 0;
    const api = { ensureContext: async () => ({ userId: 1, sessionId: 'fixture' }), getContext: () => ({ userId: 1, sessionId: 'fixture' }) };
    const store = new CalendarStore({} as never, { create: () => cache } as never, api as never);
    const data = new CalendarDataService(bus, { fetchAiringSchedule: async () => { fetches++; return [calendarEntry(1, { progress })]; } } as never,
      {} as never, store, api as never, second);
    await data.loadSchedule(1); await data.loadSchedule(1); assert(fetches === 1, 'an unchanged durable revision should retain the cache hit');
    first.dispose(); progress = 0;
    await chrome.storage.local.set({ [key]: { schemaVersion: 2, revision: 'native-two', entries: [] } });
    await data.loadSchedule(1);
    assert(fetches === 2 && store.getState().entries[0].progress === 0, 'missed native signal must not make a cache hit revive the previous progress');
    checks.push('durable RPC revision checks invalidate cached progress even when its native listener missed the signal');

    const storageValues = new Map<string, unknown>(); let remoteProgress = 10; let queries = 0; let release!: (value: unknown) => void;
    const storage = { get: async (name: string) => structuredClone(storageValues.get(name) ?? null),
      set: async (name: string, value: unknown) => { storageValues.set(name, structuredClone(value)); return true; } };
    const writerApi = { query: async () => ({ MediaList: syncListEntry(1, 1, remoteProgress) }),
      mutate: async (_query: string, variables: Record<string, unknown>) => { remoteProgress = Number(variables.progress); return syncAcknowledgement(1, 1); }, getQueueStatus: () => ({ isRateLimited: false }) };
    const auth = { ensureInitialized: async () => {}, hasToken: () => true, getUserCache: () => ({ userId: 1 }), getSessionId: () => 'fixture' };
    const logger = { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
    const writer = new SyncQueueService(storage as never, logger as never, writerApi as never, auth as never);
    const collectionApi = { ...api, query: async () => { queries++; if (queries === 1) return new Promise(resolve => { release = resolve; });
      return calendarCollection([{ ...calendarListEntry(), progress: remoteProgress }]); } };
    const calendar = new CalendarService(collectionApi as never, {} as never, {} as never, writer);
    const pending = calendar.fetchAiringSchedule(1);
    for (let spin = 0; spin < 30 && !release; spin++) await Promise.resolve();
    assert(!!release, 'initial collection read must be pending before the concurrent update');
    await writer.updateProgress(1, 0, 'fixture'); assert(!(await writer.getQueue()).length, 'completed synthetic sync must leave an empty queue');
    release(calendarCollection([{ ...calendarListEntry(), progress: 10 }]));
    assert((await pending)[0].progress === 0 && queries === 2, 'durable revision must reject an obsolete empty-before/empty-after read');
    checks.push('completed synthetic sync between empty queue snapshots forces a complete calendar reread and preserves zero');
    return checks;
  } finally {
    first.dispose(); second.dispose(); stop.unsubscribe();
    if (Object.prototype.hasOwnProperty.call(saved, key)) await chrome.storage.local.set({ [key]: saved[key] });
    else await chrome.storage.local.remove(key);
  }
}
