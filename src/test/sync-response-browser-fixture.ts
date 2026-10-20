import { SyncQueueService } from '@core/services/SyncQueueService';
import { syncListEntry, syncAcknowledgement } from './sync-fixtures';

export async function runSyncResponseBrowserFixture(): Promise<string[]> {
  const checks: string[] = []; const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const values = new Map<string, unknown>(); let writes = 0; let mutations = 0;
  const storage = { get: async (key: string) => structuredClone(values.get(key) ?? null),
    set: async (key: string, value: unknown) => { writes++; values.set(key, structuredClone(value)); return true; } };
  let response: unknown = { MediaList: syncListEntry() }; let acknowledgement: unknown = syncAcknowledgement();
  let pendingReply: Promise<unknown> | null = null;
  const api = { query: async () => response, mutate: async () => { mutations++; return pendingReply ? await pendingReply : acknowledgement; },
    getQueueStatus: () => ({ isRateLimited: false }) };
  const auth = { ensureInitialized: async () => {}, hasToken: () => true, getSessionId: () => 'one', getUserCache: () => ({ userId: 1 }) };
  const logger = { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
  const queue = new SyncQueueService(storage as never, logger as never, api as never, auth as never);
  response = { MediaList: { ...syncListEntry(), userId: 2 } };
  const wrongProgress = await queue.updateProgress(7, 4, 'one').then(() => false, () => true);
  assert(wrongProgress && !writes && !mutations, 'unrelated progress identity must stop before any durable mutation');
  checks.push('progress commands reject unrelated response owners before enqueue or remote writes');
  response = { MediaList: { ...syncListEntry(), mediaId: 8 } };
  const wrongNotes = await queue.appendNote(7, 1, 'Local', 'one').then(() => false, () => true);
  assert(wrongNotes && !writes && !mutations, 'unrelated note baseline must not overwrite private text');
  checks.push('note baselines require the requested media and owner before appending private text');
  response = { MediaList: syncListEntry() }; acknowledgement = { SaveMediaListEntry: { ...syncAcknowledgement().SaveMediaListEntry, userId: 2 } };
  await queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 0 }, 'one'); await queue.process();
  assert((await queue.getQueue())[0]?.payload.progress === 0 && (await queue.getQueue())[0]?.retries === 1,
    'unconfirmed acknowledgements must preserve the durable zero update for retry');
  checks.push('malformed mutation acknowledgement preserves desired progress in the durable retry queue');
  await queue.clear(1); acknowledgement = syncAcknowledgement();
  let finish!: (value: unknown) => void; pendingReply = new Promise(resolve => { finish = resolve; });
  const beforeMutations = mutations; const increment = queue.updateProgress(7, undefined, 'one');
  for (let spin = 0; spin < 100 && mutations === beforeMutations; spin++) await Promise.resolve();
  assert(mutations === beforeMutations + 1, 'increment must have reached its gated remote request');
  await queue.enqueue('ASTRA_SAVE', { mediaId: 7, progress: 0, status: 'COMPLETED' }, 'one'); finish(syncAcknowledgement());
  const result = await increment;
  assert(result.progress === 0 && result.status === 'COMPLETED' && result.syncState === 'queued', 'public result must reflect the newer durable save, not the superseded increment');
  checks.push('a newer durable save supersedes an in-flight increment in both its queue and public result');
  return checks;
}
