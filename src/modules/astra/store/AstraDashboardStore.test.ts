import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { AstraDashboardStore } from './AstraDashboardStore';
import { AstraFilterService } from '../services/AstraFilterService';
import { AstraStatsService } from '../services/AstraStatsService';
import type { AstraRepository } from './AstraRepository';
import type { AstraWorkSummary } from '../AstraInterfaces';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { logger } from '@core/logger';

describe('AstraDashboardStore preferences', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  function setup(saved: unknown = null) {
    const bus = new EventBus();
    // Storage is an external boundary: saved may deliberately be malformed.
    const storage = {
      async get<T>() { return saved as T | null; },
      set: vi.fn<IStorageService['set']>(async () => true),
    } satisfies Pick<IStorageService, 'get' | 'set'>;
    const repository = { getWorks: vi.fn<() => AstraWorkSummary[]>(() => []) } satisfies Pick<AstraRepository, 'getWorks'>;
    const store = new AstraDashboardStore(repository as unknown as AstraRepository, new AstraFilterService(), new AstraStatsService(), bus, storage as unknown as IStorageService);
    return { store, storage, bus, repository };
  }
  async function flush() { await Promise.resolve(); await Promise.resolve(); }

  it('enables Separate Airing by default', async () => {
    const { store } = setup();
    await flush();
    expect(store.getState().separateAiring).toBe(true);
    store.dispose();
  });

  it('persists a debounced search even without another preference change', async () => {
    const { store, storage } = setup();
    await flush();
    store.setSearch('eva');
    await vi.advanceTimersByTimeAsync(300);
    expect(store.getState().filters.search).toBe('eva');
    expect(storage.set).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      filters: expect.objectContaining({ search: 'eva' }),
    }));
  });

  it('persists and restores the separate-airing dashboard preference', async () => {
    const first = setup(); await flush();
    first.store.setSeparateAiring(false); await flush();
    const saved = first.storage.set.mock.calls.at(-1)![1];
    expect(saved).toEqual(expect.objectContaining({ separateAiring: false, separateAiringConfigured: true }));
    first.store.dispose();

    const restored = setup(saved); await flush();
    expect(restored.store.getState().separateAiring).toBe(false);
    restored.store.dispose();
  });

  it('migrates the former default-off value to on until the user explicitly chooses', async () => {
    const { store } = setup({ separateAiring: false });
    await flush();
    expect(store.getState().separateAiring).toBe(true);
    store.dispose();
  });

  it('does not restore old preferences over an interaction during async initialization', async () => {
    const { store } = setup({ sort: 'score-desc', layout: 'grid', filters: { search: 'old' } });
    store.setSearch('new');
    store.setSort('progress-desc');
    store.setLayout('list');
    await flush();
    expect(store.getState().sort).toBe('progress-desc');
    expect(store.getState().layout).toBe('list');
    await vi.advanceTimersByTimeAsync(300);
    expect(store.getState().filters.search).toBe('new');
  });

  it('cancels obsolete pending search when a filter reset supplies a new search', async () => {
    const { store } = setup();
    await flush();
    store.setSearch('obsolete');
    store.setFilters({ search: '' });
    await vi.advanceTimersByTimeAsync(300);
    expect(store.getState().filters.search).toBe('');
  });

  it('isolates filter arrays from callers and other store instances', async () => {
    const first = setup();
    const second = setup();
    await flush();
    const selected = ['Watch'];
    first.store.setFilters({ customLists: selected });
    selected.push('mutated');
    expect(first.store.getState().filters.customLists).toEqual(['Watch']);
    first.store.getState().filters.customLists.push('external');
    expect(first.store.getState().filters.customLists).toEqual(['Watch']);
    expect(second.store.getState().filters.customLists).toEqual([]);
  });

  it('ignores malformed saved preferences instead of applying invalid filters', async () => {
    const { store } = setup({ filters: { customLists: 'broken', search: null, type: 'unknown' }, sort: 'bogus', layout: 'bogus' });
    await flush();
    expect(store.getState().filters.customLists).toEqual([]);
    expect(store.getState().filters.search).toBe('');
    expect(store.getState().filters.type).toBe('all');
    expect(store.getState().sort).toBe('title-asc');
    expect(store.getState().layout).toBe('table');
  });

  it('coalesces data events while updating the derived view', async () => {
    const { store, repository, bus } = setup();
    await flush();
    repository.getWorks.mockClear();
    repository.getWorks.mockReturnValue([
      { id: 'updated', mediaId: 1, title: 'Updated', type: 'anime', status: MediaListStatus.CURRENT, currentScore: 8, progress: 2, updatedAt: 0 },
    ]);
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
    bus.emit(EVENT_TYPES.PROGRESS_UPDATED, { mediaId: 1, progress: 2, previousProgress: 1, userId: 42 });
    bus.emit(EVENT_TYPES.ASTRA_SYNC_COMPLETE, { added: 0, updated: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.getWorks).toHaveBeenCalledTimes(1);
    expect(store.getState().stats.totalCount).toBe(1);
    expect(store.getState().filteredWorks[0].progress).toBe(2);
  });

  it('releases all subscriptions, pending timers, listeners and private rows at document disposal', async () => {
    const { store, storage, bus, repository } = setup(); await flush();
    repository.getWorks.mockReturnValue([{ id: 'private', mediaId: 1, title: 'Private title', type: 'anime', status: MediaListStatus.CURRENT, currentScore: 8, updatedAt: 0 }]);
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() }); await vi.advanceTimersByTimeAsync(0);
    const listener = vi.fn(); store.subscribe(listener); listener.mockClear();
    store.setSearch('Private search'); bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
    (store as unknown as { dispose(): void }).dispose(); (store as unknown as { dispose(): void }).dispose();
    await vi.runAllTimersAsync();
    for (const event of [EVENT_TYPES.ASTRA_DATA_UPDATED, EVENT_TYPES.PROGRESS_UPDATED, EVENT_TYPES.ASTRA_SYNC_COMPLETE]) expect(bus.listenerCount(event)).toBe(0);
    expect(vi.getTimerCount()).toBe(0); expect(storage.set).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getDebugInfo())).not.toContain('Private'); expect(store.getState().filteredWorks).toEqual([]);
  });
  it('ignores a saved-preference read that resolves after disposal', async () => {
    let resolve!: (value: unknown) => void;
    const saved = new Promise(yes => { resolve = yes; });
    const { store, repository } = setup(saved); const listener = vi.fn(); store.subscribe(listener); listener.mockClear();
    (store as unknown as { dispose(): void }).dispose(); resolve({ filters: { search: 'Late private search' }, layout: 'grid' }); await flush();
    expect(listener).not.toHaveBeenCalled(); expect(repository.getWorks).not.toHaveBeenCalled();
    expect(store.getState().filters.search).toBe(''); expect(store.getState().layout).toBe('table');
  });
  it('makes copied callbacks and direct commands inert after disposal', async () => {
    const bus = new EventBus(); const on = vi.spyOn(bus, 'on');
    const storage = { get: async () => null, set: vi.fn(async () => true) };
    const repository = { getWorks: vi.fn(() => []) };
    const store = new AstraDashboardStore(repository as never, new AstraFilterService(), new AstraStatsService(), bus, storage as never); await flush();
    const callbacks = on.mock.calls.map(call => call[1]); const timeout = vi.spyOn(globalThis, 'setTimeout'); store.setSearch('late');
    const timer = timeout.mock.calls[0][0] as () => void;
    (store as unknown as { dispose(): void }).dispose(); repository.getWorks.mockClear();
    callbacks.forEach(callback => callback()); timer();
    store.setSearch('after'); store.setFilters({ search: 'after' }); store.setSort('score-desc'); store.setLayout('grid'); store.setShowProgress(true); store.setTab('settings');
    store.setState({ error: 'after' }); store.reset({ error: 'after' }); const batch = vi.fn(); store.batch(batch);
    const listener = vi.fn(); store.subscribe(listener); await vi.runAllTimersAsync();
    expect(listener).not.toHaveBeenCalled(); expect(batch).not.toHaveBeenCalled(); expect(repository.getWorks).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull(); expect(store.getDebugInfo().listenerCount).toBe(0);
  });
  it('contains a late saved-preference read failure without diagnostics after disposal', async () => {
    let reject!: (reason?: unknown) => void;
    const saved = new Promise((_resolve, no) => { reject = no; }); const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const { store, repository } = setup(saved); store.dispose(); reject(new Error('Late private storage error')); await flush();
      expect(error).not.toHaveBeenCalled(); expect(repository.getWorks).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });
  it('permits an issued preference write to finish without late diagnostics or notifications', async () => {
    const { store, storage } = setup(); await flush(); let resolve!: (value: boolean) => void;
    storage.set.mockReturnValueOnce(new Promise<boolean>(yes => { resolve = yes; })); const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      store.setLayout('grid'); expect(storage.set).toHaveBeenCalledOnce(); store.dispose();
      const listener = vi.fn(); store.subscribe(listener); resolve(false); await flush();
      expect(error).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled(); expect(storage.set).toHaveBeenCalledOnce();
    } finally { error.mockRestore(); }
  });
  it('does not persist after a listener disposes the store during a command notification', async () => {
    const { store, storage } = setup(); await flush(); let first = true;
    store.subscribe(() => { if (first) { first = false; return; } store.dispose(); });
    store.setLayout('grid'); expect(storage.set).not.toHaveBeenCalled(); expect(store.getDebugInfo().listenerCount).toBe(0);
  });
  it.each(['started-asc', 'started-desc', 'completed-asc', 'completed-desc'] as const)('restores and persists date sort %s across store recreation', async sort => {
    const first = setup(); await flush(); first.store.setSort(sort); await flush();
    expect(first.store.getState().sort).toBe(sort);
    const persisted = first.storage.set.mock.calls[first.storage.set.mock.calls.length - 1][1]; first.store.dispose();
    const restored = setup(persisted); await flush(); expect(restored.store.getState().sort).toBe(sort); restored.store.dispose();
  });

  it('derives date order from repository updates while preserving local Updated order and source rows', async () => {
    const { store, repository, bus } = setup({ sort: 'started-asc' });
    const rows = [
      { id: 'missing', mediaId: 1, title: 'Missing', type: 'anime' as const, status: MediaListStatus.CURRENT, currentScore: 8, updatedAt: 30 },
      { id: 'new', mediaId: 2, title: 'New', type: 'anime' as const, status: MediaListStatus.CURRENT, currentScore: 8, updatedAt: 10, startedAt: { year: 2028, month: null, day: null }, completedAt: { year: 2028, month: 2, day: 1 } },
      { id: 'old', mediaId: 3, title: 'Old', type: 'anime' as const, status: MediaListStatus.CURRENT, currentScore: 8, updatedAt: 20, startedAt: { year: 2026, month: 3, day: null }, completedAt: { year: 2027, month: null, day: null } },
    ];
    repository.getWorks.mockReturnValue(rows); await flush();
    expect(store.getState().filteredWorks.map(work => work.id)).toEqual(['old', 'new', 'missing']);
    store.setSort('completed-desc');
    expect(store.getState().filteredWorks.map(work => work.id)).toEqual(['new', 'old', 'missing']);
    rows[1].completedAt = { year: 2025, month: 1, day: 1 };
    bus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() }); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().filteredWorks.map(work => work.id)).toEqual(['old', 'new', 'missing']);
    store.setSort('updated-desc'); expect(store.getState().filteredWorks.map(work => work.id)).toEqual(['missing', 'old', 'new']);
    expect(rows.map(work => work.id)).toEqual(['missing', 'new', 'old']); expect(rows[2].startedAt).toEqual({ year: 2026, month: 3, day: null }); store.dispose();
  });

});
