import type { AstraRepository } from '../store/AstraRepository';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import type { IAstraRatingService } from '../interfaces/IAstraRatingService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { describe, expect, it, vi } from 'vitest';
import { AstraSyncManager } from './AstraSyncManager';
import { AstraParserService } from './AstraParserService';
import type { AstraWork } from '../AstraInterfaces';
import { ratingInitialResponse } from './AstraRatingResponse';
import { ratingResponse } from '@/test/astra-rating-fixtures';

function setup(append = true) {
  const mutate = vi.fn(async (_query: string, _payload?: Record<string, unknown>): Promise<unknown> => ({ id: 1 }));
  const api = { mutate: Object.assign(async <T>(...args: Parameters<typeof mutate>): Promise<T> => await mutate(...args) as T, mutate) } satisfies Pick<IApiClient, 'mutate'>;
  const rating = { getMediaRatingData: vi.fn<IAstraRatingService['getMediaRatingData']>(async () => null) } satisfies Pick<IAstraRatingService, 'getMediaRatingData'>;
  const settings = { appendAstraToComment: append, autoSync: true, enableSeriesFinale: false, finaleWeightMultiplier: 1 };
  const repo = { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }], getSettings: () => ({ ...settings }) } satisfies Pick<AstraRepository, 'getSections' | 'getSettings'>;
  const queue = { enqueue: vi.fn(async (_type: Parameters<ISyncQueueService['enqueue']>[0], _payload: unknown) => {}), process: vi.fn(async () => {}) } satisfies Pick<ISyncQueueService, 'enqueue' | 'process'>;
  const manager = new AstraSyncManager(repo as unknown as AstraRepository, new AstraParserService(), rating as unknown as IAstraRatingService, api as unknown as IApiClient, queue as unknown as ISyncQueueService);
  const work: AstraWork = { id: 'anime-1', mediaId: 1, title: 'Test', type: 'anime',
    status: MediaListStatus.CURRENT, customLists: [], tags: [], notes: '', updatedAt: 0,
    seasons: [{ scores: { story: 8 }, notes: '' }] };
  return { api, rating, manager, work, queue, settings };
}

describe('AstraSyncManager safe note push', () => {
  it('never replaces unread remote notes after a failed fetch', async () => {
    const { api, manager, work } = setup();
    await expect(manager.push(1, work)).rejects.toThrow(/notes/i);
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('uses supplied remote notes without a redundant fetch', async () => {
    const { api, rating, manager, work, queue } = setup();
    await manager.push(1, work, 'Text to preserve');
    expect(rating.getMediaRatingData).not.toHaveBeenCalled();
    expect(queue.enqueue.mock.calls[0][1]).toHaveProperty('notes', expect.stringContaining('Text to preserve'));
    expect(queue.enqueue.mock.calls[0][1]).toMatchObject({ expectedNotes: 'Text to preserve', astraNotesUpdatedAt: work.updatedAt });
    expect(queue.process).toHaveBeenCalledOnce();
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('does not queue notes that would recreate an AniList entry removed remotely', async () => {
    const { api, rating, manager, work, queue } = setup();
    rating.getMediaRatingData.mockResolvedValueOnce({ media: { mediaListEntry: null } } as unknown as Awaited<ReturnType<IAstraRatingService['getMediaRatingData']>>);
    await manager.push(1, work);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('does nothing when appending is disabled, even when called directly', async () => {
    const { manager, work, rating, queue } = setup(false);
    await manager.push(1, work);
    expect(rating.getMediaRatingData).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('stops if the option is disabled while fetching remote notes', async () => {
    const { manager, work, rating, settings, queue } = setup();
    rating.getMediaRatingData.mockImplementationOnce(async () => {
      settings.appendAstraToComment = false;
      return ratingInitialResponse(ratingResponse(), 1, 42);
    });
    await manager.push(1, work);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects work belonging to a different title before reading or writing anything', async () => {
    const { manager, work, rating, queue } = setup();
    await expect(manager.push(2, work, 'Personal')).rejects.toThrow(/Unrelated/);
    expect(rating.getMediaRatingData).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
