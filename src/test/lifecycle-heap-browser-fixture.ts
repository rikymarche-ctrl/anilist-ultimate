import 'reflect-metadata';
import '@/styles/astra.css';
import { AstraWorkTable } from '@modules/astra/ui/components/AstraWorkTable';
import { AstraWindowPlanner } from '@modules/astra/ui/components/AstraWindowPlanner';
import type { AstraDashboardStore } from '@modules/astra/store/AstraDashboardStore';
import type { AstraService } from '@modules/astra/AstraService';
import type { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import type { AstraWorkSummary } from '@modules/astra/AstraInterfaces';
import type { AstraDashboardLayout, IDashboardState } from '@modules/astra/interfaces/IDashboardState';
import { SharedGlobalObserver, mutationsMatchSelector } from '@core/observers/SharedGlobalObserver';
import { MediaListStatus } from '@/api/AnilistTypes';
import { CacheFactory } from '@core/cache/CacheFactory';
import { CacheService } from '@core/cache/CacheService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { ILogger } from '@core/interfaces/ILogger';
import type { ICacheService } from '@core/interfaces/ICacheService';

// CDP queries these actual production prototypes, never retained instance arrays.
export const prototypes = { AstraWorkTable: AstraWorkTable.prototype,
  AstraWindowPlanner: AstraWindowPlanner.prototype, SharedGlobalObserver: SharedGlobalObserver.prototype,
  CacheFactory: CacheFactory.prototype, CacheService: CacheService.prototype };
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
// This bus intentionally outlives every factory. A per-cycle bus could allow GC
// to collect an unsubscribed factory/bus cycle and conceal subscription leaks.
const cacheBus = new EventBus();
let storageWrites = 0;
let storageRemovals = 0;
let cacheErrors = 0;
let rejectedCacheCommands = 0;
const cacheStorage: IStorageService = {
  get: async <T>(): Promise<T | null> => null,
  set: async () => { storageWrites++; return true; },
  remove: async () => { storageRemovals++; return true; },
  clear: async () => { throw new Error('Unexpected synthetic storage clear'); },
  has: async () => false,
  getMultiple: async <T extends Record<string, unknown>>(): Promise<Partial<T>> => ({}),
  setMultiple: async () => { throw new Error('Unexpected synthetic storage batch write'); },
  onChange: () => { throw new Error('Unexpected synthetic storage listener'); },
};
const noop = () => {};
const cacheLogger: ILogger = {
  debug: noop, info: noop, warn: noop, error: () => { cacheErrors++; }, success: noop,
  group: noop, groupEnd: noop, time: noop, timeEnd: noop, enable: noop, disable: noop, isEnabled: () => false,
};
type ProbeCache = ICacheService<string, { synthetic: string }>;
let active: { table: AstraWorkTable; observer: SharedGlobalObserver; host: HTMLElement; calls: number;
  factory: CacheFactory; privateCache: ProbeCache; publicCache: ProbeCache; timerArmedAt: number } | null = null;

export function cacheResources() {
  return { authListeners: cacheBus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED), storageWrites, storageRemovals,
    cacheErrors, rejectedCacheCommands, heldCacheEntries: active ? active.privateCache.size() + active.publicCache.size() : 0 };
}

export async function mountHeld(size: number, layout: AstraDashboardLayout): Promise<{ rows: number; nodes: number }> {
  if (active) throw new Error('A heap control is already mounted');
  const works: AstraWorkSummary[] = Array.from({ length: size }, (_, index) => ({ id: `work_${index}`, mediaId: index + 1,
    title: `Synthetic ${index}`, type: 'anime', status: MediaListStatus.CURRENT, updatedAt: 1,
    currentScore: 8, progress: 1, episodes: 12, sectionScores: { story: 8 } }));
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    layout, sort: 'title-asc', showProgress: true, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null, filteredWorks: works,
    stats: { totalCount: size, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0,
      genreDistribution: {}, statusDistribution: {} },
  };
  const host = document.createElement('div'); host.className = 'astra-modal--dashboard astra-dashboard heap-probe';
  host.style.cssText = 'position:relative;display:flex;flex-direction:column;width:1100px;height:600px;';
  document.body.append(host);
  const table = new AstraWorkTable({ setSort: () => {} } as unknown as AstraDashboardStore,
    { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }] } as unknown as AstraService,
    { open: () => {} } as unknown as AstraRatingModal);
  const observer = new SharedGlobalObserver();
  const factory = new CacheFactory(cacheStorage, cacheLogger, cacheBus);
  const privateCache = factory.create<string, { synthetic: string }>({ namespace: 'reviews_session' });
  const publicCache = factory.create<string, { synthetic: string }>({ namespace: 'heap_public' });
  active = { table, observer, host, calls: 0, factory, privateCache, publicCache, timerArmedAt: 0 };
  for (let index = 0; index < 8; index++) observer.register(`heap_${index}`, () => {
    if (active?.observer === observer) active.calls++;
  }, 10, mutationsMatchSelector('.heap-probe'));
  table.mount(host, state); await settle();
  table.focusEntry(size);
  table.update({ filteredWorks: works.map(work => ({ ...work, progress: 2 })) });
  await settle();
  const root = table.getElement();
  if (!root.querySelector(`[data-media-id="${size}"]`)) throw new Error('Heap workload failed to reach final work');
  await privateCache.set('private', { synthetic: 'private fixture payload '.repeat(100) });
  await publicCache.set('public', { synthetic: 'public fixture payload '.repeat(100) });
  active.timerArmedAt = performance.now();
  if (cacheBus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED) !== 1 || privateCache.size() !== 1 || publicCache.size() !== 1) {
    throw new Error('Cache positive workload failed');
  }
  return { rows: root.querySelectorAll('.astra-grid-row, .astra-layout-card').length, nodes: root.querySelectorAll('*').length };
}

export async function releaseHeld(): Promise<void> {
  if (!active) return;
  const { table, observer, host, factory, privateCache, publicCache, timerArmedAt } = active;
  // Leave genuine native scroll/ResizeObserver/MO work queued before teardown.
  table.getElement().dispatchEvent(new Event('scroll'));
  host.append(document.createElement('span'));
  await Promise.resolve();
  const elapsed = performance.now() - timerArmedAt;
  factory.dispose();
  table.unmount(); observer.destroy(); host.remove(); active = null;
  if (elapsed >= 2000) throw new Error('Cache teardown missed the pending persistence debounce');
  if (cacheBus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED) !== 0 || privateCache.size() || publicCache.size()) {
    throw new Error('Cache teardown retained a listener or entries');
  }
  for (const cache of [privateCache, publicCache]) {
    try {
      await cache.set('retired', { synthetic: 'must never enter memory' });
      throw new Error('Disposed cache accepted a command');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('disposed')) throw error;
      rejectedCacheCommands++;
    }
  }
  cacheBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
  await settle(); await new Promise<void>(resolve => setTimeout(resolve, 30));
  if (document.querySelector('.heap-probe') || observer.getStatus().callbackCount) throw new Error('Heap teardown failed');
  if (storageWrites || storageRemovals || cacheErrors || privateCache.size() || publicCache.size()) {
    throw new Error('Retired cache performed I/O, logged an error or restored entries');
  }
}

export async function runCycles(size: number, layout: AstraDashboardLayout, count: number): Promise<{ count: number; maxRows: number }> {
  let maxRows = 0;
  for (let index = 0; index < count; index++) {
    try { maxRows = Math.max(maxRows, (await mountHeld(size, layout)).rows); }
    finally { await releaseHeld(); }
  }
  return { count, maxRows };
}
