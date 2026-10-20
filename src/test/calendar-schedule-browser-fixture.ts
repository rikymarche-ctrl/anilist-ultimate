/** Calendar collection parsing and queued progress in isolated native Chromium. */
import { CalendarService } from '@modules/calendar/CalendarService';
import { calendarCollection, calendarListEntry } from './calendar-fixtures';

export async function runCalendarScheduleBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
  let context = { userId: 1, sessionId: 'schedule-one' };
  let calls = 0;
  let provider = async (chunk: number): Promise<unknown> => chunk === 1
    ? calendarCollection([calendarListEntry(), calendarListEntry()], true) : calendarCollection([calendarListEntry(2)]);
  let readQueue = async (): Promise<unknown> => [{ id: 'native-pending', retries: 0, userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 3 } },
    { id: 'native-foreign', retries: 0, userId: 2, type: 'ASTRA_SAVE', payload: { mediaId: 2, progress: 99 } }];
  const api = { ensureContext: async () => ({ ...context }), getContext: () => context,
    query: async (_query: string, variables: { chunk: number }) => { calls++; return provider(variables.chunk); } };
  const queue = { getQueue: () => readQueue() };
  const snapshots = { getSnapshot: async () => ({ revision: 'fixture', entries: await queue.getQueue() }) };
  const calendar = new CalendarService(api as never, {} as never, {} as never, { ...queue, ...snapshots } as never);
  const entries = await calendar.fetchAiringSchedule(1);
  assert(calls === 2 && entries.length === 2 && entries[0].progress === 3 && entries[1].progress === 10,
    'all chunks must load, duplicate groups must collapse and only owner pending progress must apply');
  checks.push('collection chunks and duplicate groups preserve exact owner-scoped pending progress');

  const row = calendarListEntry(); readQueue = async () => [];
  provider = async () => calendarCollection([null, { ...row, progress: null, media: { ...row.media, title: null, coverImage: null, episodes: null, siteUrl: null } },
    { ...calendarListEntry(2), media: null }]);
  const nullable = await calendar.fetchAiringSchedule(1);
  assert(nullable.length === 1 && nullable[0].progress === 0 && nullable[0].title === 'Anime 1' && nullable[0].coverImage === '' && nullable[0].totalEpisodes === null,
    'schema nullable fields must normalize while deleted media are excluded');
  checks.push('nullable progress, titles, covers and deleted media normalize without unrelated content');

  let reads = 0; provider = async () => calendarCollection();
  readQueue = async () => ++reads === 1 ? [{ id: 'native-pending', retries: 0, userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: 11 } }] : [];
  assert((await calendar.fetchAiringSchedule(1))[0].progress === 11, 'sync finishing during remote read must not restore stale progress');
  reads = 0;
  readQueue = async () => [{ id: 'native-pending', retries: 0, userId: 1, type: 'ASTRA_SAVE', payload: { mediaId: 1, progress: ++reads === 1 ? 11 : 0 } }];
  assert((await calendar.fetchAiringSchedule(1))[0].progress === 0, 'a later queued decrease to zero must replace the earlier value');
  checks.push('queue snapshots preserve in-flight sync and newer deliberate decreases including zero');

  readQueue = async () => []; provider = async () => calendarCollection([{ ...calendarListEntry(), userId: 2 }]);
  const wrongIdentity = await calendar.fetchAiringSchedule(1).then(() => false, () => true);
  assert(wrongIdentity, 'another owner must not publish a schedule');
  const beforeSwitch = calls; context = { userId: 2, sessionId: 'schedule-two' };
  const changed = await calendar.fetchAiringSchedule(1).then(() => false, () => true);
  assert(changed && calls === beforeSwitch, 'a changed account must stop before sending the owner query');
  checks.push('response owner identity and account context reject unrelated schedules before publication');
  return checks;
}
