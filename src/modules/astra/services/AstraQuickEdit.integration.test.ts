import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { SyncQueueService } from '@core/services/SyncQueueService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { AstraRepository } from '../store/AstraRepository';
import { AstraService } from '../AstraService';
import { AstraRatingService } from './AstraRatingService';
import { AstraParserService } from './AstraParserService';
import { AstraRatingModal } from '../ui/AstraRatingModal';
import { AstraOverlayService } from './AstraOverlayService';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { syncAcknowledgement } from '@/test/sync-fixtures';
import { AstraRepositoryHost } from '../store/AstraRepositoryHost';
import { AstraRepositoryClient } from '../store/AstraRepositoryClient';
import { SyncQueueClient } from '@core/services/SyncQueueClient';
import { AnilistClientProxy } from '@/api/AnilistClientProxy';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import { MediaListStatus } from '@/api/AnilistTypes';

describe('Quick Edit through real persistence and synchronization services', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'test';
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each(
    (['direct', 'JSON messaging'] as const).flatMap((transport) =>
      (
        [
          'success',
          'stored fields',
          'archive failure',
          'queue failure',
          'conflict',
          'data failure',
        ] as const
      ).map((scenario) => ({ transport, scenario }))
    )
  )('Watching to Planning through $transport: $scenario', async ({ transport, scenario }) => {
    const data = new Map<string, unknown>();
    let failWrites = false;
    const storage = {
      get: async <T>(key: string) => structuredClone(data.get(key) ?? null) as T | null,
      set: async (key: string, value: unknown) => {
        if (
          failWrites &&
          ((scenario === 'archive failure' && key.endsWith('au_astra_pending_commit')) ||
            (scenario === 'queue failure' && key === 'sync_queue_v1'))
        )
          return false;
        data.set(key, structuredClone(value));
        return true;
      },
      setMultiple: async (items: Record<string, unknown>) => {
        Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value)));
        return true;
      },
      remove: async (key: string) => {
        data.delete(key);
        return true;
      },
    };
    const raw = ratingResponse();
    let entry: typeof raw.Media.mediaListEntry | null = structuredClone(raw.Media.mediaListEntry);
    if (scenario === 'stored fields') {
      const stored = {
        id: 'existing',
        mediaId: 1,
        ownerId: 42,
        title: 'Stored title',
        type: 'anime',
        status: 'CURRENT',
        progress: 3,
        notes: 'Work notes',
        updatedAt: 1,
        customLists: [],
        tags: [],
        seasons: [
          {
            scores: { story: 8, finale: 9 },
            notes: raw.Media.mediaListEntry.notes,
            isSeriesFinale: true,
            episodeNotes: { 1: { text: 'Keep journal', score: 7, timestamp: 123 } },
            legacyScore: 6,
            manualOverride: false,
            label: 'Old',
          },
        ],
      };
      for (const prefix of ['', 'astra_account_42_']) {
        data.set(`${prefix}au_astra_manifest`, [{ mediaId: 1 }]);
        data.set(`${prefix}au_astra_work_1`, structuredClone(stored));
      }
    }
    const context = { sessionId: 'one', userId: 42 };
    const query = vi.fn(async (document: string): Promise<unknown> => {
      if (document.includes('Viewer'))
        return {
          ...structuredClone(raw),
          Media: { ...structuredClone(raw.Media), mediaListEntry: structuredClone(entry) },
        };
      return {
        Media: { id: 1, mediaListEntry: entry ? { id: entry.id, mediaId: 1, userId: 42 } : null },
      };
    });
    const mutate = vi.fn(
      async (document: string, variables: Record<string, unknown>): Promise<unknown> => {
        if (document.includes('DeleteMediaListEntry')) {
          expect(variables).toEqual({ id: 1001 });
          entry = null;
          return { DeleteMediaListEntry: { deleted: true } };
        }
        if (!entry) throw new Error('Unexpected entry recreation');
        if (typeof variables.status === 'string') entry.status = variables.status;
        return syncAcknowledgement(1, 42);
      }
    );
    const api = {
      query,
      mutate,
      getContext: () => ({ ...context }),
      ensureContext: async () => ({ ...context }),
      getCurrentUserId: async () => 42,
      isAuthenticated: () => true,
      getQueueStatus: () => ({ isRateLimited: false, queueLength: 0, activeRequests: 0 }),
    } as unknown as IApiClient;
    const bus = new EventBus();
    const repo = new AstraRepository(bus, storage as IStorageService);
    repo.setOwner(42);
    await repo.init();
    const auth = {
      ensureInitialized: async () => {},
      hasToken: () => true,
      getSessionId: () => 'one',
      getUserCache: () => ({ userId: 42 }),
      getStatus: async () => ({ authenticated: true, sessionId: 'one', userId: 42 }),
    };
    const host = new AstraRepositoryHost(bus, storage as IStorageService, auth as never);
    const queue = new SyncQueueService(
      storage as IStorageService,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } as never,
      api,
      auth as never,
      async (mediaId) => {
        if (transport === 'direct') await repo.deleteWork(mediaId);
        else await host.dispatch('deleteWork', [mediaId], 'one');
      }
    );
    const handler = createBackgroundMessageHandler(
      Promise.resolve(),
      () => auth as never,
      () => queue,
      () => api,
      () => host
    );
    // Chrome messages use JSON, including omitted undefined fields in replies.
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (message: unknown) =>
        new Promise((resolve) => {
          handler(
            JSON.parse(JSON.stringify(message)),
            { id: 'test', url: 'https://anilist.co/anime/1' },
            (response) => resolve(JSON.parse(JSON.stringify(response)))
          );
        }) as never
    );
    Object.assign(chrome.storage, { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } });
    const client = new AstraRepositoryClient(bus, storage as IStorageService, auth as never);
    const proxy = new AnilistClientProxy(auth as never, bus);
    const queueClient = new SyncQueueClient(auth as never);
    const activeRepo = transport === 'direct' ? repo : client;
    const activeApi = transport === 'direct' ? api : proxy;
    await activeRepo.init();
    if (scenario !== 'stored fields')
      await activeRepo.saveWork({ mediaId: 1, status: MediaListStatus.CURRENT });
    const astra = new AstraService(
      bus,
      activeApi,
      activeRepo,
      {} as never,
      {} as never,
      {} as never
    );
    const rating = new AstraRatingService(
      astra,
      activeApi,
      transport === 'direct' ? queue : queueClient,
      new AstraParserService()
    );
    const toast = { error: vi.fn(), info: vi.fn() };
    const overlays = new AstraOverlayService();
    const modal = new AstraRatingModal(astra, activeApi, bus, toast as never, rating, overlays);
    const reload = vi
      .spyOn(modal as unknown as { reloadHost(): void }, 'reloadHost')
      .mockImplementation(() => {});
    try {
      await modal.open(1);
      const root = document.querySelector<HTMLElement>('.astra-modal-overlay')!;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.id = 'astra-status-icon';
      root.querySelector('#astra-status-icon')!.replaceWith(icon);
      root.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
      if (scenario === 'conflict')
        await activeRepo.saveWork({ mediaId: 1, notes: 'Concurrent edit' });
      if (scenario === 'data failure')
        Object.assign(
          (modal as unknown as { state: { data: { seasons: object[] } } }).state.data.seasons[0],
          { unsupportedField: true }
        );
      failWrites = true;
      const closing = modal.close();
      expect(modal.close()).toBe(closing);
      if (scenario !== 'success' && scenario !== 'stored fields') {
        // Repeated close requests share the automatic save and show one diagnostic.
        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
        await closing;
        const expected =
          scenario === 'queue failure'
            ? 'AS-QUEUE-STORAGE_WRITE'
            : scenario === 'conflict'
              ? 'AS-LOCAL-CONFLICT'
              : scenario === 'data failure'
                ? 'AS-LOCAL-WORK_DATA'
                : 'AS-LOCAL-STORAGE_WRITE';
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(expected));
        if (scenario === 'data failure')
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('WORK_DATA:SEASON_FIELDS]')
          );
        expect(toast.error.mock.calls[0][0]).not.toContain('Concurrent edit');
        expect(toast.error.mock.calls[0][0]).toContain(
          scenario === 'queue failure' ? 'Saved to Astra' : 'Save failed'
        );
        expect(document.querySelector('.astra-modal-overlay')).toBe(root);
        expect(root.querySelector<HTMLInputElement>('#astra-status')?.value).toBe('PLANNING');
        expect((await activeRepo.getFullWork(1))?.status).toBe(
          scenario === 'queue failure' ? 'PLANNING' : 'CURRENT'
        );
        expect(entry?.status).toBe('CURRENT');
        expect(mutate).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        return;
      }
      await closing;
      await vi.waitFor(() => expect(entry?.status).toBe('PLANNING'));
      expect(reload).not.toHaveBeenCalled();
      expect(entry?.status).toBe('PLANNING');
      expect((await activeRepo.getFullWork(1))?.status).toBe('PLANNING');
      if (scenario === 'stored fields') {
        const persisted = data.get(
          `${transport === 'direct' ? '' : 'astra_account_42_'}au_astra_work_1`
        ) as { seasons: unknown[] };
        expect(persisted.seasons).toEqual([
          {
            scores: { story: 8, finale: 9 },
            notes: 'Remote text',
            isSeriesFinale: true,
            episodeNotes: { 1: { text: 'Keep journal', score: 7, timestamp: 123 } },
          },
        ]);
      }
      expect(entry?.notes).toBe('Remote text');
      expect(await queue.getQueue()).toEqual([]);
      expect(toast.error).not.toHaveBeenCalled();

      await modal.open(1);
      expect(document.querySelector('#astra-status-label')?.textContent).toBe('Planning');
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      document.querySelector<HTMLButtonElement>('#astra-delete-entry')!.click();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
      expect(entry).toBeNull();
      expect(await activeRepo.getFullWork(1)).toBeUndefined();
      expect(await queue.getQueue()).toEqual([]);
      expect(mutate.mock.calls.map((call) => call[0].includes('DeleteMediaListEntry'))).toEqual([
        false,
        true,
      ]);
      expect(document.querySelector('.astra-modal-overlay')).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      modal.dispose();
      overlays.dispose();
      astra.dispose();
      client.dispose();
      proxy.destroy();
      queueClient.dispose();
    }
  });
});
