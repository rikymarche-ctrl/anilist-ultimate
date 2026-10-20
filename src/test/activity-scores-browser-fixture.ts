/** Current score service/cache/module in isolated Chromium with synthetic API data. */
import 'reflect-metadata';
import { ActivityService } from '@modules/activity/ActivityService';
import { ActivityScoreModule } from '@modules/activity/ActivityScoreModule';
import { CacheFactory } from '@core/cache/CacheFactory';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/interfaces/ILogger';

export async function runActivityScoresBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (value: boolean, message: string): void => { if (!value) throw new Error(message); };
  const until = async (predicate: () => boolean): Promise<void> => {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Activity score fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const bus = new EventBus();
  const logger = { debug: () => {}, info: () => {}, error: () => {} } as unknown as ILogger;
  const serviceFactory = new CacheFactory({} as IStorageService, logger, bus);
  let context = { userId: 1, sessionId: 'synthetic-one' };
  let score = 85;
  let calls = 0;
  let paused = false;
  let release!: (value: unknown) => void;
  const row = (mediaId = 10, value = score) => ({ mediaId, userId: 7, score: value,
    user: { id: 7, name: 'Friend', mediaListOptions: { scoreFormat: 'POINT_100' } } });
  const api = {
    ensureContext: async () => ({ ...context }), getContext: () => context,
    query: async (_query: string, variables: Record<string, unknown>): Promise<unknown> => {
      calls++;
      if (paused) { paused = false; return new Promise(resolve => { release = resolve; }); }
      return Object.fromEntries(Object.keys(variables).filter(key => key.startsWith('m'))
        .map(key => [`s${key.slice(1)}`, row(variables[key] as number)]));
    },
  } as unknown as IApiClient;
  const service = new ActivityService(api, serviceFactory);
  const pairs = [{ userName: 'Friend', mediaId: 10 }];
  let rejected = false;
  try { await service.getScoresBatch([{ userName: 'Friend', mediaId: 2147483648 }]); } catch { rejected = true; }
  assert(rejected && calls === 0, 'invalid score IDs must fail before queries');
  paused = true;
  const malformed = service.getScoresBatch(pairs); await until(() => calls === 1);
  release({ s0: { ...row(), mediaId: 11 } });
  assert((await malformed).size === 0, 'another media score must not become a cached result');
  checks.push('production request/response identity validation omits unrelated scores');

  paused = true;
  const beforeShared = calls;
  const first = service.getScoresBatch([...pairs, ...pairs]); const second = service.getScoresBatch(pairs);
  await until(() => calls > beforeShared); release({ s0: row() });
  const [a, b] = await Promise.all([first, second]);
  assert(calls === beforeShared + 1 && a.size === 1 && b.size === 1, 'overlapping pairs must share one query');
  a.get('Friend-10')!.score = 1;
  assert(b.get('Friend-10')?.score === 85 && (await service.getScoresBatch(pairs)).get('Friend-10')?.score === 85, 'returned score objects must not alter cache or another caller');
  checks.push('real in-memory cache and overlapping requests preserve independent copies');

  context = { userId: 1, sessionId: 'synthetic-two' }; score = 80;
  assert((await service.getScoresBatch(pairs)).get('Friend-10')?.score === 80, 'the same account in a new session must not reuse an old cache');
  context = { userId: 2, sessionId: 'synthetic-three' }; score = 70;
  assert((await service.getScoresBatch(pairs)).get('Friend-10')?.score === 70, 'another account must use its own cache key');
  checks.push('cache keys isolate distinct accounts and repeated sessions of one account');

  await service.clearCache(); paused = true;
  const beforeLate = calls;
  const late = service.getScoresBatch(pairs).then(() => false, error => /cache changed/.test(String(error)));
  await until(() => calls > beforeLate); await service.clearCache(); release({ s0: row(10, 99) });
  assert(await late, 'a clear must invalidate pending score responses');
  score = 65;
  assert((await service.getScoresBatch(pairs)).get('Friend-10')?.score === 65, 'a late response must not repopulate the cleared cache');
  checks.push('clear invalidates real pending lookups and prevents stale cache restoration');

  const previousLocation = location.pathname + location.search + location.hash;
  const parent = document.createElement('div'); parent.className = 'activity-feed';
  parent.innerHTML = '<div class="activity-entry"><div class="list small"><a href="/user/Friend/">Friend</a><a href="/anime/10/title">Title</a></div></div>';
  const module = new ActivityScoreModule(service, bus);
  try {
    history.replaceState({}, '', '/home'); document.body.append(parent);
    await service.clearCache(); score = 85; await module.init();
    const badge = () => parent.querySelector('.au-activity-rating')?.textContent;
    await until(() => badge() === '85');
    assert(parent.querySelectorAll('.au-activity-rating').length === 1, 'nested native selectors must get one badge');
    score = 75; parent.querySelector('a[href^="/anime/"]')!.setAttribute('href', '/anime/20/title');
    await until(() => badge() === '75');
    context = { userId: 3, sessionId: 'synthetic-four' }; score = 60;
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 3, timestamp: new Date() });
    assert(badge() === undefined, 'auth changes must immediately remove the old badge');
    await until(() => badge() === '60'); await module.destroy();
    assert(badge() === undefined && !parent.querySelector('[data-au-score-enhanced]'), 'destroy must clean badges and markers');
    checks.push('native observer follows reused rows, avoids duplicate badges and clears account/destroy state');
  } finally { await module.destroy(); parent.remove(); history.replaceState({}, '', previousLocation); }
  return checks;
}
