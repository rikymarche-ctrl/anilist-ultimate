import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import { describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EventBus } from '@core/events/EventBus';
import { AstraService } from '../AstraService';
import { AstraRepository } from '../store/AstraRepository';
import { AstraSyncService } from './AstraSyncService';
import { AstraRatingService } from './AstraRatingService';
import { AstraParserService } from './AstraParserService';
import { AstraRatingModal } from '../ui/AstraRatingModal';
import type { IAstraRatingService } from '../interfaces/IAstraRatingService';
import type { AstraWork } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';
import { syncAcknowledgement } from '@/test/sync-fixtures';
import { SyncQueueService } from '@core/services/SyncQueueService';

describe('Astra persistence dependency wiring', () => {
  it('resolves the real circular service graph and persists through the rating service', async () => {
    const di = container.createChildContainer();
    const stored = new Map<string, unknown>();
    const storage = { get: async <T>(key: string): Promise<T | null> => structuredClone(stored.get(key) ?? null) as T | null,
      set: vi.fn(async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); return true; }),
      setMultiple: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([key, value]) => stored.set(key, structuredClone(value))); return true; }),
      remove: vi.fn(async (key: string) => { stored.delete(key); return true; }) } satisfies Pick<IStorageService, 'get' | 'set' | 'setMultiple' | 'remove'>;
    const mutate = vi.fn(async (_query: string, payload: Record<string, unknown> = {}): Promise<unknown> => syncAcknowledgement(Number(payload.mediaId ?? payload.id), 1));
    const api = { mutate: Object.assign(async <T>(...args: Parameters<typeof mutate>): Promise<T> => await mutate(...args) as T, mutate), getQueueStatus: () => ({ queueLength: 0, activeRequests: 0, isRateLimited: false }) } satisfies Pick<IApiClient, 'mutate' | 'getQueueStatus'>;
    const bus = new EventBus();
    const repo = new AstraRepository(bus, storage as unknown as IStorageService);
    di.registerInstance(TOKENS.EventBus, bus);
    di.registerInstance(TOKENS.ApiClient, api);
    di.registerInstance(TOKENS.SyncQueue, new SyncQueueService(storage as unknown as IStorageService,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() } satisfies Pick<ILogger, 'info' | 'warn' | 'error' | 'success'> as unknown as ILogger, api as unknown as IApiClient));
    di.registerInstance(TOKENS.AstraParserService, new AstraParserService());
    di.registerInstance(TOKENS.ToastService, { error: vi.fn(), info: vi.fn() });
    di.registerInstance(TOKENS.AstraSyncManager, { push: vi.fn() });
    di.registerInstance(AstraRepository, repo);
    di.registerInstance(AstraSyncService, {} as AstraSyncService);
    di.registerSingleton(AstraService);
    di.register(TOKENS.AstraService, { useToken: AstraService });
    di.registerSingleton(TOKENS.IAstraRatingService, AstraRatingService);
    const resizeListeners: EventListenerOrEventListenerObject[] = [];
    const add = window.addEventListener.bind(window);
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'resize') resizeListeners.push(listener);
      add(type, listener, options);
    });
    try {
      expect(di.resolve(AstraRatingModal)).toBeInstanceOf(AstraRatingModal);
      const rating = di.resolve<IAstraRatingService>(TOKENS.IAstraRatingService);
      const work: AstraWork = { id: 'w', mediaId: 1, title: 'Test', type: 'anime', status: MediaListStatus.COMPLETED,
        customLists: [], tags: [], updatedAt: 0, notes: 'Local', seasons: [{ scores: { story: 8 }, notes: 'Local' }] };
      expect(await rating.saveAndSync(work, { overallScore: 8 })).toBe('synced');
      expect((await repo.getFullWork(1))?.notes).toBe('Local');
      expect(repo.getWorks()[0].currentScore).toBe(8);
      expect(stored.has('au_astra_manifest')).toBe(true);
      expect(api.mutate).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      resizeListeners.forEach(listener => window.removeEventListener('resize', listener));
      di.reset();
    }
  });
});
