/** Real calendar cache/loading services over synthetic account and provider data. */
import { CacheFactory } from '@core/cache/CacheFactory';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { CalendarDataService } from '@modules/calendar/services/CalendarDataService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AnimeEntry } from '@core/types';
import { calendarEntry } from './calendar-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

export async function runCalendarCacheBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
  const until = async (predicate: () => boolean): Promise<void> => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Calendar cache fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  let context = { userId: 1, sessionId: 'cache-one' };
  const api = { ensureContext: async () => ({ ...context }), getContext: () => context };
  const storage = { get: async () => { throw new Error('Schedule must not read persistent storage'); },
    set: async () => { throw new Error('Schedule must not write persistent storage'); },
    remove: async () => { throw new Error('Schedule must not clear persistent storage'); } };
  const bus = new EventBus();
  const logger = { debug: () => {}, error: () => {} };
  const factory = new CacheFactory(storage as never, logger as never, bus);
  const store = new CalendarStore(storage as never, factory, api as never);
  let fetches = 0;
  let provider = async (): Promise<AnimeEntry[]> => [calendarEntry()];
  const calendar = { fetchAiringSchedule: () => { fetches++; return provider(); },
    incrementProgress: async () => ({ mediaId: 1, userId: 1, previousProgress: 10, progress: 11 }) };
  const data = new CalendarDataService(bus, calendar as never, { success: () => {} } as never, store, api as never);
  const source = [calendarEntry(1, { friendActivity: [{ id: 4, status: MediaListStatus.CURRENT, progress: 3, score: 80,
    user: { id: 5, name: 'Friend', avatar: { medium: 'https://example.com/avatar.jpg' } } }] })];
  await store.saveEntriesToCache(source, 1);
  source[0].progress = 99; source[0].airingAt.setFullYear(1999); source[0].friendActivity![0].user.name = 'Changed';
  const first = (await store.loadEntriesFromCache(1))!;
  assert(first[0].progress === 10 && first[0].airingAt.getFullYear() === 2026 && first[0].friendActivity![0].user.name === 'Friend', 'cache must own its nested data graph');
  first[0].progress = 55; first[0].airingAt.setFullYear(2000);
  const second = (await store.loadEntriesFromCache(1))!;
  assert(second[0].progress === 10 && second[0].airingAt.getFullYear() === 2026, 'each cache read must return independent entries and Date objects');
  checks.push('real in-memory cache isolates Date, progress and nested social data without persistent storage');

  await data.loadSchedule(1); provider = async () => [];
  await data.loadSchedule(1, true); await data.loadSchedule(1);
  assert(fetches === 1 && store.getState().entries.length === 0, 'confirmed empty refresh must replace cached titles and remain a cache hit');
  checks.push('empty provider refresh replaces old titles and remains a confirmed cache hit');

  const older = deferred<AnimeEntry[]>(); provider = () => older.promise;
  const oldLoad = data.loadSchedule(1, true).then(() => false, () => true);
  await until(() => fetches === 2); provider = async () => [calendarEntry(2)];
  await data.loadSchedule(1, true); older.resolve([calendarEntry(1)]);
  assert(await oldLoad, 'older schedule must be rejected');
  assert(store.getState().entries[0].mediaId === 2 && (await store.loadEntriesFromCache(1))![0].mediaId === 2, 'older schedule must not overwrite newer state or cache');
  checks.push('out-of-order schedule responses preserve the latest state and cache');

  store.setEntries([calendarEntry(1)]);
  const beforeProgress = deferred<AnimeEntry[]>(); provider = () => beforeProgress.promise;
  const progressLoad = data.loadSchedule(1, true).then(() => false, () => true);
  await until(() => fetches === 4); await data.updateProgress(1); beforeProgress.resolve([calendarEntry(1)]);
  assert(await progressLoad, 'accepted progress must invalidate the earlier read');
  assert(store.getState().entries[0].progress === 11 && await store.loadEntriesFromCache(1) === null, 'accepted increment must survive and discard the obsolete cache');
  checks.push('accepted progress invalidates earlier reads without restoring their older progress');

  await store.saveEntriesToCache([calendarEntry(1)], 1);
  context = { userId: 1, sessionId: 'cache-two' };
  assert(await store.loadEntriesFromCache(1) === null, 'another session of the same owner must miss old cache');
  context = { userId: 2, sessionId: 'cache-three' }; bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 2, timestamp: new Date() });
  const wrongOwner = await store.loadEntriesFromCache(1).then(() => false, () => true);
  assert(wrongOwner && store.getState().entries.length === 0 && !store.getState().loading, 'account change must clear live data and reject wrong owner');
  checks.push('session and owner isolation rejects old cache and clears live calendar on account change');
  return checks;
}
